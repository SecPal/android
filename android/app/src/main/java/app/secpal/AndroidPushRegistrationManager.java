/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.content.Context;
import android.util.Base64;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class AndroidPushRegistrationManager {
    static final String RUNTIME_APP_NAME = "secpal-runtime-push";
    private static final String PACKAGE_NAME = "app.secpal";
    private static final String CHANNEL = "android_fcm";
    private static final String INSTALLATION_NAME = "SecPal Android";
    private static final String BOOTSTRAP_VERSION = "v1";
    private static final int SCHEMA_VERSION = 4;
    private static final String RUNTIME_STATE_INVALID =
        "NOTIFICATION_RUNTIME_STATE_INVALID";
    private static final String CHANNEL_UNSUPPORTED =
        "NOTIFICATION_CHANNEL_UNSUPPORTED";

    enum SyncResult {
        COMPLETE,
        AUTHENTICATION_REJECTED,
        RECONFIGURATION_REQUIRED,
        RETRYABLE_FAILURE,
        CANCELLED
    }

    private enum RevocationOutcome {
        REVOKED,
        AUTHORITY_REJECTED,
        REJECTED,
        NETWORK_FAILURE,
        FAILURE,
        CANCELLED
    }

    private static final class RevocationAttempt {
        private final RevocationOutcome outcome;
        private final Exception failure;
        private final boolean requestAttempted;

        private RevocationAttempt(
            RevocationOutcome outcome,
            Exception failure,
            boolean requestAttempted
        ) {
            this.outcome = outcome;
            this.failure = failure;
            this.requestAttempted = requestAttempted;
        }

        private static RevocationAttempt completed(RevocationOutcome outcome) {
            return new RevocationAttempt(outcome, null, true);
        }

        private static RevocationAttempt cancelledBeforeRequest() {
            return new RevocationAttempt(
                RevocationOutcome.CANCELLED,
                null,
                false
            );
        }

        private static RevocationAttempt failed(
            RevocationOutcome outcome,
            Exception failure
        ) {
            return new RevocationAttempt(outcome, failure, true);
        }
    }

    interface Backend {
        RegistrationResponse register(
            String apiOrigin,
            String authToken,
            AndroidPushIdentityStorage.State state,
            String lifecycleEvent,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException, JSONException;

        int unregister(
            String apiOrigin,
            String authToken,
            String installationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException;
    }

    static final class RegistrationResponse {
        private final int status;
        private final String errorCode;

        RegistrationResponse(int status, String errorCode) {
            this.status = status;
            this.errorCode = normalizeErrorCode(errorCode);
        }

        int status() {
            return status;
        }

        String errorCode() {
            return errorCode;
        }

        boolean requiresReconfiguration() {
            return RUNTIME_STATE_INVALID.equals(errorCode)
                || CHANNEL_UNSUPPORTED.equals(errorCode);
        }

        private static String normalizeErrorCode(String value) {
            if (value == null) {
                return null;
            }
            String normalized = value.trim();
            return normalized.isEmpty() ? null : normalized;
        }
    }

    static final class RebindResult {
        private final AndroidPushIdentityStorage.Snapshot previousSnapshot;
        private final String previousBoundApiOrigin;
        private final int previousBoundMetadataRevision;
        private final String previousStatus;
        private final String previousFailureCode;
        private final String nextApiOrigin;
        private final String retainedPreviousAuthToken;
        private final boolean changed;
        private boolean previousServerRegistrationRevoked;
        private boolean previousRegistrationAuthorityRejected;
        private String previousRegistrationStateUncertainAuthToken;

        RebindResult(
            AndroidPushIdentityStorage.Snapshot previousSnapshot,
            String previousBoundApiOrigin,
            int previousBoundMetadataRevision,
            String previousStatus,
            String previousFailureCode,
            String nextApiOrigin,
            String retainedPreviousAuthToken,
            boolean changed
        ) {
            this.previousSnapshot = previousSnapshot;
            this.previousBoundApiOrigin = previousBoundApiOrigin;
            this.previousBoundMetadataRevision = previousBoundMetadataRevision;
            this.previousStatus = previousStatus;
            this.previousFailureCode = previousFailureCode;
            this.nextApiOrigin = nextApiOrigin;
            this.retainedPreviousAuthToken = retainedPreviousAuthToken;
            this.changed = changed;
        }

        boolean hasPreviousBindingToRevoke() {
            return changed && previousSnapshot.state() != null;
        }

        boolean hasPreviousRevocationAuthority(String fallbackAuthToken) {
            return hasPreviousBindingToRevoke()
                && hasAuthToken(previousRevocationAuthToken(fallbackAuthToken));
        }

        String previousRevocationAuthToken(String fallbackAuthToken) {
            if (hasAuthToken(previousSnapshot.state().pendingRebindAuthToken())) {
                return previousSnapshot.state().pendingRebindAuthToken();
            }
            if (hasAuthToken(retainedPreviousAuthToken)) {
                return retainedPreviousAuthToken;
            }
            return previousSnapshot.state().apiOrigin().equals(nextApiOrigin)
                    && hasAuthToken(fallbackAuthToken)
                ? fallbackAuthToken
                : null;
        }

        void markPreviousServerRegistrationRevoked() {
            previousServerRegistrationRevoked = true;
        }

        void markPreviousRegistrationAuthorityRejected() {
            previousRegistrationAuthorityRejected = true;
        }

        void markPreviousRegistrationStateUncertain(String authToken) {
            previousRegistrationStateUncertainAuthToken = authToken;
        }
    }

    private static final class PublicStatus {
        private final String state;
        private final String failureCode;
        private final boolean configured;

        PublicStatus(String state, String failureCode, boolean configured) {
            this.state = state;
            this.failureCode = failureCode;
            this.configured = configured;
        }
    }

    private final AndroidPushIdentityStorage storage;
    private final Backend backend;
    private final String packageVersionName;
    private final long packageVersionCode;
    private String boundApiOrigin;
    private int boundMetadataRevision;
    private String status = "unconfigured";
    private String failureCode;
    private volatile PublicStatus publicStatus = new PublicStatus(
        "unconfigured",
        null,
        false
    );

    AndroidPushRegistrationManager(
        Context context,
        NativeAuthHttpClient httpClient
    ) {
        AndroidRuntimeInfo runtimeInfo = AndroidRuntimeInfo.fromContext(context);
        this.storage = new AndroidPushIdentityStorage(context);
        this.backend = new HttpBackend(
            httpClient,
            runtimeInfo.getPackageVersionName(),
            runtimeInfo.getPackageVersionCode()
        );
        this.packageVersionName = runtimeInfo.getPackageVersionName();
        this.packageVersionCode = runtimeInfo.getPackageVersionCode();
    }

    AndroidPushRegistrationManager(
        AndroidPushIdentityStorage storage,
        Backend backend
    ) {
        this(storage, backend, "test", 0);
    }

    AndroidPushRegistrationManager(
        AndroidPushIdentityStorage storage,
        Backend backend,
        String packageVersionName,
        long packageVersionCode
    ) {
        this.storage = storage;
        this.backend = backend;
        this.packageVersionName = packageVersionName;
        this.packageVersionCode = packageVersionCode;
    }

    synchronized void bindRuntime(
        String apiOrigin,
        AndroidPushRuntimeMetadata metadata
    ) throws TokenStorageException {
        if (metadata == null) {
            AndroidPushIdentityStorage.State current = storage.load();
            boolean preparedDisable = current != null
                && current.hasPendingRebind()
                && current.pendingRebindApiOrigin().equals(apiOrigin);
            boolean canRevokePreviousRegistration = preparedDisable
                && current.hasServerRegistration()
                && hasAuthToken(current.pendingRebindAuthToken());
            boolean hasIdentityToInvalidate = current != null
                && (current.token() != null || current.hasServerRegistration());
            if (!canRevokePreviousRegistration
                && current != null
                && current.hasPendingRevocation()) {
                storage.rotateIdentityPreservingLifecycleState();
            } else if (!canRevokePreviousRegistration
                && (hasIdentityToInvalidate || storage.requiresTokenRotation())) {
                replaceIdentityForTokenRotation(true);
            } else if (!canRevokePreviousRegistration) {
                storage.clear();
            }
            boundApiOrigin = null;
            boundMetadataRevision = 0;
            setStatus("disabled", null);
            return;
        }

        AndroidPushIdentityStorage.State state = storage.bindRuntime(
            apiOrigin,
            metadata.metadataRevision()
        );
        boundApiOrigin = state.apiOrigin();
        boundMetadataRevision = state.metadataRevision();
        if (state.hasPendingRevocation()) {
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
        } else {
            setStatus(statusForBoundState(state), null);
        }
    }

    synchronized RebindResult restoreRuntime(
        String apiOrigin,
        AndroidPushRuntimeMetadata metadata
    ) throws TokenStorageException {
        try {
            return restoreRuntimeOnce(apiOrigin, metadata);
        } catch (TokenStorageException firstFailure) {
            if (!storage.requiresTokenRotation()) {
                throw firstFailure;
            }
            try {
                return restoreRuntimeOnce(apiOrigin, metadata);
            } catch (TokenStorageException retryFailure) {
                retryFailure.addSuppressed(firstFailure);
                throw retryFailure;
            }
        }
    }

    private RebindResult restoreRuntimeOnce(
        String apiOrigin,
        AndroidPushRuntimeMetadata metadata
    ) throws TokenStorageException {
        if (metadata != null) {
            AndroidPushIdentityStorage.State current = storage.load();
            String requestedApiOrigin = AndroidPushIdentityStorage.requireApiOrigin(
                apiOrigin
            );
            if (current != null
                && current.hasPendingRebind()
                && current.apiOrigin().equals(requestedApiOrigin)
                && current.metadataRevision() == metadata.metadataRevision()) {
                storage.cancelPreparedRuntimeRebind(
                    current.pendingRebindApiOrigin()
                );
            }
        }
        return rebindRuntime(apiOrigin, metadata);
    }

    synchronized boolean restorePendingRuntimeClear()
        throws TokenStorageException {
        AndroidPushIdentityStorage.State state;
        try {
            state = storage.load();
        } catch (TokenStorageException exception) {
            if (!storage.requiresTokenRotation()) {
                throw exception;
            }
            boundApiOrigin = null;
            boundMetadataRevision = 0;
            setStatus("unconfigured", null);
            return false;
        }
        boundApiOrigin = null;
        boundMetadataRevision = 0;
        if (state == null) {
            setStatus("unconfigured", null);
            return false;
        }
        if (!state.hasPendingRevocation() && !state.hasServerRegistration()) {
            storage.clear();
            setStatus("unconfigured", null);
            return false;
        }
        if (!state.hasPendingRevocation()) {
            if (hasAuthToken(state.pendingRebindAuthToken())) {
                storage.retainCurrentRegistrationForRevocation(
                    state.pendingRebindAuthToken()
                );
            } else {
                storage.discardIdentityForTokenRotation();
                setStatus("unconfigured", null);
                return false;
            }
        }
        setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
        return true;
    }

    synchronized void prepareRuntimeRebind(
        String nextApiOrigin,
        String previousAuthToken
    ) throws TokenStorageException {
        storage.prepareRuntimeRebind(nextApiOrigin, previousAuthToken);
    }

    synchronized void prepareRuntimeReset(String authToken)
        throws TokenStorageException {
        storage.prepareRuntimeReset(authToken);
    }

    synchronized void retainLegacyInstallationForRevocation(
        String installationId,
        String authToken
    ) throws TokenStorageException {
        storage.retainLegacyInstallationForRevocation(installationId, authToken);
        AndroidPushIdentityStorage.State state = storage.load();
        if (state != null && state.hasPendingRevocation()) {
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
        }
    }

    synchronized void cancelPreparedRuntimeRebind(String expectedApiOrigin)
        throws TokenStorageException {
        storage.cancelPreparedRuntimeRebind(expectedApiOrigin);
    }

    synchronized RebindResult rebindRuntime(
        String apiOrigin,
        AndroidPushRuntimeMetadata metadata
    ) throws TokenStorageException {
        return rebindRuntime(apiOrigin, metadata, null);
    }

    synchronized RebindResult rebindRuntime(
        String apiOrigin,
        AndroidPushRuntimeMetadata metadata,
        String previousAuthToken
    ) throws TokenStorageException {
        AndroidPushIdentityStorage.Snapshot previousSnapshot = storage.snapshot();
        AndroidPushIdentityStorage.State current = previousSnapshot.state();
        String previousBoundApiOrigin = boundApiOrigin;
        int previousBoundMetadataRevision = boundMetadataRevision;
        String previousStatus = status;
        String previousFailureCode = failureCode;
        String requestedApiOrigin = metadata == null
            ? null
            : AndroidPushIdentityStorage.requireApiOrigin(apiOrigin);
        String retainedPreviousAuthToken = null;
        boolean sameBinding = metadata == null
            ? current == null
                && previousBoundApiOrigin == null
                && "disabled".equals(previousStatus)
            : current != null
                && current.apiOrigin().equals(requestedApiOrigin)
                && current.metadataRevision() == metadata.metadataRevision();
        try {
            if (metadata == null) {
                bindRuntime(apiOrigin, null);
            } else {
                AndroidPushIdentityStorage.State state = storage.bindRuntime(
                    apiOrigin,
                    metadata.metadataRevision(),
                    previousAuthToken
                );
                boundApiOrigin = state.apiOrigin();
                boundMetadataRevision = state.metadataRevision();
                if (state.hasPendingRevocation()) {
                    retainedPreviousAuthToken = state.pendingRevocationAuthToken();
                    setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
                } else {
                    setStatus(statusForBoundState(state), null);
                }
            }
        } catch (TokenStorageException exception) {
            storage.restore(previousSnapshot);
            boundApiOrigin = previousBoundApiOrigin;
            boundMetadataRevision = previousBoundMetadataRevision;
            setStatus(previousStatus, previousFailureCode);
            throw exception;
        }
        return new RebindResult(
            previousSnapshot,
            previousBoundApiOrigin,
            previousBoundMetadataRevision,
            previousStatus,
            previousFailureCode,
            requestedApiOrigin,
            retainedPreviousAuthToken,
            !sameBinding
        );
    }

    synchronized void rollbackRebind(RebindResult rebind)
        throws TokenStorageException {
        if (rebind == null || !rebind.changed) {
            return;
        }
        if (rebind.previousRegistrationAuthorityRejected) {
            AndroidPushIdentityStorage.State previousState =
                rebind.previousSnapshot.state();
            rotateAfterRejectedRevocation(
                previousState == null ? null : previousState.apiOrigin(),
                previousState == null ? 0 : previousState.metadataRevision(),
                rebind.previousStatus
            );
            return;
        }
        if (hasAuthToken(rebind.previousRegistrationStateUncertainAuthToken)) {
            AndroidPushIdentityStorage.State previousState =
                rebind.previousSnapshot.state();
            storage.restore(
                rebind.previousSnapshot.withState(
                    previousState == null
                        ? null
                        : previousState.afterRuntimeRebindRolledBack()
                )
            );
            storage.retainCurrentRegistrationForRevocation(
                rebind.previousRegistrationStateUncertainAuthToken
            );
            boundApiOrigin = rebind.previousBoundApiOrigin;
            boundMetadataRevision = rebind.previousBoundMetadataRevision;
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
            return;
        }
        AndroidPushIdentityStorage.State restoredState = rebind.previousSnapshot.state();
        if (rebind.previousServerRegistrationRevoked && restoredState != null) {
            restoredState = restoredState.afterServerRegistrationRevoked();
        } else if (restoredState != null) {
            restoredState = restoredState.afterRuntimeRebindRolledBack();
        }
        storage.restore(rebind.previousSnapshot.withState(restoredState));
        boundApiOrigin = rebind.previousBoundApiOrigin;
        boundMetadataRevision = rebind.previousBoundMetadataRevision;
        if (rebind.previousServerRegistrationRevoked
            && restoredState != null
            && !restoredState.isReconfigurationRequired()) {
            setStatus("retry_pending", "REGISTRATION_RETRY_REQUIRED");
        } else {
            setStatus(rebind.previousStatus, rebind.previousFailureCode);
        }
    }

    synchronized void revokePrevious(
        RebindResult rebind,
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (rebind == null
            || !rebind.hasPreviousBindingToRevoke()
            || !rebind.previousSnapshot.state().hasServerRegistration()) {
            return;
        }
        String revocationAuthToken = rebind.previousRevocationAuthToken(authToken);
        if (!hasAuthToken(revocationAuthToken)) {
            return;
        }
        RevocationAttempt attempt = revokeRegistration(
            rebind.previousSnapshot.state().apiOrigin(),
            revocationAuthToken,
            rebind.previousSnapshot.state().installationId(),
            cancellation
        );
        if (attempt.outcome == RevocationOutcome.CANCELLED) {
            if (attempt.requestAttempted) {
                rebind.markPreviousRegistrationStateUncertain(
                    revocationAuthToken
                );
            }
            return;
        }
        if (attempt.outcome == RevocationOutcome.AUTHORITY_REJECTED) {
            try {
                rotateAfterRejectedRevocation(
                    boundApiOrigin,
                    boundMetadataRevision,
                    boundApiOrigin == null ? "disabled" : "unconfigured"
                );
            } catch (TokenStorageException exception) {
                throw new IllegalStateException(
                    "Previous Android push registration cleanup could not be persisted",
                    exception
                );
            }
            rebind.markPreviousRegistrationAuthorityRejected();
            return;
        }
        if (attempt.outcome == RevocationOutcome.REJECTED) {
            throw new IllegalStateException(
                "Previous Android push registration revocation was rejected"
            );
        }
        if (attempt.outcome != RevocationOutcome.REVOKED) {
            rebind.markPreviousRegistrationStateUncertain(revocationAuthToken);
            throw new IllegalStateException(
                "Previous Android push registration could not be revoked",
                attempt.failure
            );
        }
        try {
            rebind.markPreviousServerRegistrationRevoked();
            if (boundApiOrigin == null) {
                storage.clear();
                setStatus("disabled", null);
            } else {
                AndroidPushIdentityStorage.State current =
                    storage.clearPendingRevocation(
                        rebind.previousSnapshot.state().apiOrigin(),
                        rebind.previousSnapshot.state().installationId()
                    );
                if (isAwaitingPreviousRevocation()) {
                    setStatus(statusForBoundState(current), null);
                }
            }
        } catch (TokenStorageException exception) {
            throw new IllegalStateException(
                "Previous Android push registration cleanup could not be persisted",
                exception
            );
        }
    }

    synchronized SyncResult onTokenReceived(
        String appName,
        String token,
        String authToken
    ) throws TokenStorageException {
        return onTokenReceived(
            appName,
            token,
            authToken,
            new NativeAuthHttpClient.CancellationSignal()
        );
    }

    synchronized SyncResult onTokenReceived(
        String appName,
        String token,
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        if (!RUNTIME_APP_NAME.equals(appName)
            || boundApiOrigin == null
            || boundMetadataRevision <= 0) {
            return SyncResult.COMPLETE;
        }
        AndroidPushIdentityStorage.State state = storage.load();
        if (state == null) {
            return sync(null, authToken, cancellation);
        }
        state = storage.recordToken(
            boundApiOrigin,
            boundMetadataRevision,
            state.installationId(),
            token
        );
        return sync(state, authToken, cancellation);
    }

    synchronized void onTokenError(String appName) {
        if (!RUNTIME_APP_NAME.equals(appName)
            || !canPublishRetryState()) {
            return;
        }
        setStatus("retry_pending", "TOKEN_UNAVAILABLE");
    }

    synchronized SyncResult onAuthenticated(String authToken)
        throws TokenStorageException {
        return onAuthenticated(
            authToken,
            new NativeAuthHttpClient.CancellationSignal()
        );
    }

    synchronized SyncResult onAuthenticated(
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        return sync(storage.load(), authToken, cancellation);
    }

    synchronized NativeCredentialRollback prepareCredentialReplacement(
        String previousAuthToken,
        String nextAuthToken
    ) throws TokenStorageException {
        AndroidPushIdentityStorage.Snapshot snapshot = storage.snapshot();
        String previousStatus = status;
        String previousFailureCode = failureCode;
        if (!hasAuthToken(nextAuthToken)
            || sameAuthToken(previousAuthToken, nextAuthToken)) {
            return NativeCredentialRollback.NO_OP;
        }
        AndroidPushIdentityStorage.State state = snapshot.state();
        if (state == null || !state.hasServerRegistration()) {
            return NativeCredentialRollback.NO_OP;
        }
        try {
            if (state.hasPendingRevocation()) {
                storage.rotateIdentityPreservingLifecycleState();
                setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
            } else if (hasAuthToken(previousAuthToken)) {
                storage.retainCurrentRegistrationForRevocation(
                    previousAuthToken
                );
                setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
            } else {
                storage.discardIdentityForTokenRotation();
                if (boundApiOrigin != null && boundMetadataRevision > 0) {
                    storage.bindRuntime(boundApiOrigin, boundMetadataRevision);
                    setStatus("awaiting_token", null);
                } else {
                    setStatus("unconfigured", null);
                }
            }
        } catch (TokenStorageException exception) {
            try {
                storage.restore(snapshot);
                setStatus(previousStatus, previousFailureCode);
            } catch (TokenStorageException rollbackException) {
                exception.addSuppressed(rollbackException);
            }
            throw exception;
        }
        return () -> rollbackCredentialReplacement(
            snapshot,
            previousStatus,
            previousFailureCode
        );
    }

    private synchronized void rollbackCredentialReplacement(
        AndroidPushIdentityStorage.Snapshot snapshot,
        String previousStatus,
        String previousFailureCode
    ) throws TokenStorageException {
        storage.restore(snapshot);
        setStatus(previousStatus, previousFailureCode);
    }

    synchronized void onLogout(String authToken) throws TokenStorageException {
        onLogout(
            authToken,
            new NativeAuthHttpClient.CancellationSignal()
        );
    }

    synchronized void onLogout(
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        if (cancellation.isCancelled()) {
            return;
        }
        boolean disabled = "disabled".equals(status);
        AndroidPushIdentityStorage.State state;
        try {
            state = storage.load();
        } catch (TokenStorageException exception) {
            boundApiOrigin = null;
            boundMetadataRevision = 0;
            setStatus(disabled ? "disabled" : "unconfigured", null);
            return;
        }
        if (state != null && state.hasPendingRevocation()) {
            state = retryPendingRevocation(state, cancellation);
            if (cancellation.isCancelled()) {
                publishRetainedStateAfterCancelledCleanup(state, disabled);
                return;
            }
            if (state != null && state.hasPendingRevocation()) {
                return;
            }
        }
        if (state != null && state.hasServerRegistration()) {
            String revocationAuthToken =
                state.resolveCurrentRegistrationRevocationAuthToken(authToken);
            if (!hasAuthToken(revocationAuthToken)) {
                replaceIdentityForTokenRotation(disabled);
                return;
            }
            RevocationAttempt attempt = revokeRegistration(
                state.apiOrigin(),
                revocationAuthToken,
                state.installationId(),
                cancellation
            );
            if (attempt.outcome == RevocationOutcome.CANCELLED) {
                if (attempt.requestAttempted) {
                    storage.retainCurrentRegistrationForRevocation(
                        revocationAuthToken
                    );
                    setStatus(
                        "retry_pending",
                        "PREVIOUS_REGISTRATION_PENDING"
                    );
                }
                return;
            }
            if (attempt.outcome == RevocationOutcome.AUTHORITY_REJECTED) {
                rotateAfterRejectedRevocation(
                    disabled ? null : boundApiOrigin,
                    disabled ? 0 : boundMetadataRevision,
                    disabled ? "disabled" : "unconfigured"
                );
                return;
            }
            if (attempt.outcome != RevocationOutcome.REVOKED) {
                storage.retainCurrentRegistrationForRevocation(
                    revocationAuthToken
                );
                setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
                return;
            }
        }
        state = storage.clearRegistrationAuthority();
        if (state != null && state.isReconfigurationRequired()) {
            setStatus("reconfiguration_required", "RUNTIME_BINDING_REJECTED");
        } else {
            setStatus(
                disabled
                    ? "disabled"
                    : (state == null ? "unconfigured" : "awaiting_auth"),
                null
            );
        }
    }

    synchronized boolean clearRuntime(String authToken) {
        return clearRuntime(
            authToken,
            new NativeAuthHttpClient.CancellationSignal()
        );
    }

    synchronized boolean clearRuntime(
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (cancellation.isCancelled()) {
            return false;
        }
        boolean disabled = "disabled".equals(status);
        try {
            AndroidPushIdentityStorage.State state = storage.load();
            if (state == null) {
                storage.clear();
                clearRuntimeBinding(true);
                return true;
            }
            String revocationAuthToken = runtimeClearAuthToken(state, authToken);
            if (state.hasPendingRevocation()) {
                if (!hasAuthToken(revocationAuthToken)) {
                    storage.discardIdentityForTokenRotation();
                    clearRuntimeBinding(true);
                    return true;
                }
                state = retryPendingRevocation(state, cancellation);
                if (cancellation.isCancelled()) {
                    publishRetainedStateAfterCancelledCleanup(state, disabled);
                    return false;
                }
                if (state != null && state.hasPendingRevocation()) {
                    storage.rotateIdentityForPendingRuntimeClear();
                    clearRuntimeBinding(false);
                    return false;
                }
            }
            if (state != null && state.hasServerRegistration()) {
                if (!hasAuthToken(revocationAuthToken)) {
                    storage.discardIdentityForTokenRotation();
                    clearRuntimeBinding(true);
                    return true;
                }
                RevocationAttempt attempt = revokeRegistration(
                    state.apiOrigin(),
                    revocationAuthToken,
                    state.installationId(),
                    cancellation
                );
                if (attempt.outcome == RevocationOutcome.CANCELLED) {
                    if (attempt.requestAttempted) {
                        storage.retainCurrentRegistrationForRevocation(
                            revocationAuthToken
                        );
                        setStatus(
                            "retry_pending",
                            "PREVIOUS_REGISTRATION_PENDING"
                        );
                    }
                    return false;
                }
                if (attempt.outcome == RevocationOutcome.AUTHORITY_REJECTED) {
                    storage.discardIdentityForTokenRotation();
                    clearRuntimeBinding(true);
                    return true;
                }
                if (attempt.outcome != RevocationOutcome.REVOKED) {
                    storage.retainCurrentRegistrationForRevocation(
                        revocationAuthToken
                    );
                    clearRuntimeBinding(false);
                    return false;
                }
            }
            if (storage.requiresTokenRotation()) {
                storage.discardIdentityForTokenRotation();
            } else {
                storage.clear();
            }
            clearRuntimeBinding(true);
            return true;
        } catch (TokenStorageException ignored) {
            clearRuntimeBinding(false);
            return false;
        }
    }

    private void clearRuntimeBinding(boolean cleanupComplete) {
        boundApiOrigin = null;
        boundMetadataRevision = 0;
        setStatus(
            cleanupComplete ? "unconfigured" : "retry_pending",
            cleanupComplete ? null : "PREVIOUS_REGISTRATION_PENDING"
        );
    }

    JSObject getStatus() {
        PublicStatus snapshot = publicStatus;
        JSObject result = new JSObject();
        result.put("state", snapshot.state);
        result.put("configured", snapshot.configured);
        result.put("retryable", "retry_pending".equals(snapshot.state));
        if (snapshot.failureCode != null) {
            result.put("failureCode", snapshot.failureCode);
        }
        return result;
    }

    synchronized void onProtectedStateError() {
        if (canPublishRetryState()) {
            try {
                storage.bindRuntime(boundApiOrigin, boundMetadataRevision);
            } catch (TokenStorageException ignored) {
                // The abstract retry state remains authoritative until storage recovers.
            }
            setStatus("retry_pending", "PUSH_STORAGE_ERROR");
        }
    }

    synchronized void onRegistrationSchedulingError() {
        if (canPublishRetryState()) {
            setStatus("retry_pending", "REGISTRATION_RETRY_REQUIRED");
        }
    }

    private boolean canPublishRetryState() {
        return boundApiOrigin != null
            && !"disabled".equals(status)
            && !"reconfiguration_required".equals(status)
            && !"awaiting_auth".equals(status);
    }

    synchronized boolean requiresTokenRotation() throws TokenStorageException {
        return storage.requiresTokenRotation();
    }

    synchronized boolean requiresOldRuntimeTokenDeletion()
        throws TokenStorageException {
        AndroidPushIdentityStorage.State state = storage.load();
        return storage.requiresTokenRotation()
            || (state != null
                && (state.hasServerRegistration() || state.hasPendingRevocation()));
    }

    synchronized boolean prepareRetry() throws TokenStorageException {
        if ("reconfiguration_required".equals(status)
            || "disabled".equals(status)
            || boundApiOrigin == null
            || boundMetadataRevision <= 0) {
            return false;
        }
        if (storage.load() == null) {
            storage.bindRuntime(boundApiOrigin, boundMetadataRevision);
        }
        return true;
    }

    synchronized boolean hasPendingRevocationAuthority()
        throws TokenStorageException {
        AndroidPushIdentityStorage.State state = storage.load();
        if (state == null || !state.hasPendingRevocation()) {
            return false;
        }
        return hasAuthToken(state.pendingRevocationAuthToken());
    }

    private SyncResult sync(
        AndroidPushIdentityStorage.State state,
        String authToken
    ) throws TokenStorageException {
        return sync(
            state,
            authToken,
            new NativeAuthHttpClient.CancellationSignal()
        );
    }

    private SyncResult sync(
        AndroidPushIdentityStorage.State state,
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        if (cancellation.isCancelled()) {
            return SyncResult.CANCELLED;
        }
        if ("disabled".equals(status)) {
            setStatus("disabled", null);
            return SyncResult.COMPLETE;
        }
        if (state != null && state.isReconfigurationRequired()) {
            setStatus("reconfiguration_required", "RUNTIME_BINDING_REJECTED");
            return SyncResult.RECONFIGURATION_REQUIRED;
        }
        if (state == null || state.token() == null) {
            if (state != null && state.hasPendingRevocation()) {
                state = retryPendingRevocation(state, cancellation);
                if (state != null && state.hasPendingRevocation()) {
                    return cancellation.isCancelled()
                        ? SyncResult.CANCELLED
                        : SyncResult.RETRYABLE_FAILURE;
                }
            }
            setStatus(boundApiOrigin == null ? "unconfigured" : "awaiting_token", null);
            return SyncResult.COMPLETE;
        }
        if (state.hasPendingRevocation()) {
            state = retryPendingRevocation(state, cancellation);
            if (state == null) {
                setStatus(
                    boundApiOrigin == null ? "unconfigured" : "awaiting_token",
                    null
                );
                return SyncResult.COMPLETE;
            }
            if (state.hasPendingRevocation()) {
                return cancellation.isCancelled()
                    ? SyncResult.CANCELLED
                    : SyncResult.RETRYABLE_FAILURE;
            }
            if (state.token() == null || state.token().isEmpty()) {
                setStatus("awaiting_token", null);
                return SyncResult.COMPLETE;
            }
        }
        if (!hasAuthToken(authToken)) {
            setStatus("awaiting_auth", null);
            return SyncResult.COMPLETE;
        }
        if (!state.needsRegistration(
            authToken,
            packageVersionName,
            packageVersionCode
        )) {
            setStatus("registered", null);
            return SyncResult.COMPLETE;
        }

        String lifecycleEvent = registrationLifecycleEvent(state);
        try {
            RegistrationResponse response = backend.register(
                state.apiOrigin(),
                authToken,
                state,
                lifecycleEvent,
                cancellation
            );
            int responseStatus = response.status();
            if (responseStatus == 200 || responseStatus == 201) {
                storage.markRegistered(
                    state,
                    authToken,
                    packageVersionName,
                    packageVersionCode
                );
                setStatus("registered", null);
                return SyncResult.COMPLETE;
            } else if (responseStatus == 401) {
                setStatus("awaiting_auth", "AUTHENTICATION_REQUIRED");
                return SyncResult.AUTHENTICATION_REJECTED;
            } else if (responseStatus == 409 && response.requiresReconfiguration()) {
                storage.markReconfigurationRequired(state);
                setStatus("reconfiguration_required", "RUNTIME_BINDING_REJECTED");
                return SyncResult.RECONFIGURATION_REQUIRED;
            } else {
                setStatus("retry_pending", "REGISTRATION_REJECTED");
                return SyncResult.RETRYABLE_FAILURE;
            }
        } catch (NativeAuthHttpClient.NativeAuthCancelledException exception) {
            return SyncResult.CANCELLED;
        } catch (IOException exception) {
            setStatus("retry_pending", "NETWORK_UNAVAILABLE");
            return SyncResult.RETRYABLE_FAILURE;
        } catch (NativeAuthHttpException exception) {
            if (exception.getStatusCode() == 401) {
                setStatus("awaiting_auth", "AUTHENTICATION_REQUIRED");
                return SyncResult.AUTHENTICATION_REJECTED;
            }
            setStatus("retry_pending", "REGISTRATION_FAILED");
            return SyncResult.RETRYABLE_FAILURE;
        } catch (JSONException | RuntimeException exception) {
            setStatus("retry_pending", "REGISTRATION_FAILED");
            return SyncResult.RETRYABLE_FAILURE;
        }
    }

    private AndroidPushIdentityStorage.State retryPendingRevocation(
        AndroidPushIdentityStorage.State state,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        if (!state.hasPendingRevocation() || cancellation.isCancelled()) {
            return state;
        }
        String revocationAuthToken = state.pendingRevocationAuthToken();
        if (!hasAuthToken(revocationAuthToken)) {
            storage.discardIdentityForTokenRotation();
            if (boundApiOrigin == null || boundMetadataRevision <= 0) {
                setStatus("unconfigured", null);
                return null;
            }
            AndroidPushIdentityStorage.State replacement = storage.bindRuntime(
                boundApiOrigin,
                boundMetadataRevision
            );
            setStatus("awaiting_token", null);
            return replacement;
        }
        RevocationAttempt attempt = revokeRegistration(
            state.pendingRevocationApiOrigin(),
            revocationAuthToken,
            state.pendingRevocationInstallationId(),
            cancellation
        );
        if (attempt.outcome == RevocationOutcome.CANCELLED) {
            return state;
        }
        if (attempt.outcome == RevocationOutcome.AUTHORITY_REJECTED) {
            storage.discardIdentityForTokenRotation();
            if (boundApiOrigin == null || boundMetadataRevision <= 0) {
                setStatus("unconfigured", null);
                return null;
            }
            AndroidPushIdentityStorage.State replacement = storage.bindRuntime(
                boundApiOrigin,
                boundMetadataRevision
            );
            setStatus("awaiting_token", null);
            return replacement;
        }
        if (attempt.outcome == RevocationOutcome.REJECTED) {
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_REJECTED");
            return state;
        }
        if (attempt.outcome == RevocationOutcome.NETWORK_FAILURE) {
            setStatus("retry_pending", "NETWORK_UNAVAILABLE");
            return state;
        }
        if (attempt.outcome == RevocationOutcome.FAILURE) {
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_FAILED");
            return state;
        }
        if (attempt.outcome == RevocationOutcome.REVOKED) {
            return storage.clearPendingRevocation(
                state.pendingRevocationApiOrigin(),
                state.pendingRevocationInstallationId()
            );
        }
        throw new IllegalStateException("Unknown Android push revocation outcome");
    }

    private void setStatus(String nextStatus, String nextFailureCode) {
        status = nextStatus;
        failureCode = nextFailureCode;
        publicStatus = new PublicStatus(
            nextStatus,
            nextFailureCode,
            boundApiOrigin != null
        );
    }

    private static boolean hasAuthToken(String token) {
        return token != null && !token.trim().isEmpty();
    }

    private void replaceIdentityForTokenRotation(boolean disabled)
        throws TokenStorageException {
        storage.discardIdentityForTokenRotation();
        if (!disabled && boundApiOrigin != null && boundMetadataRevision > 0) {
            storage.bindRuntime(boundApiOrigin, boundMetadataRevision);
            setStatus("awaiting_auth", null);
        } else {
            setStatus(disabled ? "disabled" : "unconfigured", null);
        }
    }

    private void rotateAfterRejectedRevocation(
        String apiOrigin,
        int metadataRevision,
        String unboundStatus
    ) throws TokenStorageException {
        storage.discardIdentityForTokenRotation();
        boundApiOrigin = apiOrigin;
        boundMetadataRevision = metadataRevision;
        if (apiOrigin != null && metadataRevision > 0) {
            storage.bindRuntime(apiOrigin, metadataRevision);
            setStatus("awaiting_token", null);
        } else {
            setStatus(unboundStatus, null);
        }
    }

    synchronized void onAuthenticationRejected() throws TokenStorageException {
        boolean disabled = "disabled".equals(status);
        AndroidPushIdentityStorage.State retained =
            storage.rotateIdentityPreservingLifecycleState();
        if (disabled) {
            setStatus("disabled", null);
        } else if (retained != null && retained.isReconfigurationRequired()) {
            setStatus("reconfiguration_required", "RUNTIME_BINDING_REJECTED");
        } else if (retained != null && retained.hasPendingRevocation()) {
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
        } else if (boundApiOrigin != null && boundMetadataRevision > 0) {
            storage.bindRuntime(boundApiOrigin, boundMetadataRevision);
            setStatus("awaiting_auth", null);
        } else {
            setStatus("unconfigured", null);
        }
    }

    private static boolean sameAuthToken(String left, String right) {
        return hasAuthToken(left)
            && hasAuthToken(right)
            && left.trim().equals(right.trim());
    }

    private static boolean isSuccessfulRevocationStatus(int status) {
        return status == 200 || status == 204 || status == 404;
    }

    private RevocationAttempt revokeRegistration(
        String apiOrigin,
        String authToken,
        String installationId,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (cancellation.isCancelled()) {
            return RevocationAttempt.cancelledBeforeRequest();
        }
        try {
            int responseStatus = backend.unregister(
                apiOrigin,
                authToken,
                installationId,
                cancellation
            );
            return RevocationAttempt.completed(
                revocationOutcomeForStatus(responseStatus)
            );
        } catch (NativeAuthHttpClient.NativeAuthCancelledException exception) {
            return RevocationAttempt.completed(RevocationOutcome.CANCELLED);
        } catch (IOException exception) {
            return cancellation.isCancelled()
                ? RevocationAttempt.completed(RevocationOutcome.CANCELLED)
                : RevocationAttempt.failed(
                    RevocationOutcome.NETWORK_FAILURE,
                    exception
                );
        } catch (NativeAuthHttpException exception) {
            int statusCode = exception.getStatusCode();
            if (statusCode > 0) {
                return RevocationAttempt.completed(
                    revocationOutcomeForStatus(statusCode)
                );
            }
            return cancellation.isCancelled()
                ? RevocationAttempt.completed(RevocationOutcome.CANCELLED)
                : RevocationAttempt.failed(RevocationOutcome.FAILURE, exception);
        } catch (RuntimeException exception) {
            return cancellation.isCancelled()
                ? RevocationAttempt.completed(RevocationOutcome.CANCELLED)
                : RevocationAttempt.failed(RevocationOutcome.FAILURE, exception);
        }
    }

    private static RevocationOutcome revocationOutcomeForStatus(int status) {
        if (isSuccessfulRevocationStatus(status)) {
            return RevocationOutcome.REVOKED;
        }
        if (status == 401 || status == 403) {
            return RevocationOutcome.AUTHORITY_REJECTED;
        }
        return RevocationOutcome.REJECTED;
    }

    private boolean isAwaitingPreviousRevocation() {
        return "retry_pending".equals(status)
            && "PREVIOUS_REGISTRATION_PENDING".equals(failureCode);
    }

    private void publishRetainedStateAfterCancelledCleanup(
        AndroidPushIdentityStorage.State state,
        boolean disabled
    ) {
        if (state != null && state.hasPendingRevocation()) {
            return;
        }
        if (disabled) {
            setStatus("disabled", null);
            return;
        }
        if (state == null) {
            setStatus(
                boundApiOrigin == null ? "unconfigured" : "awaiting_token",
                null
            );
            return;
        }
        setStatus(statusForBoundState(state), null);
    }

    private static String registrationLifecycleEvent(
        AndroidPushIdentityStorage.State state
    ) {
        if (!state.hasServerRegistration()) {
            return "registered";
        }
        return state.hasTokenChangedSinceRegistration()
            ? "credential_rotated"
            : "client_updated";
    }

    private static String runtimeClearAuthToken(
        AndroidPushIdentityStorage.State state,
        String authToken
    ) throws TokenStorageException {
        if (state != null && state.hasPendingRebind()) {
            String revocationAuthToken =
                state.resolveCurrentRegistrationRevocationAuthToken(authToken);
            if (hasAuthToken(revocationAuthToken)) {
                return revocationAuthToken;
            }
            if (!state.apiOrigin().equals(state.pendingRebindApiOrigin())) {
                return null;
            }
        }
        if (hasAuthToken(authToken)) {
            return authToken;
        }
        if (state != null
            && state.hasPendingRevocation()
            && hasAuthToken(state.pendingRevocationAuthToken())) {
            return state.pendingRevocationAuthToken();
        }
        return null;
    }

    private static String statusForBoundState(
        AndroidPushIdentityStorage.State state
    ) {
        if (state.isReconfigurationRequired()) {
            return "reconfiguration_required";
        }
        if (state.hasServerRegistration()) {
            return "registered";
        }
        return state.token() == null ? "awaiting_token" : "awaiting_auth";
    }

    static final class HttpBackend implements Backend {
        private final NativeAuthHttpClient httpClient;
        private final String packageVersionName;
        private final long packageVersionCode;

        HttpBackend(
            NativeAuthHttpClient httpClient,
            String packageVersionName,
            long packageVersionCode
        ) {
            this.httpClient = httpClient;
            this.packageVersionName = packageVersionName;
            this.packageVersionCode = packageVersionCode;
        }

        @Override
        public RegistrationResponse register(
            String apiOrigin,
            String authToken,
            AndroidPushIdentityStorage.State state,
            String lifecycleEvent,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException, JSONException {
            JSONObject body = new JSONObject()
                .put("channel", CHANNEL)
                .put("installation_name", INSTALLATION_NAME)
                .put("lifecycle_event", lifecycleEvent)
                .put(
                    "registration",
                    new JSONObject()
                        .put("push_token", state.token())
                        .put(
                            "app",
                            new JSONObject()
                                .put("package_name", PACKAGE_NAME)
                                .put("package_version_name", packageVersionName)
                                .put("package_version_code", packageVersionCode)
                        )
                )
                .put(
                    "runtime",
                    new JSONObject()
                        .put("bootstrap_version", BOOTSTRAP_VERSION)
                        .put("schema_version", SCHEMA_VERSION)
                        .put("metadata_revision", state.metadataRevision())
                );
            String bodyBase64 = Base64.encodeToString(
                body.toString().getBytes(StandardCharsets.UTF_8),
                Base64.NO_WRAP
            );
            JSObject response = httpClient.requestAuxiliaryJson(
                apiOrigin,
                authToken,
                "PUT",
                "/v1/me/notification-installations/" + state.installationId(),
                bodyBase64,
                "application/json",
                "application/json",
                cancellation
            );
            return new RegistrationResponse(
                response.optInt("status", 0),
                decodeErrorCode(response)
            );
        }

        @Override
        public int unregister(
            String apiOrigin,
            String authToken,
            String installationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException {
            JSObject response = httpClient.requestAuxiliaryJson(
                apiOrigin,
                authToken,
                "DELETE",
                "/v1/me/notification-installations/" + installationId,
                null,
                null,
                "application/json",
                cancellation
            );
            return response.optInt("status", 0);
        }

        private static String decodeErrorCode(JSObject response) {
            String bodyBase64 = response.optString("bodyBase64", null);
            if (bodyBase64 == null || bodyBase64.trim().isEmpty()) {
                return null;
            }
            try {
                String body = new String(
                    Base64.decode(bodyBase64, Base64.DEFAULT),
                    StandardCharsets.UTF_8
                );
                return new JSONObject(body).optString("code", null);
            } catch (IllegalArgumentException | JSONException exception) {
                return null;
            }
        }
    }
}
