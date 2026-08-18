/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

/**
 * Owns every native Android push transition that replaces the runtime origin or
 * the credential behind an existing registration.
 *
 * <p>A runtime rebind is an explicit transaction with exactly one owner: the
 * handle returned by {@link #begin}. Only that handle can commit or roll the
 * transition back, each transaction records a single terminal state, and
 * repeating a terminal call replays the recorded outcome instead of touching
 * durable state again. A handle that no longer describes the staged transition
 * is stale and can neither revoke nor rotate a newer registration.</p>
 *
 * <p>Old-origin cleanup always runs through {@link AndroidPushRevocationCoordinator},
 * which only uses the authority durably retained with its own tombstone, so a
 * newly authenticated credential is never sent to the origin that did not issue
 * it. {@link AndroidPushRegistrationCoordinator} stays an independent
 * dependency: it refuses to synchronize while a cross-origin transaction is
 * staged instead of participating in the transition.</p>
 *
 * <p>This layer never invalidates bearer tokens or authentication sessions. It
 * only reports typed cleanup outcomes so the authentication layer can decide
 * when a retained authority may finally be dropped.</p>
 */
final class AndroidPushRebindCoordinator {
    /** Abstract transition state; it never carries identities or credentials. */
    enum Status {
        IDLE,
        REBIND_STAGED,
        CLEANUP_PENDING,
        CLEANUP_REJECTED,
        CANCELLED,
        RETRY_PENDING
    }

    interface StatusPublisher {
        void publish(Status status);
    }

    /**
     * Typed result of removing a superseded registration from its own origin.
     *
     * <p>{@link #PENDING} and {@link #CANCELLED} mean a durable tombstone still
     * holds the authority that produced the registration, so the authentication
     * layer must keep that authority usable until cleanup finishes.</p>
     */
    enum Cleanup {
        NOT_REQUIRED,
        COMPLETED,
        PENDING,
        AUTHORITY_REJECTED,
        AUTHORITY_UNAVAILABLE,
        CANCELLED
    }

    /**
     * A caller credential together with the origin that issued it.
     *
     * <p>Keeping both inseparable is what stops a credential from reaching
     * another origin: every transition compares the issuing origin with the
     * binding it is about to act on and refuses when they differ, so a
     * credential is never retained for, or sent to, an origin that did not
     * produce it.</p>
     */
    static final class Credential {
        private final String apiOrigin;
        private final String authority;

        Credential(String apiOrigin, String authority) {
            this.apiOrigin = AndroidPushIdentityStorage.normalizeApiOrigin(
                apiOrigin
            );
            this.authority = authority == null ? "" : authority.trim();
        }

        private boolean isUsable() {
            return apiOrigin != null && !authority.isEmpty();
        }

        private boolean canAuthorize(AndroidPushIdentityStorage.State state) {
            return isUsable()
                && state != null
                && state.apiOrigin().equals(apiOrigin);
        }

        private boolean sameOriginAs(Credential other) {
            return other != null
                && apiOrigin != null
                && apiOrigin.equals(other.apiOrigin);
        }

        private boolean sameAuthorityAs(Credential other) {
            return other != null && authority.equals(other.authority);
        }
    }

    /** A staged runtime rebind owned by exactly one caller. */
    static final class Transaction {
        private final String nextApiOrigin;
        private final int nextMetadataRevision;
        private final String stagedInstallationId;
        private Outcome terminalOutcome;

        private Transaction(
            String nextApiOrigin,
            int nextMetadataRevision,
            String stagedInstallationId
        ) {
            this.nextApiOrigin = nextApiOrigin;
            this.nextMetadataRevision = nextMetadataRevision;
            this.stagedInstallationId = stagedInstallationId;
        }

        String nextApiOrigin() {
            return nextApiOrigin;
        }

        boolean isTerminal() {
            return terminalOutcome != null;
        }

        private void terminate(Outcome outcome) {
            terminalOutcome = outcome;
        }

        private boolean describes(AndroidPushIdentityStorage.State current) {
            if (current == null) {
                return stagedInstallationId == null;
            }
            if (stagedInstallationId != null
                && !stagedInstallationId.equals(current.installationId())) {
                return false;
            }
            if (!current.hasServerRegistration()) {
                return true;
            }
            return current.hasPendingRebind()
                && nextApiOrigin.equals(current.pendingRebindApiOrigin());
        }
    }

