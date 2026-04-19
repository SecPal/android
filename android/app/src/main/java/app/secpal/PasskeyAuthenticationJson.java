/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

class PasskeyAuthenticationJson {
    private PasskeyAuthenticationJson() {
        // Utility class
    }

    static String buildAuthenticationRequestJson(JSONObject publicKey) throws JSONException, NativeAuthHttpException {
        JSONObject requestJson = new JSONObject()
            .put("challenge", requireString(publicKey, "challenge", "public_key.challenge"))
            .put("rpId", requireString(publicKey, "rp_id", "public_key.rp_id"));

        if (publicKey.has("timeout")) {
            requestJson.put("timeout", publicKey.get("timeout"));
        }

        String userVerification = optionalString(publicKey, "user_verification");

        if (userVerification != null) {
            requestJson.put("userVerification", userVerification);
        }

        JSONArray allowCredentials = publicKey.optJSONArray("allow_credentials");

        if (allowCredentials != null && allowCredentials.length() > 0) {
            JSONArray mappedAllowCredentials = new JSONArray();

            for (int index = 0; index < allowCredentials.length(); index++) {
                JSONObject allowCredential = allowCredentials.getJSONObject(index);
                JSONObject mappedCredential = new JSONObject()
                    .put("id", requireString(allowCredential, "id", "public_key.allow_credentials[].id"))
                    .put("type", requireString(allowCredential, "type", "public_key.allow_credentials[].type"));

                JSONArray transports = allowCredential.optJSONArray("transports");

                if (transports != null && transports.length() > 0) {
                    mappedCredential.put("transports", transports);
                }

                mappedAllowCredentials.put(mappedCredential);
            }

            requestJson.put("allowCredentials", mappedAllowCredentials);
        }

        return requestJson.toString();
    }

    static JSObject buildAuthenticationVerificationCredential(String authenticationResponseJson)
        throws JSONException, NativeAuthHttpException {
        JSONObject credentialJson = new JSONObject(authenticationResponseJson);
        JSONObject responseJson = credentialJson.optJSONObject("response");

        if (responseJson == null) {
            throw new NativeAuthHttpException(
                "Android passkey credential response is missing response payload",
                0
            );
        }

        JSObject verificationCredential = new JSObject();
        verificationCredential.put("id", firstRequiredString(
            credentialJson,
            new String[] { "id" },
            "credential.id"
        ));
        verificationCredential.put("raw_id", firstRequiredString(
            credentialJson,
            new String[] { "rawId", "raw_id", "id" },
            "credential.rawId"
        ));
        verificationCredential.put("type", firstRequiredString(
            credentialJson,
            new String[] { "type" },
            "credential.type"
        ));

        JSObject verificationResponse = new JSObject();
        verificationResponse.put("client_data_json", firstRequiredString(
            responseJson,
            new String[] { "clientDataJSON", "clientDataJson" },
            "credential.response.clientDataJSON"
        ));
        verificationResponse.put("authenticator_data", firstRequiredString(
            responseJson,
            new String[] { "authenticatorData" },
            "credential.response.authenticatorData"
        ));
        verificationResponse.put("signature", firstRequiredString(
            responseJson,
            new String[] { "signature" },
            "credential.response.signature"
        ));

        String userHandle = firstOptionalString(
            responseJson,
            new String[] { "userHandle", "user_handle" }
        );

        if (userHandle != null) {
            verificationResponse.put("user_handle", userHandle);
        }

        verificationCredential.put("response", verificationResponse);

        JSONObject clientExtensionResults = credentialJson.optJSONObject("clientExtensionResults");

        if (clientExtensionResults != null) {
            verificationCredential.put(
                "client_extension_results",
                JSObject.fromJSONObject(clientExtensionResults)
            );
        }

        return verificationCredential;
    }

    private static String requireString(JSONObject object, String key, String fieldName)
        throws JSONException, NativeAuthHttpException {
        String value = optionalString(object, key);

        if (value == null) {
            throw new NativeAuthHttpException(
                "Android passkey payload is missing " + fieldName,
                0
            );
        }

        return value;
    }

    private static String optionalString(JSONObject object, String key) throws JSONException {
        if (!object.has(key) || object.isNull(key)) {
            return null;
        }

        String value = object.getString(key).trim();

        return value.isEmpty() ? null : value;
    }

    private static String firstRequiredString(JSONObject object, String[] keys, String fieldName)
        throws JSONException, NativeAuthHttpException {
        String value = firstOptionalString(object, keys);

        if (value == null) {
            throw new NativeAuthHttpException(
                "Android passkey credential response is missing " + fieldName,
                0
            );
        }

        return value;
    }

    private static String firstOptionalString(JSONObject object, String[] keys) throws JSONException {
        for (String key : keys) {
            String value = optionalString(object, key);

            if (value != null) {
                return value;
            }
        }

        return null;
    }
}
