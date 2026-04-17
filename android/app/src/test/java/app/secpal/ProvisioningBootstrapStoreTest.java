/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.SharedPreferences;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class ProvisioningBootstrapStoreTest {

    @Test
    public void persistProvisioningDataStoresPendingBootstrapState() throws Exception {
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(
            new InMemorySharedPreferences(),
            tokenStorage
        );
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        ProvisioningBootstrapState state = store.getState();

        assertTrue(state.isPending());
        assertEquals(ProvisioningBootstrapState.STATUS_PENDING, state.getStatus());
        assertEquals("session-123", state.getEnrollmentSessionId());
        assertEquals("bootstrap-token-123", tokenStorage.token);
        assertNull(state.getUpdateChannel());
    }

    @Test
    public void applyExchangeResultStoresChannelMetadataAndPolicyProfile() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(preferences, tokenStorage);
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        Map<String, Object> profile = new HashMap<>();

        profile.put("secpal_kiosk_mode_enabled", true);
        profile.put("secpal_lock_task_enabled", true);
        profile.put("secpal_allow_phone", false);
        profile.put("secpal_allow_sms", false);
        profile.put("secpal_prefer_gesture_navigation", true);

        store.applyExchangeResult(
            new ProvisioningBootstrapExchangeResult(
                "session-123",
                7,
                "Tenant 7",
                "https://api.secpal.dev/v1",
                "managed_device",
                "https://secpal.dev/android/channels/managed_device/latest.json",
                profile
            )
        );

        ProvisioningBootstrapState state = store.getState();
        EnterprisePolicyConfig config = EnterprisePolicyConfig.fromPreferences(preferences);

        assertEquals(ProvisioningBootstrapState.STATUS_COMPLETED, state.getStatus());
        assertEquals("managed_device", state.getUpdateChannel());
        assertEquals(
            "https://secpal.dev/android/channels/managed_device/latest.json",
            state.getReleaseMetadataUrl()
        );
        assertNull(tokenStorage.token);
        assertTrue(config.isKioskModeEnabled());
        assertTrue(config.isLockTaskEnabled());
        assertTrue(config.isPreferGestureNavigation());
        assertFalse(config.isAllowPhone());
        assertFalse(config.isAllowSms());
    }

    @Test
    public void applyExchangeResultPreservesPendingStateWhenCommitFails() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(preferences, tokenStorage);
        store.persistProvisioningData("bootstrap-token-123", "session-123");
        preferences.setCommitResult(false);

        boolean persisted = store.applyExchangeResult(
            new ProvisioningBootstrapExchangeResult(
                "session-123",
                7,
                "Tenant 7",
                "https://api.secpal.dev/v1",
                "managed_device",
                "https://secpal.dev/android/channels/managed_device/latest.json",
                Collections.emptyMap()
            )
        );

        ProvisioningBootstrapState state = store.getState();

        assertFalse(persisted);
        assertEquals(ProvisioningBootstrapState.STATUS_PENDING, state.getStatus());
        assertEquals("session-123", state.getEnrollmentSessionId());
        assertNull(state.getUpdateChannel());
        assertNull(state.getReleaseMetadataUrl());
        assertEquals("bootstrap-token-123", tokenStorage.token);
    }

    @Test
    public void applyExchangeResultSucceedsAfterCommitResultToggledFromFalseToTrue() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(preferences, tokenStorage);
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        preferences.setCommitResult(false);
        boolean persisted = store.applyExchangeResult(
            new ProvisioningBootstrapExchangeResult(
                "session-123",
                7,
                "Tenant 7",
                "https://api.secpal.dev/v1",
                "managed_device",
                "https://secpal.dev/android/channels/managed_device/latest.json",
                Collections.emptyMap()
            )
        );
        assertFalse(persisted);

        preferences.setCommitResult(true);
        boolean retriedPersisted = store.applyExchangeResult(
            new ProvisioningBootstrapExchangeResult(
                "session-123",
                7,
                "Tenant 7",
                "https://api.secpal.dev/v1",
                "managed_device",
                "https://secpal.dev/android/channels/managed_device/latest.json",
                Collections.emptyMap()
            )
        );
        assertTrue(retriedPersisted);

        ProvisioningBootstrapState state = store.getState();
        assertEquals(ProvisioningBootstrapState.STATUS_COMPLETED, state.getStatus());
        assertEquals(7, state.getTenantId());
        assertEquals("Tenant 7", state.getTenantName());
        assertEquals("https://api.secpal.dev/v1", state.getApiBaseUrl());
        assertEquals("managed_device", state.getUpdateChannel());
        assertEquals("https://secpal.dev/android/channels/managed_device/latest.json", state.getReleaseMetadataUrl());
        assertNull(state.getLastErrorCode());
        assertNull(tokenStorage.token);
    }

    @Test
    public void applyExchangeResultSucceedsAfterCommitResultTogglesBackToTrue() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(preferences, tokenStorage);
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        preferences.setCommitResult(false);
        boolean firstPersisted = store.applyExchangeResult(
            new ProvisioningBootstrapExchangeResult(
                "session-123",
                7,
                "Tenant 7",
                "https://api.secpal.dev/v1",
                "managed_device",
                "https://secpal.dev/android/channels/managed_device/latest.json",
                Collections.emptyMap()
            )
        );
        assertFalse(firstPersisted);

        preferences.setCommitResult(true);
        boolean secondPersisted = store.applyExchangeResult(
            new ProvisioningBootstrapExchangeResult(
                "session-123",
                7,
                "Tenant 7",
                "https://api.secpal.dev/v1",
                "managed_device",
                "https://secpal.dev/android/channels/managed_device/latest.json",
                Collections.emptyMap()
            )
        );
        assertTrue(secondPersisted);

        ProvisioningBootstrapState state = store.getState();
        assertEquals(ProvisioningBootstrapState.STATUS_COMPLETED, state.getStatus());
        assertEquals(7, state.getTenantId());
        assertEquals("Tenant 7", state.getTenantName());
        assertEquals("https://api.secpal.dev/v1", state.getApiBaseUrl());
        assertEquals("managed_device", state.getUpdateChannel());
        assertEquals("https://secpal.dev/android/channels/managed_device/latest.json", state.getReleaseMetadataUrl());
        assertNull(state.getLastErrorCode());
        assertNull(tokenStorage.token);
    }

    @Test
    public void markExchangeFailureClearsTokenForTerminalErrors() throws Exception {
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(
            new InMemorySharedPreferences(),
            tokenStorage
        );
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        store.markExchangeFailure("HTTP_409", true);

        ProvisioningBootstrapState state = store.getState();

        assertEquals(ProvisioningBootstrapState.STATUS_FAILED, state.getStatus());
        assertEquals("HTTP_409", state.getLastErrorCode());
        assertNull(tokenStorage.token);
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
        private final Map<String, Object> values = new HashMap<>();
        private boolean commitResult = true;

        void setCommitResult(boolean commitResult) {
            this.commitResult = commitResult;
        }

        @Override
        public Map<String, ?> getAll() { return Collections.unmodifiableMap(values); }

        @Override
        public String getString(String key, String defValue) {
            Object value = values.get(key);

            return value instanceof String ? (String) value : defValue;
        }

        @SuppressWarnings("unchecked")
        @Override
        public Set<String> getStringSet(String key, Set<String> defValues) {
            Object value = values.get(key);

            return value instanceof Set ? new LinkedHashSet<>((Set<String>) value) : defValues;
        }

        @Override
        public int getInt(String key, int defValue) {
            Object value = values.get(key);

            return value instanceof Integer ? (Integer) value : defValue;
        }

        @Override
        public long getLong(String key, long defValue) {
            Object value = values.get(key);

            return value instanceof Long ? (Long) value : defValue;
        }

        @Override
        public float getFloat(String key, float defValue) {
            Object value = values.get(key);

            return value instanceof Float ? (Float) value : defValue;
        }

        @Override
        public boolean getBoolean(String key, boolean defValue) {
            Object value = values.get(key);

            return value instanceof Boolean ? (Boolean) value : defValue;
        }

        @Override
        public boolean contains(String key) { return values.containsKey(key); }

        @Override
        public Editor edit() {
            return new Editor() {
                private final Map<String, Object> pendingValues = new HashMap<>();
                private final Set<String> removedKeys = new LinkedHashSet<>();
                private boolean clearRequested;

                @Override
                public Editor putString(String key, String value) {
                    pendingValues.put(key, value);
                    removedKeys.remove(key);
                    return this;
                }

                @Override
                public Editor putStringSet(String key, Set<String> values) {
                    pendingValues.put(key, new LinkedHashSet<>(values));
                    removedKeys.remove(key);
                    return this;
                }

                @Override
                public Editor putInt(String key, int value) {
                    pendingValues.put(key, value);
                    removedKeys.remove(key);
                    return this;
                }

                @Override
                public Editor putLong(String key, long value) {
                    pendingValues.put(key, value);
                    removedKeys.remove(key);
                    return this;
                }

                @Override
                public Editor putFloat(String key, float value) {
                    pendingValues.put(key, value);
                    removedKeys.remove(key);
                    return this;
                }

                @Override
                public Editor putBoolean(String key, boolean value) {
                    pendingValues.put(key, value);
                    removedKeys.remove(key);
                    return this;
                }

                @Override
                public Editor remove(String key) {
                    pendingValues.remove(key);
                    removedKeys.add(key);
                    return this;
                }

                @Override
                public Editor clear() {
                    clearRequested = true;
                    pendingValues.clear();
                    removedKeys.clear();
                    return this;
                }

                @Override
                public boolean commit() {
                    // Model real Android behavior: in-process map is updated
                    // before the disk write; commit() just reports disk success.
                    applyPendingChanges();
                    return commitResult;
                }

                @Override
                public void apply() {
                    applyPendingChanges();
                }

                private void applyPendingChanges() {
                    if (clearRequested) {
                        InMemorySharedPreferences.this.values.clear();
                    }

                    for (String key : removedKeys) {
                        InMemorySharedPreferences.this.values.remove(key);
                    }

                    InMemorySharedPreferences.this.values.putAll(pendingValues);
                }
            };
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
    }
}
