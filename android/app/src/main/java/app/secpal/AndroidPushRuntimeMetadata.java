/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import com.getcapacitor.JSObject;
import com.google.firebase.FirebaseOptions;

import org.json.JSONObject;

final class AndroidPushRuntimeMetadata {
    private final String provider;
    private final int metadataRevision;
    private final String apiKey;
    private final String projectId;
    private final String applicationId;
    private final String senderId;

    AndroidPushRuntimeMetadata(
        String provider,
        int metadataRevision,
        String apiKey,
        String projectId,
        String applicationId,
        String senderId
    ) {
        this.provider = provider;
        this.metadataRevision = metadataRevision;
        this.apiKey = apiKey;
        this.projectId = projectId;
        this.applicationId = applicationId;
        this.senderId = senderId;
    }

    String provider() {
        return provider;
    }

    int metadataRevision() {
        return metadataRevision;
    }

    String apiKey() {
        return apiKey;
    }

    String projectId() {
        return projectId;
    }

    String applicationId() {
        return applicationId;
    }

    String senderId() {
        return senderId;
    }

    FirebaseOptions toFirebaseOptions() {
        return new FirebaseOptions.Builder()
            .setApiKey(apiKey)
            .setProjectId(projectId)
            .setApplicationId(applicationId)
            .setGcmSenderId(senderId)
            .build();
    }

    JSObject toJsObject() {
        JSObject payload = new JSObject();
        JSObject publicClientMetadata = new JSObject();

        publicClientMetadata.put("apiKey", apiKey);
        publicClientMetadata.put("projectId", projectId);
        publicClientMetadata.put("applicationId", applicationId);
        publicClientMetadata.put("senderId", senderId);

        payload.put("provider", provider);
        payload.put("metadataRevision", metadataRevision);
        payload.put("publicClientMetadata", publicClientMetadata);

        return payload;
    }

    static AndroidPushRuntimeMetadata fromBootstrap(JSONObject androidPush)
        throws SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException {
        if (androidPush == null) {
            return null;
        }

        String provider = SecPalNativeAuthPlugin.normalizeRequiredString(
            SecPalNativeAuthPlugin.firstNonBlank(androidPush.optString("provider", null), null),
            "Android runtime bootstrap requires the FCM Android push provider"
        ).toLowerCase();

        if (!"fcm".equals(provider)) {
            throw new SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires the FCM Android push provider",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        int metadataRevision = parsePositiveInteger(
            firstNonNull(androidPush.opt("metadataRevision"), androidPush.opt("metadata_revision")),
            "Android runtime bootstrap requires a positive Android push metadata revision"
        );

        JSONObject publicClientMetadata = firstObject(
            androidPush.optJSONObject("publicClientMetadata"),
            androidPush.optJSONObject("public_client_metadata")
        );

        if (publicClientMetadata == null) {
            throw new SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires complete Android push client metadata",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        return new AndroidPushRuntimeMetadata(
            provider,
            metadataRevision,
            requiredPublicClientMetadataValue(publicClientMetadata, "apiKey", "api_key"),
            requiredPublicClientMetadataValue(publicClientMetadata, "projectId", "project_id"),
            requiredPublicClientMetadataValue(publicClientMetadata, "applicationId", "application_id"),
            requiredPublicClientMetadataValue(publicClientMetadata, "senderId", "sender_id")
        );
    }

    private static String requiredPublicClientMetadataValue(JSONObject source, String camelKey, String snakeKey)
        throws SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException {
        return SecPalNativeAuthPlugin.normalizeRequiredString(
            SecPalNativeAuthPlugin.firstNonBlank(source.optString(camelKey, null), source.optString(snakeKey, null)),
            "Android runtime bootstrap requires complete Android push client metadata"
        );
    }

    private static int parsePositiveInteger(Object value, String message)
        throws SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException {
        if (value instanceof Integer) {
            int parsed = (Integer) value;

            if (parsed > 0) {
                return parsed;
            }
        }

        if (value instanceof Long) {
            long parsed = (Long) value;

            if (parsed > 0 && parsed <= Integer.MAX_VALUE) {
                return (int) parsed;
            }
        }

        if (value instanceof String) {
            String trimmed = ((String) value).trim();

            if (trimmed.matches("^[1-9][0-9]*$")) {
                try {
                    return Integer.parseInt(trimmed);
                } catch (NumberFormatException ignored) {
                    // Fall through to the standardized runtime bootstrap validation error.
                }
            }
        }

        throw new SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException(
            message,
            "RUNTIME_BOOTSTRAP_INVALID"
        );
    }

    private static Object firstNonNull(Object preferred, Object fallback) {
        return preferred != null ? preferred : fallback;
    }

    private static JSONObject firstObject(JSONObject preferred, JSONObject fallback) {
        return preferred != null ? preferred : fallback;
    }
}
