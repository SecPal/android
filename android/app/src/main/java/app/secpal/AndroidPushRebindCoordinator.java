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
            return apiOrigin != null
                && !authority.isEmpty()
                && authority.length()
                    <= AndroidPushIdentityStorage.MAX_AUTH_TOKEN_CHARACTERS;
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
        private final long stagedGeneration;
        private Outcome terminalOutcome;

        private Transaction(
            String nextApiOrigin,
            int nextMetadataRevision,
            String stagedInstallationId,
            long stagedGeneration
        ) {
            this.nextApiOrigin = nextApiOrigin;
            this.nextMetadataRevision = nextMetadataRevision;
            this.stagedInstallationId = stagedInstallationId;
            this.stagedGeneration = stagedGeneration;
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

        private boolean describes(AndroidPushIdentityStorage.Snapshot current) {
            if (current.rebindGeneration() != stagedGeneration) {
                return false;
            }
            AndroidPushIdentityStorage.State state = current.state();
            if (stagedInstallationId == null || state == null) {
                return stagedInstallationId == null && state == null;
            }
            if (!stagedInstallationId.equals(state.installationId())) {
                return false;
            }
            if (!state.hasServerRegistration()) {
                return true;
            }
            return state.hasPendingRebind()
                && nextApiOrigin.equals(state.pendingRebindApiOrigin());
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
        AndroidPushIdentityStorage.Snapshot observed;
        AndroidPushIdentityStorage.State current;
        try {
            observed = storage.snapshot();
            current = observed.state();
            if (current != null && current.hasPendingRevocation()) {
                return publish(
                    Outcome.of(Outcome.Kind.CONFLICT, Cleanup.PENDING)
                );
            }
            if (current != null && current.hasPendingRebind()) {
                return publish(Outcome.of(Outcome.Kind.CONFLICT));
            }
            if ((previous != null && !previous.canAuthorize(current))
                || (previous == null
                    && current != null
                    && current.hasServerRegistration())) {
                return publish(
                    Outcome.of(
                        Outcome.Kind.CONFLICT,
                        Cleanup.AUTHORITY_UNAVAILABLE
                    )
                );
            }
            storage.prepareRuntimeRebind(
                normalizedOrigin,
                previous == null ? null : previous.authority,
                observed
            );
            observed = storage.snapshot();
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        activeTransaction = new Transaction(
            normalizedOrigin,
            nextMetadataRevision,
            current == null ? null : current.installationId(),
            observed.rebindGeneration()
        );
        return publish(Outcome.of(Outcome.Kind.STAGED, activeTransaction));
    }

    /**
     * Binds the staged origin and then removes the superseded registration from
     * the origin it belonged to.
     *
     * <p>A cancelled signal and a storage failure leave the transaction staged
     * so the caller can commit it again. A commit and a stale handle are
     * terminal: a handle that no longer describes the staged transition can
     * never succeed, so it releases the transition instead of blocking every
     * later cleanup. Because a terminal handle replays its recorded outcome, an
     * unfinished cleanup is retried through {@link #cleanup} rather than by
     * committing again.</p>
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
            AndroidPushIdentityStorage.Snapshot validated = storage.snapshot();
            if (!handle.describes(validated)) {
                return publish(
                    terminate(handle, Outcome.of(Outcome.Kind.STALE))
                );
            }
            AndroidPushIdentityStorage.State bound = storage.bindRuntime(
                handle.nextApiOrigin(),
                handle.nextMetadataRevision,
                null,
                validated
            );
            if (bound.hasPendingRebind()) {
                storage.cancelPreparedRuntimeRebind(handle.nextApiOrigin());
            }
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        return publish(
            terminate(
                handle,
                Outcome.of(
                    Outcome.Kind.COMMITTED,
                    cleanupRetainedRegistration(cancellation)
                )
            )
        );
    }

    /**
     * Discards a staged transition and keeps the current binding authoritative.
     *
     * <p>Rollback is only available before the commit. Once the superseded
     * registration became a durable tombstone, cleanup is forward-only: reviving
     * a registration that may already be revoked on its origin is never safe.
     * A handle that no longer describes the staged transition is stale here for
     * the same reason it is stale on commit: it must not discard a staging that
     * belongs to a newer binding.</p>
     */
    synchronized Outcome rollback(Transaction handle) {
        Outcome replayed = replayTerminalOutcome(handle);
        if (replayed != null) {
            return publish(replayed);
        }
        try {
            if (!handle.describes(storage.snapshot())) {
                return publish(
                    terminate(handle, Outcome.of(Outcome.Kind.STALE))
                );
            }
            storage.cancelPreparedRuntimeRebind(handle.nextApiOrigin());
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(Outcome.of(Outcome.Kind.FAILED));
        }
        return publish(
            terminate(handle, Outcome.of(Outcome.Kind.ROLLED_BACK))
        );
    }

    /**
     * Resumes or invalidates a transition that survived a process restart.
     *
     * <p>A staged transition is resumed only when its origin still matches the
     * runtime the caller is starting; otherwise the staged authority is
     * discarded. The transaction owns the target origin, not the metadata
     * revision: the resumed transaction always carries the revision the runtime
     * reports now, because a revision captured before the restart may no longer
     * describe the runtime the device is actually configured for. Durable cleanup
     * always runs first because a retained tombstone owns the transition until it
     * is resolved. A transaction that is still open in this process owns the
     * transition and is never replaced.</p>
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
        Outcome drained = null;
        try {
            AndroidPushIdentityStorage.Snapshot observed = storage.snapshot();
            AndroidPushIdentityStorage.State current = observed.state();
            if (current != null && current.hasPendingRevocation()) {
                drained = Outcome.of(
                    Outcome.Kind.CLEANED,
                    cleanupRetainedRegistration(cancellation)
                );
                if (drained.cleanup() != Cleanup.COMPLETED) {
                    return publish(drained);
                }
                observed = storage.snapshot();
                current = observed.state();
            }
            if (current == null || !current.hasPendingRebind()) {
                return publish(
                    drained == null ? Outcome.of(Outcome.Kind.IDLE) : drained
                );
            }
            return publish(
                resumeOrInvalidate(observed, apiOrigin, metadataRevision)
            );
        } catch (TokenStorageException | RuntimeException exception) {
            return publish(
                Outcome.of(Outcome.Kind.FAILED)
            );
        }
    }

    /**
     * Resumes the staged transition for the runtime the caller is starting, or
     * discards a staging that no longer describes any runtime it could apply to.
     *
     * <p>Unusable metadata is never treated as a different runtime: discarding
     * the staged authority would leave its registration live with nothing left
     * to remove it.</p>
     */
    private Outcome resumeOrInvalidate(
        AndroidPushIdentityStorage.Snapshot observed,
        String apiOrigin,
        int metadataRevision
    ) throws TokenStorageException {
        AndroidPushIdentityStorage.State current = observed.state();
        String normalizedOrigin = AndroidPushIdentityStorage.normalizeApiOrigin(
            apiOrigin
        );
        if (normalizedOrigin == null || metadataRevision <= 0) {
            return Outcome.of(Outcome.Kind.FAILED);
        }
        if (current.pendingRebindApiOrigin().equals(normalizedOrigin)) {
            activeTransaction = new Transaction(
                normalizedOrigin,
                metadataRevision,
                current.installationId(),
                observed.rebindGeneration()
            );
            return Outcome.of(Outcome.Kind.RESUMED, activeTransaction);
        }
        storage.cancelPreparedRuntimeRebind(current.pendingRebindApiOrigin());
        return Outcome.of(Outcome.Kind.INVALIDATED);
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
     * it, never with the replacement credential. Only an identical replacement
     * changes nothing, because the registration stays live under a credential
     * that is still valid. A replacement that is absent, unusable, or issued by
     * another origin is refused instead of being reported as a finished
     * transition: the registration would stay live on its origin while the only
     * authority that could still remove it is dropped. Use {@link #logout} when
     * no credential takes the place of the current one, and {@link #begin} when
     * the replacement belongs to another origin.</p>
     */
    synchronized Outcome replaceCredential(
        Credential previous,
        Credential next,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (next == null
            || !next.isUsable()
            || !next.sameOriginAs(previous)) {
            return publish(
                Outcome.of(
                    Outcome.Kind.CONFLICT,
                    Cleanup.AUTHORITY_UNAVAILABLE
                )
            );
        }
        if (next.sameAuthorityAs(previous)) {
            return publish(unchangedCredentialOutcome(previous));
        }
        return retainAndClean(previous, false, cancellation);
    }

    /**
     * Answers a replacement that changes nothing, without ever claiming that
     * there is no cleanup for a registration this credential does not own.
     */
    private Outcome unchangedCredentialOutcome(Credential credential) {
        try {
            AndroidPushIdentityStorage.State current = storage.load();
            if (current == null
                || (!current.hasServerRegistration()
                    && !current.hasPendingRevocation())) {
                return Outcome.of(Outcome.Kind.CLEANED, Cleanup.NOT_REQUIRED);
            }
            if (credential == null || !credential.canAuthorize(current)) {
                return Outcome.of(
                    Outcome.Kind.CONFLICT,
                    Cleanup.AUTHORITY_UNAVAILABLE
                );
            }
            return Outcome.of(
                Outcome.Kind.CLEANED,
                current.hasPendingRevocation()
                    ? Cleanup.PENDING
                    : Cleanup.NOT_REQUIRED
            );
        } catch (TokenStorageException | RuntimeException exception) {
            return Outcome.of(Outcome.Kind.FAILED);
        }
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
     *
     * <p>A rejected tombstone also frees the slot, so its registration is still
     * removed afterwards instead of being orphaned by another cleanup's dead
     * authority. Only a drain that keeps the tombstone blocks the transition,
     * because the slot holds exactly one retained registration.</p>
     */
    private Outcome retainAndClean(
        Credential credential,
        boolean requiresAuthenticationLogout,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (activeTransaction != null && !activeTransaction.isTerminal()) {
            return publish(Outcome.of(Outcome.Kind.CONFLICT));
        }
        Outcome drained = null;
        Outcome outcome;
        try {
            AndroidPushIdentityStorage.Snapshot observed = storage.snapshot();
            if (observed.state() != null && observed.state().hasPendingRebind()) {
                outcome = Outcome.of(Outcome.Kind.CONFLICT);
            } else {
                if (observed.state() != null
                    && observed.state().hasPendingRevocation()) {
                    drained = Outcome.of(
                        Outcome.Kind.CLEANED,
                        cleanupRetainedRegistration(cancellation)
                    );
                    observed = storage.snapshot();
                }
                outcome = retainAndCleanRemaining(
                    observed,
                    credential,
                    requiresAuthenticationLogout,
                    drained,
                    cancellation
                );
            }
        } catch (TokenStorageException | RuntimeException exception) {
            outcome = Outcome.of(Outcome.Kind.FAILED);
        }
        return publish(outcome);
    }

    /**
     * Resolves the transition once any already retained tombstone was drained.
     *
     * <p>Split out so {@link #retainAndClean} keeps a single exit: a drain that
     * already cleared a retained tombstone must not be reported as if nothing had
     * happened, whatever the remaining steps produce.</p>
     */
    private Outcome retainAndCleanRemaining(
        AndroidPushIdentityStorage.Snapshot observed,
        Credential credential,
        boolean requiresAuthenticationLogout,
        Outcome drained,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        AndroidPushIdentityStorage.State current = observed.state();
        if (drained != null
            && (drained.cleanup() == Cleanup.CANCELLED
                || (current != null && current.hasPendingRevocation()))) {
            return drained;
        }
        if (current == null || !current.hasServerRegistration()) {
            return drained != null
                ? drained
                : Outcome.of(Outcome.Kind.CLEANED, Cleanup.NOT_REQUIRED);
        }
        if (credential == null || !credential.canAuthorize(current)) {
            return Outcome.of(
                Outcome.Kind.CLEANED,
                Cleanup.AUTHORITY_UNAVAILABLE
            );
        }
        storage.retainCurrentRegistrationForRevocation(
            credential.authority,
            requiresAuthenticationLogout,
            observed
        );
        return Outcome.of(
            Outcome.Kind.CLEANED,
            cleanupRetainedRegistration(cancellation)
        );
    }

    /** Maps the revocation coordinator's outcome onto the typed cleanup result. */
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

    /**
     * Records the single terminal outcome of {@code handle} and releases the
     * transition it owned, so a finished handle never blocks a later transition.
     */
    private Outcome terminate(Transaction handle, Outcome outcome) {
        if (handle == activeTransaction) {
            activeTransaction = null;
        }
        handle.terminate(outcome);
        return outcome;
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
