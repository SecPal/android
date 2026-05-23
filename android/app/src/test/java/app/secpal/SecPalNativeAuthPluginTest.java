/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.getcapacitor.JSObject;

import org.junit.Test;
import org.json.JSONObject;

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

    @Test
    public void resolveRuntimeApiBaseUrlRejectsInsecureHttpOrigin() {
        try {
            SecPalNativeAuthPlugin.resolveRuntimeApiBaseUrl("http://api.secpal.dev");
            fail("Expected ConfiguredApiBaseUrlException");
        } catch (SecPalNativeAuthPlugin.ConfiguredApiBaseUrlException exception) {
            assertEquals("Android auth API origin must use HTTPS", exception.getMessage());
            assertEquals("INSECURE_API_BASE_URL", exception.getErrorCode());
        }
    }

    @Test
    public void resolveInitialApiBaseUrlUsesPersistedRuntimeOriginWhenAvailable() {
        assertEquals(
            "https://tenant-a.example",
            SecPalNativeAuthPlugin.resolveInitialApiBaseUrl(" https://tenant-a.example/ ")
        );
    }

    @Test
    public void resolveInitialApiBaseUrlReturnsNullWithoutPersistedRuntimeOrigin() {
        assertNull(SecPalNativeAuthPlugin.resolveInitialApiBaseUrl(null));
    }

    @Test
    public void resolveInitialApiBaseUrlReturnsNullForInvalidPersistedRuntimeOrigin() {
        assertNull(SecPalNativeAuthPlugin.resolveInitialApiBaseUrl("https://tenant-a.example/v1"));
    }

    @Test
    public void normalizeRuntimeBootstrapDerivesCanonicalApiOriginFromRawApiBaseUrl() throws Exception {
        JSObject normalized = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put("minimumSupportedAppVersion", "0.0.1")
                .put("minimumSupportedAppBuild", 1)
                .put("features", new JSONObject().put("passwordLoginEnabled", true))
        );

        assertEquals("https://tenant-a.example", normalized.getString("apiOrigin"));
        assertEquals("https://tenant-a.example/v1", normalized.getString("rawApiBaseUrl"));
        assertTrue(normalized.getJSONObject("features").getBoolean("passwordLoginEnabled"));
        assertFalse(normalized.getJSONObject("features").getBoolean("passkeyLoginEnabled"));
        assertFalse(
            normalized.getJSONObject("features").getBoolean("managedAndroidEnrollment")
        );
    }

    @Test
    public void shouldClearStoredTokenWhenRuntimeOriginChanges() {
        assertTrue(
            SecPalNativeAuthPlugin.shouldClearStoredToken(
                "https://tenant-a.example",
                "https://tenant-b.example"
            )
        );
        assertFalse(
            SecPalNativeAuthPlugin.shouldClearStoredToken(
                "https://tenant-a.example",
                "https://tenant-a.example"
            )
        );
        assertFalse(SecPalNativeAuthPlugin.shouldClearStoredToken(null, "https://tenant-a.example"));
    }
}