    static final class Outcome {
        enum Kind {
            STAGED,
            RESUMED,
            COMMITTED,
            ROLLED_BACK,
            CLEANED,
            INVALIDATED,
            IDLE,
            CANCELLED,
            CONFLICT,
            STALE,
            FAILED
        }

        private final Kind kind;
        private final Cleanup cleanup;
        private final Transaction transaction;

        private Outcome(Kind kind, Cleanup cleanup, Transaction transaction) {
            this.kind = kind;
            this.cleanup = cleanup;
            this.transaction = transaction;
        }

        static Outcome of(Kind kind) {
            return new Outcome(kind, Cleanup.NOT_REQUIRED, null);
        }

        static Outcome of(Kind kind, Cleanup cleanup) {
            return new Outcome(kind, cleanup, null);
        }

        static Outcome of(Kind kind, Transaction transaction) {
            return new Outcome(kind, Cleanup.NOT_REQUIRED, transaction);
        }

        Kind kind() {
            return kind;
        }

        Cleanup cleanup() {
            return cleanup;
        }

        Transaction transaction() {
            return transaction;
        }

        Status status() {
            if (cleanup != Cleanup.NOT_REQUIRED) {
                return cleanupStatus();
            }
            switch (kind) {
                case STAGED:
                case RESUMED:
                    return Status.REBIND_STAGED;
                case CANCELLED:
                    return Status.CANCELLED;
                case CONFLICT:
                case STALE:
                case FAILED:
                    return Status.RETRY_PENDING;
                default:
                    return Status.IDLE;
            }
        }

        private Status cleanupStatus() {
            switch (cleanup) {
                case PENDING:
                    return Status.CLEANUP_PENDING;
                case AUTHORITY_REJECTED:
                case AUTHORITY_UNAVAILABLE:
                    return Status.CLEANUP_REJECTED;
                case CANCELLED:
                    return Status.CANCELLED;
                default:
                    return Status.IDLE;
            }
        }
    }

    private final AndroidPushIdentityStorage storage;
    private final AndroidPushRevocationCoordinator revocation;
    private final StatusPublisher statusPublisher;
    private Transaction activeTransaction;

    AndroidPushRebindCoordinator(
        AndroidPushIdentityStorage storage,
        AndroidPushRevocationCoordinator revocation,
        StatusPublisher statusPublisher
    ) {
        this.storage = storage;
        this.revocation = revocation;
        this.statusPublisher = statusPublisher;
    }

