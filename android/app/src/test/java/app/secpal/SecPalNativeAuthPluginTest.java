/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
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
    public void resolveRuntimeBootstrapErrorCodeHandlesKnownAndFallbackFailures() {
        assertEquals(
            "INSECURE_API_BASE_URL",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(
                new SecPalNativeAuthPlugin.ConfiguredApiBaseUrlException(
                    "Android auth API origin must use HTTPS",
                    "INSECURE_API_BASE_URL"
                )
            )
        );
        assertEquals(
            "RUNTIME_BOOTSTRAP_INVALID",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(
                new SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException(
                    "Android runtime bootstrap is invalid",
                    "RUNTIME_BOOTSTRAP_INVALID"
                )
            )
        );
        assertEquals(
            "RUNTIME_BOOTSTRAP_INVALID",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(new IllegalStateException("boom"))
        );
        assertEquals(
            "RUNTIME_BOOTSTRAP_INVALID",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(new NullPointerException("firebase-internal"))
        );
    }

    @Test
    public void vaultRootKeyBridgeStaysDisabledForWebViewJavascript() {
        assertFalse(SecPalNativeAuthPlugin.isVaultRootKeyBridgeEnabledForWebView());
    }

    @Test
    public void vaultRootKeyWrapperAvailabilityStaysDisabledForWebViewJavascript() {
        assertTrue(
            SecPalNativeAuthPlugin.isVaultDeviceBoundWrapperAvailableForWebView(true, true)
        );
        assertFalse(
            SecPalNativeAuthPlugin.isVaultDeviceBoundWrapperAvailableForWebView(false, true)
        );
        assertFalse(
            SecPalNativeAuthPlugin.isVaultDeviceBoundWrapperAvailableForWebView(true, false)
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
        assertFalse(normalized.getJSONObject("features").has("managedAndroidEnrollment"));
    }

    @Test
    public void normalizeRuntimeBootstrapPreservesValidatedAndroidPushMetadata() throws Exception {
        JSObject normalized = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put("minimumSupportedAppVersion", "0.0.1")
                .put("minimumSupportedAppBuild", 1)
                .put(
                    "androidPush",
                    new JSONObject()
                        .put("provider", "fcm")
                        .put("metadataRevision", 3)
                        .put(
                            "publicClientMetadata",
                            new JSONObject()
                                .put("apiKey", "public-client-api-key-demo-1234567890")
                                .put("projectId", "secpal-demo-push")
                                .put("applicationId", "1:1234567890:android:abcdef1234567890")
                                .put("senderId", "1234567890")
                        )
                )
        );

        JSONObject androidPush = normalized.getJSONObject("androidPush");

        assertNotNull(androidPush);
        assertEquals("fcm", androidPush.getString("provider"));
        assertEquals(3, androidPush.getInt("metadataRevision"));
        assertEquals(
            "public-client-api-key-demo-1234567890",
            androidPush.getJSONObject("publicClientMetadata").getString("apiKey")
        );
        assertEquals(
            "1234567890",
            androidPush.getJSONObject("publicClientMetadata").getString("senderId")
        );
    }

    @Test
    public void normalizeRuntimeBootstrapRejectsIncompleteAndroidPushMetadata() throws Exception {
        try {
            SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
                new JSONObject()
                    .put("instanceDisplayName", "Tenant A")
                    .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                    .put("minimumSupportedAppVersion", "0.0.1")
                    .put("minimumSupportedAppBuild", 1)
                    .put(
                        "androidPush",
                        new JSONObject()
                            .put("provider", "fcm")
                            .put("metadataRevision", 3)
                            .put(
                                "publicClientMetadata",
                                new JSONObject()
                                    .put("apiKey", "public-client-api-key-demo-1234567890")
                                    .put("projectId", "secpal-demo-push")
                                    .put("applicationId", "1:1234567890:android:abcdef1234567890")
                            )
                    )
            );
            fail("Expected InvalidRuntimeBootstrapException");
        } catch (SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException exception) {
            assertEquals(
                "Android runtime bootstrap requires complete Android push client metadata",
                exception.getMessage()
            );
            assertEquals("RUNTIME_BOOTSTRAP_INVALID", exception.getErrorCode());
        }
    }

    @Test
    public void normalizeRuntimeBootstrapRejectsAndroidPushMetadataRevisionStringOverflow()
        throws Exception {
        try {
            SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
                new JSONObject()
                    .put("instanceDisplayName", "Tenant A")
                    .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                    .put("minimumSupportedAppVersion", "0.0.1")
                    .put("minimumSupportedAppBuild", 1)
                    .put(
                        "androidPush",
                        new JSONObject()
                            .put("provider", "fcm")
                            .put("metadataRevision", "9999999999")
                            .put(
                                "publicClientMetadata",
                                new JSONObject()
                                    .put("apiKey", "public-client-api-key-demo-1234567890")
                                    .put("projectId", "secpal-demo-push")
                                    .put("applicationId", "1:1234567890:android:abcdef1234567890")
                                    .put("senderId", "1234567890")
                            )
                    )
            );
            fail("Expected InvalidRuntimeBootstrapException");
        } catch (SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException exception) {
            assertEquals(
                "Android runtime bootstrap requires a positive Android push metadata revision",
                exception.getMessage()
            );
            assertEquals("RUNTIME_BOOTSTRAP_INVALID", exception.getErrorCode());
        }
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

        JSObject payload = SecPalNativeAuthPlugin.buildRuntimeBootstrapPayload(bootstrap);

        assertTrue(payload.getBoolean("configured"));
        assertEquals(
            "https://tenant-a.example",
            payload.getJSONObject("bootstrap").getString("apiOrigin")
        );
        assertNull(payload.opt("apiOrigin"));
    }

    @Test
    public void buildRuntimeBootstrapPayloadLeavesRuntimeUnconfiguredWithoutPersistedBootstrap()
        throws Exception {
        JSObject payload = SecPalNativeAuthPlugin.buildRuntimeBootstrapPayload(null);

        assertFalse(payload.getBoolean("configured"));
        assertNull(payload.opt("apiOrigin"));
        assertNull(payload.opt("bootstrap"));
    }

    @Test
    public void loadPersistedRuntimeBootstrapReturnsNullWhenOnlyLegacyApiBaseUrlKeyExists() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putString("api_base_url", "https://tenant-a.example")
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNull(result);
    }

    @Test
    public void loadPersistedRuntimeBootstrapRestoresStructuredBootstrapFromPreferences()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        JSObject stored = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put("minimumSupportedAppVersion", "0.0.1")
                .put("minimumSupportedAppBuild", 1)
        );
        preferences.edit()
            .putString("runtime_bootstrap", stored.toString())
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNotNull(result);
        assertEquals("https://tenant-a.example", result.getString("apiOrigin"));
        assertEquals("Tenant A", result.getString("instanceDisplayName"));
    }

    @Test
    public void loadPersistedRuntimeBootstrapDiscardsObsoleteSchemaMarkers() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        JSONObject stored = new JSONObject()
            .put("instanceDisplayName", "Tenant A")
            .put("rawApiBaseUrl", "https://tenant-a.example/v1")
            .put("minimumSupportedAppVersion", "0.0.1")
            .put("minimumSupportedAppBuild", 1)
            .put("schemaVersion", 3)
            .put("schema_version", 3);
        preferences.edit()
            .putString("runtime_bootstrap", stored.toString())
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNotNull(result);
        assertEquals("https://tenant-a.example", result.getString("apiOrigin"));
        assertEquals("Tenant A", result.getString("instanceDisplayName"));
        assertFalse(result.has("schemaVersion"));
        assertFalse(result.has("schema_version"));
    }

    @Test
    public void loadPersistedRuntimeBootstrapSelfHealsCorruptBootstrapJson() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putString("runtime_bootstrap", "{not valid json}")
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNull(result);
        assertNull(preferences.getString("runtime_bootstrap", null));
    }

    @Test
    public void restoreRuntimeBootstrapPersistenceRollsBackPreviousDeploymentState() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-b.example\"}")
            .remove("api_base_url")
            .commit();

        SecPalNativeAuthPlugin.restoreRuntimeBootstrapPersistence(
            preferences,
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            "https://tenant-a.example"
        );

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("https://tenant-a.example", preferences.getString("api_base_url", null));
        assertEquals(1, preferences.applyCallCount);
    }

    @Test
    public void applyPersistedRuntimeBootstrapSelfHealsFirebaseInitializationFailures()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        JSObject stored = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put("minimumSupportedAppVersion", "0.0.1")
                .put("minimumSupportedAppBuild", 1)
                .put(
                    "androidPush",
                    new JSONObject()
                        .put("provider", "fcm")
                        .put("metadataRevision", 3)
                        .put(
                            "publicClientMetadata",
                            new JSONObject()
                                .put("apiKey", "public-client-api-key-demo-1234567890")
                                .put("projectId", "secpal-demo-push")
                                .put("applicationId", "1:1234567890:android:abcdef1234567890")
                                .put("senderId", "1234567890")
                        )
                )
        );
        preferences.edit()
            .putString("runtime_bootstrap", stored.toString())
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";
        ThrowingFirebaseBackend firebaseBackend = new ThrowingFirebaseBackend();

        JSObject result = SecPalNativeAuthPlugin.applyPersistedRuntimeBootstrap(
            preferences,
            tokenStorage,
            new AndroidPushRuntimeManager(firebaseBackend),
            stored
        );

        assertNull(result);
        assertNull(preferences.getString("runtime_bootstrap", null));
        assertNull(preferences.getString("api_base_url", null));
        assertNull(tokenStorage.token);
        assertEquals(
            "Load-time Firebase failures should clear the persisted bootstrap asynchronously.",
            1,
            preferences.applyCallCount
        );
        assertEquals(1, firebaseBackend.initializeCallCount);
        assertEquals(2, firebaseBackend.findRuntimeAppCallCount);
    }

    @Test
    public void messagingListenerForwardsTokenEventBeforeDestroyed() {
        final boolean[] notified = { false };
        AndroidPushRuntimeManager.MessagingListener listener =
            SecPalNativeAuthPlugin.buildAndroidPushMessagingListener(
                () -> false,
                (event, payload) -> {
                    assertEquals("androidPushTokenReceived", event);
                    assertEquals("secpal-runtime-push", payload.getString("appName"));
                    assertEquals("fcm", payload.getString("provider"));
                    assertEquals("fcm-token-demo", payload.getString("token"));
                    notified[0] = true;
                }
            );

        listener.onTokenReceived("secpal-runtime-push", "fcm-token-demo");

        assertTrue("Token event must reach notifier before destroy", notified[0]);
    }

    @Test
    public void messagingListenerSuppressesTokenEventAfterDestroyed() {
        final boolean[] notified = { false };
        AndroidPushRuntimeManager.MessagingListener listener =
            SecPalNativeAuthPlugin.buildAndroidPushMessagingListener(
                () -> true,
                (event, payload) -> notified[0] = true
            );

        listener.onTokenReceived("secpal-runtime-push", "fcm-token-demo");

        assertFalse(
            "Token callback must be suppressed after plugin is destroyed",
            notified[0]
        );
    }

    @Test
    public void messagingListenerSuppressesTokenErrorAfterDestroyed() {
        final boolean[] notified = { false };
        AndroidPushRuntimeManager.MessagingListener listener =
            SecPalNativeAuthPlugin.buildAndroidPushMessagingListener(
                () -> true,
                (event, payload) -> notified[0] = true
            );

        listener.onTokenError("secpal-runtime-push", new RuntimeException("token-failure"));

        assertFalse(
            "Error callback must be suppressed after plugin is destroyed",
            notified[0]
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

    @Test
    public void clearRejectedLegacyRuntimeStateClearsLegacyOriginAndToken() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();

        preferences.edit()
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";

        SecPalNativeAuthPlugin.clearRejectedLegacyRuntimeState(preferences, tokenStorage);

        assertNull(preferences.getString("api_base_url", null));
        assertNull(tokenStorage.token);
        assertEquals(
            "Legacy cleanup should use apply() because load() cannot surface persistence failures.",
            1,
            preferences.applyCallCount
        );
    }

    @Test
    public void clearRejectedLegacyRuntimeStateIsNoOpWithoutLegacyOrigin() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        tokenStorage.token = "tenant-a-token";

        SecPalNativeAuthPlugin.clearRejectedLegacyRuntimeState(preferences, tokenStorage);

        assertNull(preferences.getString("api_base_url", null));
        assertEquals("tenant-a-token", tokenStorage.token);
        assertEquals(0, preferences.applyCallCount);
    }

    @Test
    public void clearRuntimeBootstrapStateRemovesTenantScopedRuntimeData() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .putString("keep_me", "value")
            .commit();
        tokenStorage.token = "tenant-a-token";

        assertTrue(
            SecPalNativeAuthPlugin.clearRuntimeBootstrapState(
                preferences,
                tokenStorage
            )
        );

        assertNull(preferences.getString("runtime_bootstrap", null));
        assertNull(preferences.getString("api_base_url", null));
        assertEquals("value", preferences.getString("keep_me", null));
        assertNull(tokenStorage.token);
    }

    @Test
    public void clearRuntimeBootstrapStatePreservesRuntimeDataWhenCommitFails() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";
        preferences.failNextCommit = true;

        assertFalse(
            SecPalNativeAuthPlugin.clearRuntimeBootstrapState(
                preferences,
                tokenStorage
            )
        );

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("https://tenant-a.example", preferences.getString("api_base_url", null));
        assertEquals(
            "Token must be preserved when preferences commit() fails so native state stays consistent.",
            "tenant-a-token",
            tokenStorage.token
        );
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

    private static final class ThrowingFirebaseBackend implements AndroidPushRuntimeManager.FirebaseBackend {
        private int findRuntimeAppCallCount;
        private int initializeCallCount;

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle findRuntimeApp() {
            findRuntimeAppCallCount += 1;
            return null;
        }

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle initialize(AndroidPushRuntimeMetadata metadata) {
            initializeCallCount += 1;
            throw new IllegalStateException("Failed to initialize Android push runtime from deployment metadata");
        }

        @Override
        public void cancelPendingTokenRequest() {}

        @Override
        public void ensureMessaging(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            fail("ensureMessaging should not run after initialization fails");
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
