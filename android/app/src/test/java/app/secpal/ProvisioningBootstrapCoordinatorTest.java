/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.content.SharedPreferences;

import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import org.json.JSONException;
import org.junit.Test;

public class ProvisioningBootstrapCoordinatorTest {

    @Test
    public void syncPendingBootstrapAppliesExchangeResultWhenOnline() throws Exception {
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(
            new InMemorySharedPreferences(),
            tokenStorage
        );
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        FakeExchangeClient exchangeClient = new FakeExchangeClient();
        exchangeClient.result = createExchangeResult();

        ProvisioningBootstrapCoordinator coordinator = new ProvisioningBootstrapCoordinator(
            store,
            exchangeClient,
            () -> true,
            new ProvisioningBootstrapRuntimeInfo(
                "app.secpal",
                "1.4.0",
                10400,
                "SM-G556B reception tablet",
                "samsung",
                "SM-G556B",
                "16"
            )
        );

        coordinator.syncPendingBootstrap();

        ProvisioningBootstrapState state = store.getState();

        assertEquals(ProvisioningBootstrapState.STATUS_COMPLETED, state.getStatus());
        assertEquals("bootstrap-token-123", exchangeClient.bootstrapToken);
        assertEquals("app.secpal", exchangeClient.runtimeInfo.getPackageName());
        assertEquals("managed_device", state.getUpdateChannel());
        assertNull(tokenStorage.token);
    }

    @Test
    public void syncPendingBootstrapLeavesPendingStateWhenOffline() throws Exception {
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(
            new InMemorySharedPreferences(),
            tokenStorage
        );
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        FakeExchangeClient exchangeClient = new FakeExchangeClient();
        ProvisioningBootstrapCoordinator coordinator = new ProvisioningBootstrapCoordinator(
            store,
            exchangeClient,
            () -> false,
            new ProvisioningBootstrapRuntimeInfo("app.secpal", "1.4.0", 10400, null, null, null, null)
        );

        coordinator.syncPendingBootstrap();

        ProvisioningBootstrapState state = store.getState();

        assertEquals(ProvisioningBootstrapState.STATUS_PENDING, state.getStatus());
        assertNull(state.getLastErrorCode());
        assertEquals(0, exchangeClient.callCount);
        assertEquals("bootstrap-token-123", tokenStorage.token);
    }

    @Test
    public void syncPendingBootstrapMarksTerminalHttpErrorsAsFailed() throws Exception {
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(
            new InMemorySharedPreferences(),
            tokenStorage
        );
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        FakeExchangeClient exchangeClient = new FakeExchangeClient();
        exchangeClient.httpException = new NativeAuthHttpException("Conflict", 409);

        ProvisioningBootstrapCoordinator coordinator = new ProvisioningBootstrapCoordinator(
            store,
            exchangeClient,
            () -> true,
            new ProvisioningBootstrapRuntimeInfo("app.secpal", "1.4.0", 10400, null, null, null, null)
        );

        coordinator.syncPendingBootstrap();

        ProvisioningBootstrapState state = store.getState();

        assertEquals(ProvisioningBootstrapState.STATUS_FAILED, state.getStatus());
        assertEquals("HTTP_409", state.getLastErrorCode());
        assertNull(tokenStorage.token);
    }

    @Test
    public void syncPendingBootstrapKeepsRetriableErrorsPending() throws Exception {
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ProvisioningBootstrapStore store = new ProvisioningBootstrapStore(
            new InMemorySharedPreferences(),
            tokenStorage
        );
        store.persistProvisioningData("bootstrap-token-123", "session-123");

        FakeExchangeClient exchangeClient = new FakeExchangeClient();
        exchangeClient.ioException = new IOException("temporary outage");

        ProvisioningBootstrapCoordinator coordinator = new ProvisioningBootstrapCoordinator(
            store,
            exchangeClient,
            () -> true,
            new ProvisioningBootstrapRuntimeInfo("app.secpal", "1.4.0", 10400, null, null, null, null)
        );

        coordinator.syncPendingBootstrap();

        ProvisioningBootstrapState state = store.getState();

        assertEquals(ProvisioningBootstrapState.STATUS_PENDING, state.getStatus());
        assertEquals("BOOTSTRAP_EXCHANGE_RETRY", state.getLastErrorCode());
        assertEquals("bootstrap-token-123", tokenStorage.token);
    }

    private static ProvisioningBootstrapExchangeResult createExchangeResult() {
        Map<String, Object> profile = new HashMap<>();

        profile.put("secpal_kiosk_mode_enabled", true);
        profile.put("secpal_lock_task_enabled", true);

        return new ProvisioningBootstrapExchangeResult(
            "session-123",
            7,
            "Tenant 7",
            "https://api.secpal.dev/v1",
            "managed_device",
            "https://api.secpal.dev/v1/android/releases/channels/managed_device/latest",
            profile
        );
    }

    private static final class FakeExchangeClient implements ProvisioningBootstrapCoordinator.ExchangeClient {
        private ProvisioningBootstrapExchangeResult result;
        private NativeAuthHttpException httpException;
        private IOException ioException;
        private JSONException jsonException;
        private String bootstrapToken;
        private ProvisioningBootstrapRuntimeInfo runtimeInfo;
        private int callCount;

        @Override
        public ProvisioningBootstrapExchangeResult exchange(
            String bootstrapToken,
            ProvisioningBootstrapRuntimeInfo runtimeInfo
        ) throws IOException, JSONException, NativeAuthHttpException {
            this.bootstrapToken = bootstrapToken;
            this.runtimeInfo = runtimeInfo;
            callCount++;

            if (httpException != null) {
                throw httpException;
            }

            if (ioException != null) {
                throw ioException;
            }

            if (jsonException != null) {
                throw jsonException;
            }

            return result;
        }
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
                @Override
                public Editor putString(String key, String value) { values.put(key, value); return this; }

                @Override
                public Editor putStringSet(String key, Set<String> values) {
                    InMemorySharedPreferences.this.values.put(key, new LinkedHashSet<>(values));
                    return this;
                }

                @Override
                public Editor putInt(String key, int value) { values.put(key, value); return this; }

                @Override
                public Editor putLong(String key, long value) { values.put(key, value); return this; }

                @Override
                public Editor putFloat(String key, float value) { values.put(key, value); return this; }

                @Override
                public Editor putBoolean(String key, boolean value) { values.put(key, value); return this; }

                @Override
                public Editor remove(String key) { values.remove(key); return this; }

                @Override
                public Editor clear() { values.clear(); return this; }

                @Override
                public boolean commit() { return true; }

                @Override
                public void apply() {}
            };
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
    }
}
