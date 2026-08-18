/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.util.Base64;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Synchronizes one runtime-bound native FCM identity with its server installation.
 *
 * <p>This coordinator deliberately owns no revocation, runtime-rebind, logout, or
 * authentication-session transitions. Its publisher receives only abstract state;
 * registration identity and request data remain inside native collaborators.</p>
 */
final class AndroidPushRegistrationCoordinator {
    enum LifecycleEvent {
        UNCHANGED(null),
        REGISTERED("registered"),
        CREDENTIAL_ROTATED("credential_rotated"),
        CLIENT_UPDATED("client_updated");

        private final String wireValue;

        LifecycleEvent(String wireValue) {
            this.wireValue = wireValue;
        }

        String wireValue() {
            return wireValue;
        }
    }

    enum Status {
        SYNCHRONIZED,
        AUTHENTICATION_REJECTED,
        RECONFIGURATION_REQUIRED,
        RETRY_PENDING,
        CANCELLED
    }

    interface StatusPublisher {
        void publish(Status status);
    }

    interface Transport {
        Response put(
            String apiOrigin,
            String authority,
            String installationId,
            JSONObject requestPayload,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException;

        final class Response {
            private final int statusCode;
            private final String errorCode;

            Response(int statusCode, String errorCode) {
                this.statusCode = statusCode;
                this.errorCode = errorCode;
            }

            int statusCode() {
                return statusCode;
            }

            String errorCode() {
                return errorCode;
            }
        }
    }

    static final class Outcome {
        enum Kind {
            SUCCESS(Status.SYNCHRONIZED),
            AUTHENTICATION_REJECTED(Status.AUTHENTICATION_REJECTED),
            RECONFIGURATION_REQUIRED(Status.RECONFIGURATION_REQUIRED),
            RETRYABLE_FAILURE(Status.RETRY_PENDING),
            CANCELLED(Status.CANCELLED);

            private final Status status;

            Kind(Status status) {
                this.status = status;
            }
        }

        private final Kind kind;
        private final LifecycleEvent lifecycleEvent;

        private Outcome(Kind kind, LifecycleEvent lifecycleEvent) {
            this.kind = kind;
            this.lifecycleEvent = lifecycleEvent;
        }

        static Outcome success(LifecycleEvent lifecycleEvent) {
            return new Outcome(Kind.SUCCESS, lifecycleEvent);
        }

        static Outcome of(Kind kind) {
            return new Outcome(kind, null);
        }

        Kind kind() {
            return kind;
        }

        LifecycleEvent lifecycleEvent() {
            return lifecycleEvent;
        }

        Status status() {
            return kind.status;
        }
    }

    static final class ClientMetadata {
        private final String installationName;
        private final String packageName;
        private final String packageVersionName;
        private final long packageVersionCode;
        private final String manufacturer;
        private final String model;
        private final String androidVersion;
        private final int sdkInt;
        private final String bootstrapVersion;
        private final int schemaVersion;

        ClientMetadata(
            String installationName,
            String packageName,
            String packageVersionName,
            long packageVersionCode,
            String manufacturer,
            String model,
            String androidVersion,
            int sdkInt,
            String bootstrapVersion,
            int schemaVersion
        ) {
            this.installationName = requireText(
                installationName,
                "installationName"
            );
            this.packageName = requireText(packageName, "packageName");
            this.packageVersionName = requireText(
                packageVersionName,
                "packageVersionName"
            );
            if (packageVersionCode <= 0) {
                throw new IllegalArgumentException("packageVersionCode");
            }
            this.packageVersionCode = packageVersionCode;
            this.manufacturer = normalizeText(manufacturer);
            this.model = normalizeText(model);
            this.androidVersion = requireText(androidVersion, "androidVersion");
            if (sdkInt <= 0) {
                throw new IllegalArgumentException("sdkInt");
            }
            this.sdkInt = sdkInt;
            this.bootstrapVersion = requireText(
                bootstrapVersion,
                "bootstrapVersion"
            );
            if (schemaVersion <= 0) {
                throw new IllegalArgumentException("schemaVersion");
            }
            this.schemaVersion = schemaVersion;
        }

        JSONObject requestPayload(
            AndroidPushIdentityStorage.State state,
            LifecycleEvent lifecycleEvent
        ) throws JSONException {
            return new JSONObject()
                .put("channel", "android_fcm")
                .put("installation_name", installationName)
                .put("lifecycle_event", lifecycleEvent.wireValue())
                .put("runtime", new JSONObject()
                    .put("bootstrap_version", bootstrapVersion)
                    .put("schema_version", schemaVersion)
                    .put("metadata_revision", state.metadataRevision()))
                .put("registration", new JSONObject()
                    .put("push_token", state.token())
                    .put("app", new JSONObject()
                        .put("package_name", packageName)
                        .put("package_version_name", packageVersionName)
                        .put("package_version_code", packageVersionCode))
                    .put("device", new JSONObject()
                        .put("manufacturer", manufacturer)
                        .put("model", model)
                        .put("android_version", androidVersion)
                        .put("sdk_int", sdkInt)));
        }

