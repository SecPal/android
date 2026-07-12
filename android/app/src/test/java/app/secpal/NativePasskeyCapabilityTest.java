/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.getcapacitor.JSObject;
import org.junit.Test;

public class NativePasskeyCapabilityTest {

    @Test
    public void api33DoesNotOfferPasskeys() {
        NativePasskeyCapability capability = NativePasskeyCapability.forSdkInt(33);

        assertFalse(capability.isPasskeysAvailable());
        assertEquals("PASSKEY_ANDROID_VERSION_UNSUPPORTED", capability.getUnavailableReason());
    }

    @Test
    public void api34OffersPasskeys() {
        NativePasskeyCapability capability = NativePasskeyCapability.forSdkInt(34);

        assertTrue(capability.isPasskeysAvailable());
        assertEquals(null, capability.getUnavailableReason());
    }

    @Test
    public void unsupportedCapabilityPayloadIncludesStableReason() throws Exception {
        JSObject payload = SecPalNativeAuthPlugin.buildPasskeyCapabilities(
            NativePasskeyCapability.forSdkInt(33)
        );

        assertFalse(payload.getBool("passkeysAvailable"));
        assertEquals("PASSKEY_ANDROID_VERSION_UNSUPPORTED", payload.getString("reason"));
    }

    @Test
    public void supportedCapabilityPayloadOmitsReason() throws Exception {
        JSObject payload = SecPalNativeAuthPlugin.buildPasskeyCapabilities(
            NativePasskeyCapability.forSdkInt(34)
        );

        assertTrue(payload.getBool("passkeysAvailable"));
        assertFalse(payload.has("reason"));
    }

    @Test
    public void api33FailsBeforeCredentialManagerWork() {
        NativePasskeyAuthenticator authenticator = new NativePasskeyAuthenticator(
            activity -> {
                fail("Credential Manager must not be created for an unsupported Android version");
                return null;
            }
        );

        try {
            authenticator.authenticate(null, "{}", NativePasskeyCapability.forSdkInt(33));
            fail("Expected passkey capability rejection");
        } catch (PasskeyAuthenticationException exception) {
            assertEquals("PASSKEY_ANDROID_VERSION_UNSUPPORTED", exception.getErrorCode());
        }
    }

    @Test
    public void registrationUsesTheSameCapabilityRuleAsSignIn() {
        NativePasskeyAuthenticator authenticator = new NativePasskeyAuthenticator(
            activity -> {
                fail("Credential Manager must not be created for an unsupported Android version");
                return null;
            }
        );

        try {
            authenticator.register(null, "{}", NativePasskeyCapability.forSdkInt(33));
            fail("Expected passkey capability rejection");
        } catch (PasskeyAuthenticationException exception) {
            assertEquals("PASSKEY_ANDROID_VERSION_UNSUPPORTED", exception.getErrorCode());
        }
    }
}