    /**
     * Stages a runtime rebind and returns the handle that owns it.
     *
     * <p>{@code previous} must have been issued by the currently bound origin:
     * it is retained for that origin only and is never sent anywhere else. A
     * credential from the origin the caller is moving to cannot authorize the
     * cleanup of the origin it is leaving. Staging fails while durable cleanup
     * or another transaction still owns the transition.</p>
     *
     * <p>Staging is only persisted when a server registration has to be
     * protected. Without one there is nothing to clean up, so the transaction
     * lives in this process only and a restart simply starts over.</p>
     */
    synchronized Outcome begin(
        String nextApiOrigin,
        int nextMetadataRevision,
        Credential previous
    ) {
        if (activeTransaction != null && !activeTransaction.isTerminal()) {
            return publish(Outcome.of(Outcome.Kind.CONFLICT));
        }
        if (nextMetadataRevision <= 0) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        String normalizedOrigin = AndroidPushIdentityStorage.normalizeApiOrigin(
            nextApiOrigin
        );
        if (normalizedOrigin == null) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        AndroidPushIdentityStorage.State current;
        try {
            current = storage.load();
            if (current != null && current.hasPendingRevocation()) {
                return publish(
                    Outcome.of(Outcome.Kind.CONFLICT, Cleanup.PENDING)
                );
            }
            if (current != null
                && current.hasServerRegistration()
                && (previous == null || !previous.canAuthorize(current))) {
                return publish(
                    Outcome.of(
                        Outcome.Kind.CONFLICT,
                        Cleanup.AUTHORITY_UNAVAILABLE
                    )
                );
            }
            storage.prepareRuntimeRebind(
                normalizedOrigin,
                previous == null ? null : previous.authority
            );
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        activeTransaction = new Transaction(
            normalizedOrigin,
            nextMetadataRevision,
            current == null ? null : current.installationId()
        );
        return publish(Outcome.of(Outcome.Kind.STAGED, activeTransaction));
    }

    /**
     * Binds the staged origin and then removes the superseded registration from
     * the origin it belonged to.
     *
     * <p>An already cancelled signal leaves the transaction staged so the caller
     * can commit it later; every other path is terminal. Because a terminal
     * handle replays its recorded outcome, an unfinished cleanup is retried
     * through {@link #cleanup} rather than by committing again.</p>
     */
    synchronized Outcome commit(
        Transaction handle,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        Outcome replayed = replayTerminalOutcome(handle);
        if (replayed != null) {
            return publish(replayed);
        }
        if (cancellation.isCancelled()) {
            return publish(Outcome.of(Outcome.Kind.CANCELLED));
        }
        try {
            if (!handle.describes(storage.load())) {
                return publish(Outcome.of(Outcome.Kind.STALE));
            }
            AndroidPushIdentityStorage.State bound = storage.bindRuntime(
                handle.nextApiOrigin(),
                handle.nextMetadataRevision
            );
            if (bound.hasPendingRebind()) {
                storage.cancelPreparedRuntimeRebind(handle.nextApiOrigin());
            }
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        activeTransaction = null;
        Outcome committed = Outcome.of(
            Outcome.Kind.COMMITTED,
            cleanupRetainedRegistration(cancellation)
        );
        handle.terminate(committed);
        return publish(committed);
    }

    /**
     * Discards a staged transition and keeps the current binding authoritative.
     *
     * <p>Rollback is only available before the commit. Once the superseded
     * registration became a durable tombstone, cleanup is forward-only: reviving
     * a registration that may already be revoked on its origin is never safe.</p>
     */
    synchronized Outcome rollback(Transaction handle) {
        Outcome replayed = replayTerminalOutcome(handle);
        if (replayed != null) {
            return publish(replayed);
        }
        try {
            storage.cancelPreparedRuntimeRebind(handle.nextApiOrigin());
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        activeTransaction = null;
        Outcome rolledBack = Outcome.of(Outcome.Kind.ROLLED_BACK);
        handle.terminate(rolledBack);
        return publish(rolledBack);
    }

    /**
     * Resumes or invalidates a transition that survived a process restart.
     *
     * <p>A staged transition is resumed only when its origin still matches the
     * runtime the caller is starting; otherwise the staged authority is
     * discarded. Durable cleanup always runs first because a retained tombstone
     * owns the transition until it is resolved. A transaction that is still open
     * in this process owns the transition and is never replaced.</p>
     */
    synchronized Outcome recover(
        String apiOrigin,
        int metadataRevision,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (activeTransaction != null && !activeTransaction.isTerminal()) {
            return publish(Outcome.of(Outcome.Kind.CONFLICT));
        }
        activeTransaction = null;
        AndroidPushIdentityStorage.State current;
        try {
            current = storage.load();
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        if (current == null) {
            return publish(Outcome.of(Outcome.Kind.IDLE));
        }
        if (current.hasPendingRevocation()) {
            Cleanup cleanup = cleanupRetainedRegistration(cancellation);
            if (cleanup != Cleanup.COMPLETED) {
                return publish(Outcome.of(Outcome.Kind.CLEANED, cleanup));
            }
            try {
                current = storage.load();
            } catch (TokenStorageException | RuntimeException exception) {
                return publish(Outcome.of(Outcome.Kind.FAILED));
            }
            if (current == null) {
                return publish(
                    Outcome.of(Outcome.Kind.CLEANED, Cleanup.COMPLETED)
                );
            }
        }
        if (!current.hasPendingRebind()) {
            return publish(Outcome.of(Outcome.Kind.IDLE));
        }
        String normalizedOrigin = AndroidPushIdentityStorage.normalizeApiOrigin(
            apiOrigin
        );
        if (metadataRevision > 0
            && current.pendingRebindApiOrigin().equals(normalizedOrigin)) {
            activeTransaction = new Transaction(
                normalizedOrigin,
                metadataRevision,
                current.installationId()
            );
            return publish(
                Outcome.of(Outcome.Kind.RESUMED, activeTransaction)
            );
        }
        try {
            storage.cancelPreparedRuntimeRebind(
                current.pendingRebindApiOrigin()
            );
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        return publish(Outcome.of(Outcome.Kind.INVALIDATED));
    }

    /**
     * Removes the registration of a session that is being logged out.
     *
     * <p>The credential is only ever used against the origin that issued it, and
     * only while it still describes the current binding. This method never
     * invalidates the session itself: while the reported cleanup is
     * {@link Cleanup#PENDING} or {@link Cleanup#CANCELLED}, the authority must
     * remain usable so the retry can finish.</p>
     */
    synchronized Outcome logout(
        Credential credential,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        return retainAndClean(credential, true, cancellation);
    }

    /**
     * Removes the registration created by a credential that is being replaced.
     *
     * <p>The superseded registration is revoked with the authority that produced
     * it, never with the replacement credential. An absent or identical
     * replacement changes nothing; use {@link #logout} when no credential takes
     * the place of the current one, and {@link #begin} when the replacement
     * belongs to another origin.</p>
     */
    synchronized Outcome replaceCredential(
        Credential previous,
        Credential next,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (next == null
            || !next.isUsable()
            || next.sameAuthorityAs(previous)) {
            return publish(
                Outcome.of(Outcome.Kind.CLEANED, Cleanup.NOT_REQUIRED)
            );
        }
        if (!next.sameOriginAs(previous)) {
            return publish(
                Outcome.of(
                    Outcome.Kind.CONFLICT,
                    Cleanup.AUTHORITY_UNAVAILABLE
                )
            );
        }
        return retainAndClean(previous, false, cancellation);
    }

    /** Retries durable cleanup without starting a new transition. */
    synchronized Outcome cleanup(
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        AndroidPushIdentityStorage.State current;
        try {
            current = storage.load();
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        if (current == null || !current.hasPendingRevocation()) {
            return publish(
                Outcome.of(Outcome.Kind.CLEANED, Cleanup.NOT_REQUIRED)
            );
        }
        return publish(
            Outcome.of(
                Outcome.Kind.CLEANED,
                cleanupRetainedRegistration(cancellation)
            )
        );
    }

    /**
     * Drains an already retained tombstone and then removes the registration
     * that is still live, so a credential transition never reports a completed
     * cleanup while its own registration remains on the server.
     */
    private Outcome retainAndClean(
        Credential credential,
        boolean requiresAuthenticationLogout,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (activeTransaction != null && !activeTransaction.isTerminal()) {
            return publish(Outcome.of(Outcome.Kind.CONFLICT));
        }
        AndroidPushIdentityStorage.State current;
        Cleanup drained = Cleanup.NOT_REQUIRED;
        try {
            current = storage.load();
            if (current != null && current.hasPendingRevocation()) {
                drained = cleanupRetainedRegistration(cancellation);
                if (drained != Cleanup.COMPLETED) {
                    return publish(
                        Outcome.of(Outcome.Kind.CLEANED, drained)
                    );
                }
                current = storage.load();
            }
            if (current == null || !current.hasServerRegistration()) {
                return publish(Outcome.of(Outcome.Kind.CLEANED, drained));
            }
            if (credential == null || !credential.canAuthorize(current)) {
                return publish(
                    Outcome.of(
                        Outcome.Kind.CLEANED,
                        Cleanup.AUTHORITY_UNAVAILABLE
                    )
                );
            }
            storage.retainCurrentRegistrationForRevocation(
                credential.authority,
                requiresAuthenticationLogout
            );
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        return publish(
            Outcome.of(
                Outcome.Kind.CLEANED,
                cleanupRetainedRegistration(cancellation)
            )
        );
    }

    private Cleanup cleanupRetainedRegistration(
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        switch (revocation.retry(cancellation).kind()) {
            case SUCCESS:
                return Cleanup.COMPLETED;
            case AUTHORITY_REJECTED:
                return Cleanup.AUTHORITY_REJECTED;
            case CANCELLED:
                return Cleanup.CANCELLED;
            default:
                return Cleanup.PENDING;
        }
    }

    private Outcome replayTerminalOutcome(Transaction handle) {
        if (handle == null) {
            return Outcome.of(Outcome.Kind.STALE);
        }
        if (handle.isTerminal()) {
            return handle.terminalOutcome;
        }
        return handle == activeTransaction
            ? null
            : Outcome.of(Outcome.Kind.STALE);
    }

    private Outcome publish(Outcome outcome) {
        statusPublisher.publish(outcome.status());
        return outcome;
    }

}