        private static String requireText(String value, String field) {
            String normalized = normalizeText(value);
            if (normalized.isEmpty()) {
                throw new IllegalArgumentException(field);
            }
            return normalized;
        }

        private static String normalizeText(String value) {
            return value == null ? "" : value.trim();
        }
    }

    static final class NativeTransport implements Transport {
        private final NativeAuthHttpClient httpClient;

        NativeTransport(NativeAuthHttpClient httpClient) {
            this.httpClient = httpClient;
        }

        @Override
        public Response put(
            String apiOrigin,
            String authority,
            String installationId,
            JSONObject requestPayload,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException {
            String requestBodyBase64 = Base64.encodeToString(
                requestPayload.toString().getBytes(StandardCharsets.UTF_8),
                Base64.NO_WRAP
            );
            JSObject response = httpClient.requestAuxiliaryJson(
                apiOrigin,
                authority,
                "PUT",
                "/v1/me/notification-installations/" + installationId,
                requestBodyBase64,
                "application/json",
                "application/json",
                cancellation
            );
            Integer statusCode = response.getInteger("status");
            return new Response(
                statusCode == null ? 0 : statusCode,
                decodeErrorCode(response.getString("bodyBase64"))
            );
        }

        private static String decodeErrorCode(String responseBodyBase64) {
            if (responseBodyBase64 == null || responseBodyBase64.isEmpty()) {
                return null;
            }
            try {
                String responseBody = new String(
                    Base64.decode(responseBodyBase64, Base64.DEFAULT),
                    StandardCharsets.UTF_8
                );
                JSONObject payload = new JSONObject(responseBody);
                String code = payload.optString("code", "").trim();
                return code.isEmpty() ? null : code;
            } catch (IllegalArgumentException | JSONException exception) {
                return null;
            }
        }
    }

    private final AndroidPushIdentityStorage storage;
    private final Transport transport;
    private final ClientMetadata clientMetadata;
    private final StatusPublisher statusPublisher;

    AndroidPushRegistrationCoordinator(
        AndroidPushIdentityStorage storage,
        Transport transport,
        ClientMetadata clientMetadata,
        StatusPublisher statusPublisher
    ) {
        this.storage = storage;
        this.transport = transport;
        this.clientMetadata = clientMetadata;
        this.statusPublisher = statusPublisher;
    }

    synchronized Outcome synchronize(
        String registrationAuthority,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        AndroidPushIdentityStorage.State candidate = null;
        try {
            cancellation.throwIfCancelled();
            String authority = normalizeAuthority(registrationAuthority);
            if (authority == null) {
                return publish(Outcome.of(Outcome.Kind.AUTHENTICATION_REJECTED));
            }
            candidate = storage.load();
            if (candidate == null || candidate.token() == null) {
                return publish(Outcome.success(LifecycleEvent.UNCHANGED));
            }
            if (candidate.isReconfigurationRequired()) {
                return publish(Outcome.of(Outcome.Kind.RECONFIGURATION_REQUIRED));
            }

            JSONObject fingerprintPayload = clientMetadata.requestPayload(
                candidate,
                LifecycleEvent.REGISTERED
            );
            String fingerprint = registrationFingerprint(
                candidate,
                fingerprintPayload
            );
            String credentialFingerprint = credentialFingerprint(
                candidate.token()
            );
            if (!candidate.needsRegistration(fingerprint)) {
                return publish(Outcome.success(LifecycleEvent.UNCHANGED));
            }

            LifecycleEvent lifecycleEvent = resolveLifecycleEvent(
                candidate,
                credentialFingerprint
            );
            JSONObject requestPayload = clientMetadata.requestPayload(
                candidate,
                lifecycleEvent
            );
            Transport.Response response = transport.put(
                candidate.apiOrigin(),
                authority,
                candidate.installationId(),
                requestPayload,
                cancellation
            );
            cancellation.throwIfCancelled();

            if (response.statusCode() == 200 || response.statusCode() == 201) {
                AndroidPushIdentityStorage.State registered = storage.markRegistered(
                    candidate,
                    fingerprint,
                    credentialFingerprint
                );
                if (!sameRegistrationBinding(candidate, registered)) {
                    return publish(Outcome.of(Outcome.Kind.RETRYABLE_FAILURE));
                }
                if (registered.isReconfigurationRequired()) {
                    return publish(
                        Outcome.of(Outcome.Kind.RECONFIGURATION_REQUIRED)
                    );
                }
                String currentFingerprint = registrationFingerprint(
                    registered,
                    clientMetadata.requestPayload(
                        registered,
                        LifecycleEvent.REGISTERED
                    )
                );
                if (registered.needsRegistration(currentFingerprint)) {
                    return publish(Outcome.of(Outcome.Kind.RETRYABLE_FAILURE));
                }
                return publish(Outcome.success(lifecycleEvent));
            }
            if (response.statusCode() == 401 || response.statusCode() == 403) {
                return publishForCurrentBinding(
                    candidate,
                    Outcome.of(Outcome.Kind.AUTHENTICATION_REJECTED)
                );
            }
            if (isReconfiguration(response)) {
                AndroidPushIdentityStorage.State reconfigured =
                    storage.markReconfigurationRequired(candidate);
                if (!sameRegistrationBinding(candidate, reconfigured)) {
                    return publish(Outcome.of(Outcome.Kind.RETRYABLE_FAILURE));
                }
                return publish(
                    Outcome.of(Outcome.Kind.RECONFIGURATION_REQUIRED)
                );
            }
            return publishForCurrentBinding(
                candidate,
                Outcome.of(Outcome.Kind.RETRYABLE_FAILURE)
            );
        } catch (NativeAuthHttpClient.NativeAuthCancelledException exception) {
            if ("REQUEST_TIMEOUT".equals(exception.getReasonCode())) {
                return publishForCurrentBinding(
                    candidate,
                    Outcome.of(Outcome.Kind.RETRYABLE_FAILURE)
                );
            }
            return publish(Outcome.of(Outcome.Kind.CANCELLED));
        } catch (NativeAuthHttpException exception) {
            if (exception.getStatusCode() == 401
                || exception.getStatusCode() == 403) {
                return publishForCurrentBinding(
                    candidate,
                    Outcome.of(Outcome.Kind.AUTHENTICATION_REJECTED)
                );
            }
            return publishForCurrentBinding(
                candidate,
                Outcome.of(Outcome.Kind.RETRYABLE_FAILURE)
            );
        } catch (
            IOException
                | TokenStorageException
                | JSONException
                | RuntimeException exception
        ) {
            return publishForCurrentBinding(
                candidate,
                Outcome.of(Outcome.Kind.RETRYABLE_FAILURE)
            );
        }
    }

