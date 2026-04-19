/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PasskeyAuthenticationJsonTest {

    @Test
    public void buildAuthenticationRequestJsonMapsApiPayloadToCredentialManagerFormat() throws Exception {
        JSONObject publicKey = new JSONObject()
            .put("challenge", "Zm9vYmFy")
            .put("rp_id", "app.secpal.dev")
            .put("timeout", 60000)
            .put("user_verification", "preferred")
            .put(
                "allow_credentials",
                new JSONArray().put(new JSONObject()
                    .put("id", "credential-id")
                    .put("type", "public-key")
                    .put("transports", new JSONArray().put("internal")))
            );

        JSONObject requestJson = new JSONObject(PasskeyAuthenticationJson.buildAuthenticationRequestJson(publicKey));

        assertEquals("Zm9vYmFy", requestJson.getString("challenge"));
        assertEquals("app.secpal.dev", requestJson.getString("rpId"));
        assertEquals("preferred", requestJson.getString("userVerification"));
        assertEquals("credential-id", requestJson.getJSONArray("allowCredentials").getJSONObject(0).getString("id"));
        assertEquals("internal", requestJson.getJSONArray("allowCredentials").getJSONObject(0).getJSONArray("transports").getString(0));
    }

    @Test
    public void buildAuthenticationVerificationCredentialMapsCredentialManagerPayloadToApiFormat() throws Exception {
        JSObject verificationCredential = PasskeyAuthenticationJson.buildAuthenticationVerificationCredential(
            new JSONObject()
                .put("id", "credential-id")
                .put("rawId", "credential-raw-id")
                .put("type", "public-key")
                .put(
                    "response",
                    new JSONObject()
                        .put("clientDataJSON", "Y2xpZW50LWRhdGE")
                        .put("authenticatorData", "YXV0aGVudGljYXRvci1kYXRh")
                        .put("signature", "c2lnbmF0dXJl")
                        .put("userHandle", "dXNlci1oYW5kbGU")
                )
                .put("clientExtensionResults", new JSONObject().put("appid", true))
                .toString()
        );

        assertEquals("credential-id", verificationCredential.getString("id"));
        assertEquals("credential-raw-id", verificationCredential.getString("raw_id"));
        assertEquals("public-key", verificationCredential.getString("type"));
        assertEquals(
            "Y2xpZW50LWRhdGE",
            verificationCredential.getJSObject("response").getString("client_data_json")
        );
        assertEquals(
            "dXNlci1oYW5kbGU",
            verificationCredential.getJSObject("response").getString("user_handle")
        );
        assertTrue(verificationCredential.getJSObject("client_extension_results").getBool("appid"));
    }

    @Test
    public void buildAuthenticationVerificationCredentialRejectsMissingResponsePayload() {
        try {
            PasskeyAuthenticationJson.buildAuthenticationVerificationCredential(
                new JSONObject().put("id", "credential-id").toString()
            );
        } catch (Exception exception) {
            assertTrue(exception instanceof NativeAuthHttpException);
            assertEquals(
                "Android passkey credential response is missing response payload",
                exception.getMessage()
            );
            return;
        }

        assertFalse("Expected NativeAuthHttpException", true);
    }

    @Test
    public void buildRegistrationRequestJsonMapsApiPayloadToCredentialManagerFormat() throws Exception {
        JSONObject publicKey = new JSONObject()
            .put("challenge", "Zm9vYmFy")
            .put("rp", new JSONObject().put("id", "app.secpal.dev").put("name", "SecPal"))
            .put(
                "user",
                new JSONObject()
                    .put("id", "dXNlci1pZA")
                    .put("name", "test@secpal.dev")
                    .put("display_name", "Test User")
            )
            .put(
                "pub_key_cred_params",
                new JSONArray().put(new JSONObject().put("type", "public-key").put("alg", -7))
            )
            .put(
                "exclude_credentials",
                new JSONArray().put(new JSONObject()
                    .put("id", "credential-id")
                    .put("type", "public-key")
                    .put("transports", new JSONArray().put("internal")))
            )
            .put(
                "authenticator_selection",
                new JSONObject()
                    .put("authenticator_attachment", "platform")
                    .put("resident_key", "preferred")
                    .put("require_resident_key", true)
                    .put("user_verification", "preferred")
            )
            .put("attestation", "none")
            .put("timeout", 60000);

        JSONObject requestJson = new JSONObject(PasskeyAuthenticationJson.buildRegistrationRequestJson(publicKey));

        assertEquals("Zm9vYmFy", requestJson.getString("challenge"));
        assertEquals("app.secpal.dev", requestJson.getJSONObject("rp").getString("id"));
        assertEquals("Test User", requestJson.getJSONObject("user").getString("displayName"));
        assertEquals(-7, requestJson.getJSONArray("pubKeyCredParams").getJSONObject(0).getInt("alg"));
        assertEquals(
            "credential-id",
            requestJson.getJSONArray("excludeCredentials").getJSONObject(0).getString("id")
        );
        assertEquals(
            "platform",
            requestJson.getJSONObject("authenticatorSelection").getString("authenticatorAttachment")
        );
        assertEquals("none", requestJson.getString("attestation"));
    }

    @Test
    public void buildRegistrationVerificationCredentialMapsCredentialManagerPayloadToApiFormat() throws Exception {
        JSObject verificationCredential = PasskeyAuthenticationJson.buildRegistrationVerificationCredential(
            new JSONObject()
                .put("id", "credential-id")
                .put("rawId", "credential-raw-id")
                .put("type", "public-key")
                .put(
                    "response",
                    new JSONObject()
                        .put("clientDataJSON", "Y2xpZW50LWRhdGE")
                        .put("attestationObject", "YXR0ZXN0YXRpb24tb2JqZWN0")
                        .put("transports", new JSONArray().put("internal"))
                )
                .put("clientExtensionResults", new JSONObject().put("credProps", new JSONObject().put("rk", true)))
                .toString()
        );

        assertEquals("credential-id", verificationCredential.getString("id"));
        assertEquals("credential-raw-id", verificationCredential.getString("raw_id"));
        assertEquals("public-key", verificationCredential.getString("type"));
        assertEquals(
            "Y2xpZW50LWRhdGE",
            verificationCredential.getJSObject("response").getString("client_data_json")
        );
        assertEquals(
            "YXR0ZXN0YXRpb24tb2JqZWN0",
            verificationCredential.getJSObject("response").getString("attestation_object")
        );
        assertEquals(
            "internal",
            verificationCredential.getJSObject("response").getJSONArray("transports").getString(0)
        );
        assertTrue(
            verificationCredential
                .getJSObject("client_extension_results")
                .getJSObject("credProps")
                .getBool("rk")
        );
    }
}
