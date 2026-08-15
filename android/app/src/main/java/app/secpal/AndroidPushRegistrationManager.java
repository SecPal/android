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

    interface Backend {
        RegistrationResponse register(
            String apiOrigin,
            String authToken,
            AndroidPushIdentityStorage.State state,
            String lifecycleEvent
        ) throws IOException, NativeAuthHttpException, JSONException;

        int unregister(
            String apiOrigin,
            String authToken,
            String installationId
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
        private final AndroidPushIdentityStorage.State previousState;
        private final String previousBoundApiOrigin;
        private final int previousBoundMetadataRevision;
        private final String previousStatus;
        private final String previousFailureCode;
        private final boolean changed;
        private boolean previousServerRegistrationRevoked;

        RebindResult(
            AndroidPushIdentityStorage.State previousState,
            String previousBoundApiOrigin,
            int previousBoundMetadataRevision,
            String previousStatus,
            String previousFailureCode,
            boolean changed
        ) {
            this.previousState = previousState;
            this.previousBoundApiOrigin = previousBoundApiOrigin;
            this.previousBoundMetadataRevision = previousBoundMetadataRevision;
            this.previousStatus = previousStatus;
            this.previousFailureCode = previousFailureCode;
            this.changed = changed;
        }

        boolean hasPreviousBindingToRevoke() {
            return changed && previousState != null;
        }

        void markPreviousServerRegistrationRevoked() {
            previousServerRegistrationRevoked = true;
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
            storage.clear();
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
            clearRuntime(null);
            try {
                return rebindRuntime(apiOrigin, metadata);
            } catch (TokenStorageException retryFailure) {
                retryFailure.addSuppressed(firstFailure);
                throw retryFailure;
            }
        }
    }

    synchronized RebindResult rebindRuntime(
        String apiOrigin,
        AndroidPushRuntimeMetadata metadata
    ) throws TokenStorageException {
        AndroidPushIdentityStorage.State current = storage.load();
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
            bindRuntime(apiOrigin, metadata);
        } catch (TokenStorageException exception) {
            storage.restore(current);
            boundApiOrigin = previousBoundApiOrigin;
            boundMetadataRevision = previousBoundMetadataRevision;
            setStatus(previousStatus, previousFailureCode);
            throw exception;
        }
        return new RebindResult(
            current,
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
        AndroidPushIdentityStorage.State restoredState = rebind.previousState;
        if (rebind.previousServerRegistrationRevoked && restoredState != null) {
            restoredState = restoredState.withoutServerRegistration();
        }
        storage.restore(restoredState);
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

    synchronized void revokePrevious(RebindResult rebind, String authToken) {
        if (rebind == null
            || !rebind.hasPreviousBindingToRevoke()
            || !rebind.previousState.hasServerRegistration()) {
            return;
        }
        if (!hasAuthToken(authToken)) {
            throw new IllegalStateException(
                "Previous Android push registration requires authentication"
            );
        }
        try {
            int responseStatus = backend.unregister(
                rebind.previousState.apiOrigin(),
                authToken,
                rebind.previousState.installationId()
            );
            if (responseStatus != 200 && responseStatus != 204 && responseStatus != 404) {
                throw new IllegalStateException(
                    "Previous Android push registration revocation was rejected"
                );
            }
            rebind.markPreviousServerRegistrationRevoked();
            AndroidPushIdentityStorage.State current = storage.clearPendingRevocation(
                rebind.previousState.apiOrigin(),
                rebind.previousState.installationId()
            );
            if (!"TOKEN_UNAVAILABLE".equals(failureCode)) {
                setStatus(statusForBoundState(current), null);
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

    synchronized void onTokenReceived(
        String appName,
        String token,
        String authToken
    ) throws TokenStorageException {
        if (!RUNTIME_APP_NAME.equals(appName)
            || boundApiOrigin == null
            || boundMetadataRevision <= 0) {
            return;
        }
        AndroidPushIdentityStorage.State state = storage.recordToken(
            boundApiOrigin,
            boundMetadataRevision,
            token
        );
        sync(state, authToken);
    }

    synchronized void onTokenError(String appName) {
        if (!RUNTIME_APP_NAME.equals(appName)
            || boundApiOrigin == null
            || "awaiting_auth".equals(status)
            || "reconfiguration_required".equals(status)) {
            return;
        }
        setStatus("retry_pending", "TOKEN_UNAVAILABLE");
    }

    synchronized void onAuthenticated(String authToken) throws TokenStorageException {
        sync(storage.load(), authToken);
    }

    synchronized void onLogout(String authToken) throws TokenStorageException {
        boolean disabled = "disabled".equals(status);
        AndroidPushIdentityStorage.State state;
        try {
            state = storage.load();
        } catch (TokenStorageException exception) {
            storage.clear();
            setStatus(disabled ? "disabled" : "unconfigured", null);
            return;
        }
        if (state != null && state.hasPendingRevocation() && hasAuthToken(authToken)) {
            state = retryPendingRevocation(state, authToken);
        }
        if (state != null && hasAuthToken(authToken)) {
            try {
                backend.unregister(
                    state.apiOrigin(),
                    authToken,
                    state.installationId()
                );
            } catch (IOException | NativeAuthHttpException | RuntimeException ignored) {
                // Local logout remains authoritative; retry requires a new authenticated session.
            }
        }
        state = storage.clearServerRegistration();
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

    synchronized void clearRuntime(String authToken) {
        try {
            AndroidPushIdentityStorage.State state = storage.load();
            if (state != null
                && state.hasPendingRevocation()
                && hasAuthToken(authToken)) {
                state = retryPendingRevocation(state, authToken);
            }
            if (state != null && hasAuthToken(authToken)) {
                try {
                    backend.unregister(
                        state.apiOrigin(),
                        authToken,
                        state.installationId()
                    );
                } catch (IOException | NativeAuthHttpException | RuntimeException ignored) {
                    // Runtime clearing remains available offline and after server rejection.
                }
            }
        } catch (TokenStorageException ignored) {
            // Corrupt or unavailable protected state is invalidated below.
        } finally {
            storage.clear();
            boundApiOrigin = null;
            boundMetadataRevision = 0;
            setStatus("unconfigured", null);
        }
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
        if (boundApiOrigin != null
            && !"disabled".equals(status)
            && !"reconfiguration_required".equals(status)) {
            try {
                storage.bindRuntime(boundApiOrigin, boundMetadataRevision);
            } catch (TokenStorageException ignored) {
                // The abstract retry state remains authoritative until storage recovers.
            }
            setStatus("retry_pending", "PUSH_STORAGE_ERROR");
        }
    }

    synchronized void onRegistrationSchedulingError() {
        if (boundApiOrigin != null
            && !"disabled".equals(status)
            && !"reconfiguration_required".equals(status)) {
            setStatus("retry_pending", "REGISTRATION_RETRY_REQUIRED");
        }
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

    private void sync(
        AndroidPushIdentityStorage.State state,
        String authToken
    ) throws TokenStorageException {
        if ("disabled".equals(status)) {
            setStatus("disabled", null);
            return;
        }
        if (state != null && state.isReconfigurationRequired()) {
            setStatus("reconfiguration_required", "RUNTIME_BINDING_REJECTED");
            return;
        }
        if (state == null || state.token() == null) {
            if (state != null && state.hasPendingRevocation()) {
                state = retryPendingRevocation(state, authToken);
                if (state != null && state.hasPendingRevocation()) {
                    return;
                }
            }
            setStatus(boundApiOrigin == null ? "unconfigured" : "awaiting_token", null);
            return;
        }
        if (!hasAuthToken(authToken)) {
            setStatus("awaiting_auth", null);
            return;
        }
        if (state.hasPendingRevocation()) {
            state = retryPendingRevocation(state, authToken);
            if (state == null) {
                setStatus(
                    boundApiOrigin == null ? "unconfigured" : "awaiting_token",
                    null
                );
                return;
            }
            if (state.hasPendingRevocation()) {
                return;
            }
        }
        if (!state.needsRegistration(
            authToken,
            packageVersionName,
            packageVersionCode
        )) {
            setStatus("registered", null);
            return;
        }

        String lifecycleEvent = state.hasServerRegistration()
            ? "credential_rotated"
            : "registered";
        try {
            RegistrationResponse response = backend.register(
                state.apiOrigin(),
                authToken,
                state,
                lifecycleEvent
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
    }

    private AndroidPushIdentityStorage.State retryPendingRevocation(
        AndroidPushIdentityStorage.State state,
        String authToken
    ) throws TokenStorageException {
        if (!state.hasPendingRevocation()) {
            return state;
        }
        if (!state.pendingRevocationApiOrigin().equals(state.apiOrigin())) {
            return storage.clearPendingRevocation(
                state.pendingRevocationApiOrigin(),
                state.pendingRevocationInstallationId()
            );
        }
        if (!hasAuthToken(authToken)) {
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_PENDING");
            return state;
        }
        try {
            int responseStatus = backend.unregister(
                state.pendingRevocationApiOrigin(),
                authToken,
                state.pendingRevocationInstallationId()
            );
            if (responseStatus != 200 && responseStatus != 204 && responseStatus != 404) {
                setStatus("retry_pending", "PREVIOUS_REGISTRATION_REJECTED");
                return state;
            }
            return storage.clearPendingRevocation(
                state.pendingRevocationApiOrigin(),
                state.pendingRevocationInstallationId()
            );
        } catch (IOException exception) {
            setStatus("retry_pending", "NETWORK_UNAVAILABLE");
            return state;
        } catch (NativeAuthHttpException | RuntimeException exception) {
            setStatus("retry_pending", "PREVIOUS_REGISTRATION_FAILED");
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
            String lifecycleEvent
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
            JSObject response = httpClient.request(
                apiOrigin,
                authToken,
                "PUT",
                "/v1/me/notification-installations/" + state.installationId(),
                bodyBase64,
                "application/json",
                "application/json"
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
            String installationId
        ) throws IOException, NativeAuthHttpException {
            JSObject response = httpClient.request(
                apiOrigin,
                authToken,
                "DELETE",
                "/v1/me/notification-installations/" + installationId,
                null,
                null,
                "application/json"
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