    private Outcome publish(Outcome outcome) {
        statusPublisher.publish(outcome.status());
        return outcome;
    }

    private Outcome publishForCurrentBinding(
        AndroidPushIdentityStorage.State candidate,
        Outcome intendedOutcome
    ) {
        try {
            AndroidPushIdentityStorage.State current = storage.load();
            if (!sameRegistrationBinding(candidate, current)) {
                return publish(Outcome.of(Outcome.Kind.RETRYABLE_FAILURE));
            }
            if (current.isReconfigurationRequired()) {
                return publish(
                    Outcome.of(Outcome.Kind.RECONFIGURATION_REQUIRED)
                );
            }
            return publish(intendedOutcome);
        } catch (TokenStorageException exception) {
            return publish(Outcome.of(Outcome.Kind.RETRYABLE_FAILURE));
        }
    }

    private static LifecycleEvent resolveLifecycleEvent(
        AndroidPushIdentityStorage.State candidate,
        String credentialFingerprint
    ) {
        if (!candidate.hasServerRegistration()) {
            return LifecycleEvent.REGISTERED;
        }
        return candidate.tokenChangedSinceRegistration(credentialFingerprint)
            ? LifecycleEvent.CREDENTIAL_ROTATED
            : LifecycleEvent.CLIENT_UPDATED;
    }

    private static boolean isReconfiguration(Transport.Response response) {
        if (response.statusCode() != 409) {
            return false;
        }
        return "NOTIFICATION_RUNTIME_STATE_INVALID".equals(response.errorCode())
            || "NOTIFICATION_CHANNEL_UNSUPPORTED".equals(response.errorCode());
    }

    private static boolean sameRegistrationBinding(
        AndroidPushIdentityStorage.State expected,
        AndroidPushIdentityStorage.State actual
    ) {
        return expected != null
            && actual != null
            && expected.apiOrigin().equals(actual.apiOrigin())
            && expected.metadataRevision() == actual.metadataRevision()
            && expected.installationId().equals(actual.installationId());
    }

    private static String normalizeAuthority(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()
            || normalized.length()
                > AndroidPushIdentityStorage.MAX_AUTH_TOKEN_CHARACTERS) {
            return null;
        }
        return normalized;
    }

    private static String registrationFingerprint(
        AndroidPushIdentityStorage.State state,
        JSONObject registrationPayload
    ) {
        String material = state.apiOrigin()
            + "\n"
            + state.installationId()
            + "\n"
            + registrationPayload.toString();
        return sha256(material);
    }

    private static String credentialFingerprint(String token) {
        return sha256(token);
    }

    private static String sha256(String material) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                material.getBytes(StandardCharsets.UTF_8)
            );
            StringBuilder encoded = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                encoded.append(String.format("%02x", value & 0xff));
            }
            return encoded.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
