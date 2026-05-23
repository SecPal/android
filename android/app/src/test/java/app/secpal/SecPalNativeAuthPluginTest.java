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

import android.content.SharedPreferences;

import com.getcapacitor.JSObject;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

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
    public void buildRuntimeBootstrapPayloadUsesPersistedBootstrapWhenAvailable() throws Exception {
        JSObject bootstrap = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put("minimumSupportedAppVersion", "0.0.1")
                .put("minimumSupportedAppBuild", 1)
        );

        JSObject payload = SecPalNativeAuthPlugin.buildRuntimeBootstrapPayload(
            bootstrap,
            "https://tenant-b.example"
        );

        assertTrue(payload.getBoolean("configured"));
        assertEquals(
            "https://tenant-a.example",
            payload.getJSONObject("bootstrap").getString("apiOrigin")
        );
        assertNull(payload.opt("apiOrigin"));
    }

    @Test
    public void buildRuntimeBootstrapPayloadFallsBackToLegacyApiOrigin() throws Exception {
        JSObject payload = SecPalNativeAuthPlugin.buildRuntimeBootstrapPayload(
            null,
            " https://tenant-a.example/ "
        );

        assertTrue(payload.getBoolean("configured"));
        assertEquals("https://tenant-a.example", payload.getString("apiOrigin"));
        assertNull(payload.opt("bootstrap"));
    }

    @Test
    public void buildRuntimeBootstrapPayloadIgnoresInvalidLegacyApiOrigin() throws Exception {
        JSObject payload = SecPalNativeAuthPlugin.buildRuntimeBootstrapPayload(
            null,
            "https://tenant-a.example/v1"
        );

        assertFalse(payload.getBoolean("configured"));
        assertNull(payload.opt("apiOrigin"));
        assertNull(payload.opt("bootstrap"));
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

    @Test
    public void clearRuntimeBootstrapStateRemovesTenantScopedRuntimeData() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        final boolean[] provisioningStateCleared = { false };

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .putString("keep_me", "value")
            .commit();
        tokenStorage.token = "tenant-a-token";

        assertTrue(
            SecPalNativeAuthPlugin.clearRuntimeBootstrapState(
                preferences,
                tokenStorage,
                () -> provisioningStateCleared[0] = true
            )
        );

        assertNull(preferences.getString("runtime_bootstrap", null));
        assertNull(preferences.getString("api_base_url", null));
        assertEquals("value", preferences.getString("keep_me", null));
        assertNull(tokenStorage.token);
        assertTrue(provisioningStateCleared[0]);
    }

    @Test
    public void clearRuntimeBootstrapStatePreservesRuntimeDataWhenCommitFails() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        final boolean[] provisioningStateCleared = { false };

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";
        preferences.failNextCommit = true;

        assertFalse(
            SecPalNativeAuthPlugin.clearRuntimeBootstrapState(
                preferences,
                tokenStorage,
                () -> provisioningStateCleared[0] = true
            )
        );

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("https://tenant-a.example", preferences.getString("api_base_url", null));
        assertEquals("tenant-a-token", tokenStorage.token);
        assertFalse(provisioningStateCleared[0]);
        assertEquals(
            "Async apply() must not silently retry after a failed commit() that already rejected the caller.",
            0,
            preferences.applyCallCount
        );
    }

    private static final class FakeTokenStorage implements TokenStorage {
        private String token;

        @Override
        public void saveToken(String token) {
            this.token = token;
        }

        @Override
        public String getToken() {
            return token;
        }

        @Override
        public void clearToken() {
            token = null;
        }
    }

    private static final class InMemorySharedPreferences implements SharedPreferences {
        private final Map<String, String> values = new HashMap<>();
        private boolean failNextCommit;
        private int applyCallCount;

        @Override
        public Map<String, ?> getAll() { return values; }

        @Override
        public String getString(String key, String defValue) { return values.getOrDefault(key, defValue); }

        @Override
        public Set<String> getStringSet(String key, Set<String> defValues) { throw new UnsupportedOperationException(); }

        @Override
        public int getInt(String key, int defValue) { throw new UnsupportedOperationException(); }

        @Override
        public long getLong(String key, long defValue) { throw new UnsupportedOperationException(); }

        @Override
        public float getFloat(String key, float defValue) { throw new UnsupportedOperationException(); }

        @Override
        public boolean getBoolean(String key, boolean defValue) { throw new UnsupportedOperationException(); }

        @Override
        public boolean contains(String key) { return values.containsKey(key); }

        @Override
        public Editor edit() {
            final Map<String, String> pending = new HashMap<>(values);
            final boolean[] cleared = { false };
            return new Editor() {
                @Override
                public Editor putString(String key, String value) { pending.put(key, value); return this; }

                @Override
                public Editor remove(String key) { pending.remove(key); return this; }

                @Override
                public Editor clear() { pending.clear(); cleared[0] = true; return this; }

                @Override
                public void apply() {
                    applyCallCount += 1;
                    flush();
                }

                @Override
                public boolean commit() {
                    if (failNextCommit) {
                        failNextCommit = false;
                        return false;
                    }
                    flush();
                    return true;
                }

                private void flush() {
                    if (cleared[0]) {
                        values.clear();
                    }
                    values.keySet().retainAll(pending.keySet());
                    values.putAll(pending);
                }

                @Override
                public Editor putStringSet(String key, Set<String> values) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putInt(String key, int value) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putLong(String key, long value) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putFloat(String key, float value) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putBoolean(String key, boolean value) { throw new UnsupportedOperationException(); }
            };
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
    }
}
