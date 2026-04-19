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
}
