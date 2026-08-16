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
        AUTHENTICATION_REJECTED
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

        void logout(
            String apiOrigin,
            String authToken,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException, JSONException;
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
        private final boolean changed;
        private boolean previousServerRegistrationRevoked;
        private boolean previousAuthenticationRevoked;

        RebindResult(
            AndroidPushIdentityStorage.Snapshot previousSnapshot,
            String previousBoundApiOrigin,
            int previousBoundMetadataRevision,
            String previousStatus,
            String previousFailureCode,
            boolean changed
        ) {
            this.previousSnapshot = previousSnapshot;
            this.previousBoundApiOrigin = previousBoundApiOrigin;
            this.previousBoundMetadataRevision = previousBoundMetadataRevision;
            this.previousStatus = previousStatus;
            this.previousFailureCode = previousFailureCode;
            this.changed = changed;
        }

        boolean hasPreviousBindingToRevoke() {
            return changed && previousSnapshot.state() != null;
        }

        boolean hasPreviousRevocationAuthority(String fallbackAuthToken) {
            return hasPreviousBindingToRevoke()
                && (hasAuthToken(previousSnapshot.state().pendingRebindAuthToken())
                    || hasAuthToken(fallbackAuthToken));
        }

        String previousRevocationAuthToken(String fallbackAuthToken) {
            return hasAuthToken(previousSnapshot.state().pendingRebindAuthToken())
                ? previousSnapshot.state().pendingRebindAuthToken()
                : fallbackAuthToken;
        }

        void markPreviousServerRegistrationRevoked() {
            previousServerRegistrationRevoked = true;
        }

        void markPreviousAuthenticationRevoked() {
            previousAuthenticationRevoked = true;
        }

        boolean canRestorePreviousCredential() {
            return !previousAuthenticationRevoked;
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
                storage.invalidateCurrentIdentityForTokenRotation();
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
            return rebindRuntime(apiOrigin, metadata);
        } catch (TokenStorageException firstFailure) {
            if (!storage.requiresTokenRotation()) {
                throw firstFailure;
            }
            try {
                return rebindRuntime(apiOrigin, metadata);
            } catch (TokenStorageException retryFailure) {
                retryFailure.addSuppressed(firstFailure);
                throw retryFailure;
            }
        }
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
                    state.pendingRebindAuthToken(),
                    true
                );
            } else {
                storage.invalidateIdentityForTokenRotation();
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
        String requestedApiOrigin = apiOrigin == null ? null : apiOrigin.trim();
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
            !sameBinding
        );
    }

    synchronized void rollbackRebind(RebindResult rebind)
        throws TokenStorageException {
        if (rebind == null || !rebind.changed) {
            return;
        }
        AndroidPushIdentityStorage.State restoredState = rebind.previousSnapshot.state();
        if (rebind.previousServerRegistrationRevoked && restoredState != null) {
            restoredState = restoredState.withoutServerRegistration();
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
        try {
            int responseStatus = backend.unregister(
                rebind.previousSnapshot.state().apiOrigin(),
                revocationAuthToken,
                rebind.previousSnapshot.state().installationId(),
                cancellation
            );
            if (responseStatus != 200 && responseStatus != 204 && responseStatus != 404) {
                throw new IllegalStateException(
                    "Previous Android push registration revocation was rejected"
                );
            }
            rebind.markPreviousServerRegistrationRevoked();
            AndroidPushIdentityStorage.State current = storage.load();
            boolean revokePreviousAuthentication = current != null
                && (current.pendingRevocationRequiresAuthenticationLogout()
                    || !current.apiOrigin().equals(
                        rebind.previousSnapshot.state().apiOrigin()
                    ));
            if (revokePreviousAuthentication) {
                if (!logoutAuthentication(
                    rebind.previousSnapshot.state().apiOrigin(),
                    revocationAuthToken,
                    cancellation
                )) {
                    throw new IllegalStateException(
                        "Previous Android authentication could not be revoked"
                    );
                }
                rebind.markPreviousAuthenticationRevoked();
            }
            if (boundApiOrigin == null) {
                storage.clear();
                setStatus("disabled", null);
            } else {
                current = storage.clearPendingRevocation(
                    rebind.previousSnapshot.state().apiOrigin(),
                    rebind.previousSnapshot.state().installationId()
                );
                if (!"TOKEN_UNAVAILABLE".equals(failureCode)) {
                    setStatus(statusForBoundState(current), null);
                }
            }
        } catch (IOException | NativeAuthHttpException exception) {
            throw new IllegalStateException(
                "Previous Android push registration could not be revoked",
                exception
            );
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
        AndroidPushIdentityStorage.State state = storage.recordToken(
            boundApiOrigin,
            boundMetadataRevision,
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
        if (state == null
            || !state.hasServerRegistration()
            || state.hasPendingRevocation()) {
            return NativeCredentialRollback.NO_OP;
        }
        try {
            if (hasAuthToken(previousAuthToken)) {
                storage.retainCurrentRegistrationForRevocation(
                    previousAuthToken,
                    false
                );
                setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
            } else {
                storage.invalidateIdentityForTokenRotation();
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
            boundApiOrigin,
            authToken,
            new NativeAuthHttpClient.CancellationSignal()
        );
    }

    synchronized void onLogout(
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        onLogout(boundApiOrigin, authToken, cancellation);
    }

    synchronized void onLogout(
        String fallbackApiOrigin,
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) throws TokenStorageException {
        boolean disabled = "disabled".equals(status);
        AndroidPushIdentityStorage.State state;
        try {
            state = storage.load();
        } catch (TokenStorageException exception) {
            setStatus(disabled ? "disabled" : "unconfigured", null);
            logoutAuthentication(fallbackApiOrigin, authToken, cancellation);
            return;
        }
        boolean authenticationRevoked = state != null
            && state.hasPendingRevocation()
            && state.pendingRevocationRequiresAuthenticationLogout()
            && sameAuthToken(state.pendingRevocationAuthToken(), authToken);
        if (state != null && state.hasPendingRevocation()) {
            state = retryPendingRevocation(state, cancellation);
            if (state != null && state.hasPendingRevocation()) {
                String currentApiOrigin = hasAuthToken(fallbackApiOrigin)
                    ? fallbackApiOrigin
                    : state.apiOrigin();
                boolean currentAuthenticationRevoked = logoutAuthentication(
                    currentApiOrigin,
                    authToken,
                    cancellation
                );
                if (currentAuthenticationRevoked
                    && sameAuthToken(
                        state.pendingRevocationAuthToken(),
                        authToken
                    )) {
                    replaceIdentityForTokenRotation(disabled);
                }
                return;
            }
        }
        if (state == null) {
            logoutAuthentication(fallbackApiOrigin, authToken, cancellation);
        }
        if (state != null
            && !authenticationRevoked
            && hasAuthToken(authToken)) {
            boolean serverRegistrationRevoked = !state.hasServerRegistration();
            boolean currentAuthenticationRevoked = false;
            try {
                if (!serverRegistrationRevoked) {
                    serverRegistrationRevoked = isSuccessfulRevocationStatus(
                        backend.unregister(
                            state.apiOrigin(),
                            authToken,
                            state.installationId(),
                            cancellation
                        )
                    );
                }
            } catch (IOException | NativeAuthHttpException | RuntimeException ignored) {
                serverRegistrationRevoked = false;
            }
            currentAuthenticationRevoked = logoutAuthentication(
                state.apiOrigin(),
                authToken,
                cancellation
            );
            if (!serverRegistrationRevoked
                && currentAuthenticationRevoked) {
                replaceIdentityForTokenRotation(disabled);
                return;
            }
            if ((!serverRegistrationRevoked || !currentAuthenticationRevoked)
                && state.hasServerRegistration()) {
                storage.retainCurrentRegistrationForRevocation(authToken, true);
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
            boundApiOrigin,
            authToken,
            new NativeAuthHttpClient.CancellationSignal(),
            false
        );
    }

    synchronized boolean clearRuntime(
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        return clearRuntime(boundApiOrigin, authToken, cancellation, false);
    }

    synchronized boolean clearRuntime(
        String fallbackApiOrigin,
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation,
        boolean oldRuntimeTokenDeleted
    ) {
        try {
            AndroidPushIdentityStorage.State state = storage.load();
            if (state == null) {
                logoutAuthentication(fallbackApiOrigin, authToken, cancellation);
                storage.clear();
                clearRuntimeBinding(true);
                return true;
            }
            String revocationAuthToken = runtimeClearAuthToken(state, authToken);
            boolean authenticationRevoked = state.hasPendingRevocation()
                && state.pendingRevocationRequiresAuthenticationLogout()
                && sameAuthToken(
                    state.pendingRevocationAuthToken(),
                    revocationAuthToken
                );
            if (state.hasPendingRevocation()) {
                if (!hasAuthToken(revocationAuthToken)) {
                    storage.invalidateIdentityForTokenRotation();
                    clearRuntimeBinding(true);
                    return true;
                }
                state = retryPendingRevocation(state, cancellation);
                if (state != null && state.hasPendingRevocation()) {
                    if (oldRuntimeTokenDeleted
                        && logoutAuthentication(
                            state.pendingRevocationApiOrigin(),
                            revocationAuthToken,
                            cancellation
                        )) {
                        storage.clear();
                        clearRuntimeBinding(true);
                        return true;
                    }
                    storage.rotateIdentityForPendingRuntimeClear();
                    clearRuntimeBinding(false);
                    return false;
                }
            }
            if (state != null && state.hasServerRegistration()) {
                if (!hasAuthToken(revocationAuthToken)) {
                    storage.invalidateIdentityForTokenRotation();
                    clearRuntimeBinding(true);
                    return true;
                }
                boolean revoked = false;
                try {
                    int responseStatus = backend.unregister(
                        state.apiOrigin(),
                        revocationAuthToken,
                        state.installationId(),
                        cancellation
                    );
                    revoked = isSuccessfulRevocationStatus(responseStatus);
                } catch (IOException | NativeAuthHttpException | RuntimeException ignored) {
                    // The protected revocation tombstone below owns offline retry.
                }
                if (!revoked) {
                    if (oldRuntimeTokenDeleted
                        && logoutAuthentication(
                            state.apiOrigin(),
                            revocationAuthToken,
                            cancellation
                        )) {
                        storage.clear();
                        clearRuntimeBinding(true);
                        return true;
                    }
                    storage.retainCurrentRegistrationForRevocation(
                        revocationAuthToken,
                        true
                    );
                    clearRuntimeBinding(false);
                    return false;
                }
                if (!logoutAuthentication(
                    state.apiOrigin(),
                    revocationAuthToken,
                    cancellation
                )) {
                    storage.retainCurrentRegistrationForRevocation(
                        revocationAuthToken,
                        true
                    );
                    clearRuntimeBinding(false);
                    return false;
                }
            } else if (state != null
                && !authenticationRevoked
                && hasAuthToken(revocationAuthToken)) {
                try {
                    backend.logout(
                        state.apiOrigin(),
                        revocationAuthToken,
                        cancellation
                    );
                } catch (
                    IOException
                    | JSONException
                    | NativeAuthHttpException
                    | RuntimeException ignored
                ) {
                    // With no server push registration, local reset remains authoritative.
                }
            }
        } catch (TokenStorageException ignored) {
            logoutAuthentication(fallbackApiOrigin, authToken, cancellation);
            clearRuntimeBinding(false);
            return false;
        }
        storage.clear();
        clearRuntimeBinding(true);
        return true;
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

    synchronized boolean requiresTokenRotation() {
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
        if ("disabled".equals(status)) {
            setStatus("disabled", null);
            return SyncResult.COMPLETE;
        }
        if (state != null && state.isReconfigurationRequired()) {
            setStatus("reconfiguration_required", "RUNTIME_BINDING_REJECTED");
            return SyncResult.COMPLETE;
        }
        if (state == null || state.token() == null) {
            if (state != null && state.hasPendingRevocation()) {
                state = retryPendingRevocation(state, cancellation);
                if (state != null && state.hasPendingRevocation()) {
                    return SyncResult.COMPLETE;
                }
            }
            setStatus(boundApiOrigin == null ? "unconfigured" : "awaiting_token", null);
            return SyncResult.COMPLETE;
        }
        if (!hasAuthToken(authToken)) {
            setStatus("awaiting_auth", null);
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
                return SyncResult.COMPLETE;
            }
            if (state.token() == null || state.token().isEmpty()) {
                setStatus("awaiting_token", null);
                return SyncResult.COMPLETE;
            }
        }
        if (!state.needsRegistration(
            authToken,
            packageVersionName,
            packageVersionCode
        )) {
            setStatus("registered", null);
            return SyncResult.COMPLETE;
        }

        String lifecycleEvent = state.hasServerRegistration()
            ? "credential_rotated"
            : "registered";
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
            } else if (responseStatus == 401) {
                setStatus("awaiting_auth", "AUTHENTICATION_REQUIRED");
                return SyncResult.AUTHENTICATION_REJECTED;
            } else if (responseStatus == 409 && response.requiresReconfiguration()) {
                storage.markReconfigurationRequired(state);
                setStatus("reconfiguration_required", "RUNTIME_BINDING_REJECTED");
            } else {
                setStatus("retry_pending", "REGISTRATION_REJECTED");
            }
        } catch (IOException exception) {
            setStatus("retry_pending", "NETWORK_UNAVAILABLE");
        } catch (NativeAuthHttpException | JSONException | RuntimeException exception) {
            setStatus("retry_pending", "REGISTRATION_FAILED");
        }
        return SyncResult.COMPLETE;
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
            storage.invalidateIdentityForTokenRotation();
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
        try {
            int responseStatus = backend.unregister(
                state.pendingRevocationApiOrigin(),
                revocationAuthToken,
                state.pendingRevocationInstallationId(),
                cancellation
            );
            if (cancellation.isCancelled()) {
                return state;
            }
            if (responseStatus == 401 || responseStatus == 403) {
                storage.invalidateIdentityForTokenRotation();
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
            if (responseStatus != 200 && responseStatus != 204 && responseStatus != 404) {
                setStatus("retry_pending", "PREVIOUS_REGISTRATION_REJECTED");
                return state;
            }
            if (state.pendingRevocationRequiresAuthenticationLogout()) {
                if (!logoutAuthentication(
                    state.pendingRevocationApiOrigin(),
                    revocationAuthToken,
                    cancellation
                )) {
                    if (cancellation.isCancelled()) {
                        return state;
                    }
                    setStatus("retry_pending", "PREVIOUS_REGISTRATION_FAILED");
                    return state;
                }
            }
            if (cancellation.isCancelled()) {
                return state;
            }
            return storage.clearPendingRevocation(
                state.pendingRevocationApiOrigin(),
                state.pendingRevocationInstallationId()
            );
        } catch (IOException exception) {
            if (!cancellation.isCancelled()) {
                setStatus("retry_pending", "NETWORK_UNAVAILABLE");
            }
            return state;
        } catch (NativeAuthHttpException | RuntimeException exception) {
            if (!cancellation.isCancelled()) {
                setStatus("retry_pending", "PREVIOUS_REGISTRATION_FAILED");
            }
            return state;
        }
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

    private boolean logoutAuthentication(
        String apiOrigin,
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        if (!hasAuthToken(apiOrigin) || !hasAuthToken(authToken)) {
            return false;
        }
        try {
            backend.logout(apiOrigin, authToken, cancellation);
            return true;
        } catch (NativeAuthHttpException exception) {
            return exception.getStatusCode() == 401
                || exception.getStatusCode() == 403;
        } catch (
            IOException
            | JSONException
            | RuntimeException ignored
        ) {
            // Local logout remains authoritative when remote revocation is unavailable.
            return false;
        }
    }

    private void replaceIdentityForTokenRotation(boolean disabled)
        throws TokenStorageException {
        storage.invalidateIdentityForTokenRotation();
        if (!disabled && boundApiOrigin != null && boundMetadataRevision > 0) {
            storage.bindRuntime(boundApiOrigin, boundMetadataRevision);
            setStatus("awaiting_auth", null);
        } else {
            setStatus(disabled ? "disabled" : "unconfigured", null);
        }
    }

    synchronized void onAuthenticationRejected() throws TokenStorageException {
        boolean disabled = "disabled".equals(status);
        AndroidPushIdentityStorage.State retained =
            storage.invalidateCurrentIdentityForTokenRotation();
        if (disabled) {
            setStatus("disabled", null);
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

    private static String runtimeClearAuthToken(
        AndroidPushIdentityStorage.State state,
        String authToken
    ) {
        if (hasAuthToken(authToken)) {
            return authToken;
        }
        if (state != null && state.hasPendingRebind()) {
            return state.pendingRebindAuthToken();
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

        @Override
        public void logout(
            String apiOrigin,
            String authToken,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException, JSONException {
            httpClient.logout(apiOrigin, authToken, cancellation);
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
