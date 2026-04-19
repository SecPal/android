/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class SecPalNativeAuthPluginTest {

    @Test
    public void resolveErrorCodeUsesHttpStatusWhenPresent() {
        assertEquals(
            "HTTP_401",
            SecPalNativeAuthPlugin.resolveErrorCode(new NativeAuthHttpException("Unauthenticated", 401))
        );
    }

    @Test
    public void resolveErrorCodeUsesValidationFallbackWhenStatusIsZero() {
        assertEquals(
            "VALIDATION_ERROR",
            SecPalNativeAuthPlugin.resolveErrorCode(new NativeAuthHttpException("Invalid", 0))
        );
    }

    @Test
    public void resolveErrorCodeIgnoresNonHttpExceptions() {
        assertNull(SecPalNativeAuthPlugin.resolveErrorCode(new IllegalStateException("boom")));
    }

    @Test
    public void resolveErrorCodeUsesNetworkOfflineForMissingConnectivity() {
        assertEquals(
            "NETWORK_OFFLINE",
            SecPalNativeAuthPlugin.resolveErrorCode(
                new NetworkUnavailableException("Android auth requires an active internet connection")
            )
        );
    }

    @Test
    public void resolveErrorCodePreservesPasskeyErrorCodes() {
        assertEquals(
            "PASSKEY_CANCELLED",
            SecPalNativeAuthPlugin.resolveErrorCode(
                new PasskeyAuthenticationException("Passkey sign-in was cancelled.", "PASSKEY_CANCELLED")
            )
        );
    }

    @Test
    public void resolveConfiguredApiBaseUrlNormalizesConfiguredOrigin() {
        assertEquals(
            "https://api.secpal.dev",
            SecPalNativeAuthPlugin.resolveConfiguredApiBaseUrl(" https://api.secpal.dev/ ")
        );
    }

    @Test
    public void resolveConfiguredApiBaseUrlFailsFastForInvalidOrigin() {
        try {
            SecPalNativeAuthPlugin.resolveConfiguredApiBaseUrl("https://api.secpal.dev@evil.example");
            fail("Expected IllegalStateException");
        } catch (IllegalStateException exception) {
            assertEquals("Invalid Android auth API origin configuration", exception.getMessage());
            assertTrue(exception.getCause() instanceof NativeAuthHttpException);
        }
    }
}
