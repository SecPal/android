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

    interface Backend {
        int register(
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

    static final class RebindResult {
        private final AndroidPushIdentityStorage.State previousState;
        private final String previousBoundApiOrigin;
        private final int previousBoundMetadataRevision;
        private final String previousStatus;
        private final String previousFailureCode;
        private final boolean changed;

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
    }

    private final AndroidPushIdentityStorage storage;
    private final Backend backend;
    private volatile String boundApiOrigin;
    private int boundMetadataRevision;
    private volatile String status = "unconfigured";
    private volatile String failureCode;

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
    }

    AndroidPushRegistrationManager(
        AndroidPushIdentityStorage storage,
        Backend backend
    ) {
        this.storage = storage;
        this.backend = backend;
    }

    synchronized void bindRuntime(
        String apiOrigin,
        AndroidPushRuntimeMetadata metadata
    ) throws TokenStorageException {
        if (metadata == null) {
            boundApiOrigin = null;
            boundMetadataRevision = 0;
            storage.clear();
            status = "disabled";
            failureCode = null;
            return;
        }

        boundApiOrigin = apiOrigin.trim();
        boundMetadataRevision = metadata.metadataRevision();
        AndroidPushIdentityStorage.State state = storage.bindRuntime(
            boundApiOrigin,
            boundMetadataRevision
        );
        status = statusForBoundState(state);
        failureCode = null;
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
        boolean sameBinding = metadata == null
            ? current == null
                && previousBoundApiOrigin == null
                && "disabled".equals(previousStatus)
            : current != null
                && current.apiOrigin().equals(apiOrigin.trim())
                && current.metadataRevision() == metadata.metadataRevision();
        try {
            bindRuntime(apiOrigin, metadata);
        } catch (TokenStorageException exception) {
            storage.restore(current);
            boundApiOrigin = previousBoundApiOrigin;
            boundMetadataRevision = previousBoundMetadataRevision;
            status = previousStatus;
            failureCode = previousFailureCode;
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
        storage.restore(rebind.previousState);
        boundApiOrigin = rebind.previousBoundApiOrigin;
        boundMetadataRevision = rebind.previousBoundMetadataRevision;
        status = rebind.previousStatus;
        failureCode = rebind.previousFailureCode;
    }

    synchronized void revokePrevious(RebindResult rebind, String authToken) {
        if (rebind == null
            || !rebind.hasPreviousBindingToRevoke()
            || !hasAuthToken(authToken)) {
            return;
        }
        try {
            backend.unregister(
                rebind.previousState.apiOrigin(),
                authToken,
                rebind.previousState.installationId()
            );
        } catch (IOException | NativeAuthHttpException | RuntimeException ignored) {
            // Local rebinding remains authoritative when old-server cleanup is offline.
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
        if (!RUNTIME_APP_NAME.equals(appName) || boundApiOrigin == null) {
            return;
        }
        status = "retry_pending";
        failureCode = "TOKEN_UNAVAILABLE";
    }

    synchronized void onAuthenticated(String authToken) throws TokenStorageException {
        sync(storage.load(), authToken);
    }

    synchronized void onLogout(String authToken) throws TokenStorageException {
        boolean disabled = "disabled".equals(status);
        AndroidPushIdentityStorage.State state = storage.load();
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
        storage.clearServerRegistration();
        status = disabled
            ? "disabled"
            : (state == null ? "unconfigured" : "awaiting_auth");
        failureCode = null;
    }

    synchronized void clearRuntime(String authToken) {
        try {
            AndroidPushIdentityStorage.State state = storage.load();
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
            status = "unconfigured";
            failureCode = null;
        }
    }

    JSObject getStatus() {
        String statusSnapshot = status;
        String failureCodeSnapshot = failureCode;
        JSObject result = new JSObject();
        result.put("state", statusSnapshot);
        result.put("configured", boundApiOrigin != null);
        result.put("retryable", "retry_pending".equals(statusSnapshot));
        if (failureCodeSnapshot != null) {
            result.put("failureCode", failureCodeSnapshot);
        }
        return result;
    }

    private void sync(
        AndroidPushIdentityStorage.State state,
        String authToken
    ) throws TokenStorageException {
        if ("disabled".equals(status)) {
            failureCode = null;
            return;
        }
        if (state == null || state.token() == null) {
            status = boundApiOrigin == null ? "unconfigured" : "awaiting_token";
            failureCode = null;
            return;
        }
        if (!hasAuthToken(authToken)) {
            status = "awaiting_auth";
            failureCode = null;
            return;
        }
        if (!state.needsRegistration()) {
            status = "registered";
            failureCode = null;
            return;
        }

        String lifecycleEvent = state.hasServerRegistration()
            ? "credential_rotated"
            : "registered";
        try {
            int responseStatus = backend.register(
                state.apiOrigin(),
                authToken,
                state,
                lifecycleEvent
            );
            if (responseStatus == 200 || responseStatus == 201) {
                storage.markRegistered(state);
                status = "registered";
                failureCode = null;
            } else if (responseStatus == 401) {
                status = "awaiting_auth";
                failureCode = "AUTHENTICATION_REQUIRED";
            } else if (responseStatus == 409) {
                status = "reconfiguration_required";
                failureCode = "RUNTIME_BINDING_REJECTED";
            } else {
                status = "retry_pending";
                failureCode = "REGISTRATION_REJECTED";
            }
        } catch (IOException exception) {
            status = "retry_pending";
            failureCode = "NETWORK_UNAVAILABLE";
        } catch (NativeAuthHttpException | JSONException | RuntimeException exception) {
            status = "retry_pending";
            failureCode = "REGISTRATION_FAILED";
        }
    }

    private static boolean hasAuthToken(String token) {
        return token != null && !token.trim().isEmpty();
    }

    private static String statusForBoundState(
        AndroidPushIdentityStorage.State state
    ) {
        if (state.hasServerRegistration() && !state.needsRegistration()) {
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
        public int register(
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
            return response.optInt("status", 0);
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
    }
}
