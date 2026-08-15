/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class AndroidPushRegistrationManagerTest {
    private static final String API_ORIGIN = "https://tenant-a.example";
    private static final String TOKEN_ONE =
        "fcm-token-one-1234567890abcdefghijklmnopqrstuvwxyz";
    private static final String TOKEN_TWO =
        "fcm-token-two-1234567890abcdefghijklmnopqrstuvwxyz";

    @Test
    public void protectedStateNeverPersistsRawIdentityValues() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);

        AndroidPushIdentityStorage.State state = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, TOKEN_ONE);

        String persisted = preferences.getString(
            AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY,
            null
        );
        assertFalse(persisted.contains(TOKEN_ONE));
        assertFalse(persisted.contains(state.installationId()));
        assertFalse(preferences.getAll().containsValue(TOKEN_ONE));
        assertFalse(preferences.getAll().containsValue(state.installationId()));
    }

    @Test
    public void appRestartReusesBindingButRuntimeChangeInvalidatesIt() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);

        AndroidPushIdentityStorage.State first = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, TOKEN_ONE);
        AndroidPushIdentityStorage restarted = createStorage(preferences, cipher, ids);
        AndroidPushIdentityStorage.State restored = restarted.bindRuntime(API_ORIGIN, 3);

        assertEquals(first.installationId(), restored.installationId());
        assertEquals(TOKEN_ONE, restored.token());

        AndroidPushIdentityStorage.State rebound = restarted.bindRuntime(
            "https://tenant-b.example",
            4
        );
        assertNotEquals(first.installationId(), rebound.installationId());
        assertNull(rebound.token());
    }

    @Test
    public void duplicateAndRotatedTokensAreRegisteredIdempotently() throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.onAuthenticated("auth-token");

        assertEquals(1, backend.lifecycleEvents.size());
        assertEquals("registered", backend.lifecycleEvents.get(0));
        assertEquals("registered", manager.getStatus().getString("state"));

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            "auth-token"
        );
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            "auth-token"
        );

        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals("credential_rotated", backend.lifecycleEvents.get(1));
    }

    @Test
    public void coldStartRestoresTheRegisteredAbstractStatus() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.bindRuntime(API_ORIGIN, pushMetadata(3));

        assertEquals("registered", restarted.getStatus().getString("state"));
        assertFalse(restarted.getStatus().has("token"));
        assertFalse(restarted.getStatus().has("installationId"));
        assertEquals(1, backend.lifecycleEvents.size());
    }

    @Test
    public void logoutRevokesBeforeReauthenticationAndKeepsIdentifiersNative()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        manager.onLogout("auth-token");

        assertEquals(1, backend.unregisterCount);
        assertEquals("awaiting_auth", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().has("installationId"));
        assertFalse(manager.getStatus().has("token"));
        assertFalse(manager.getStatus().has("tokenReceivedAt"));

        manager.onAuthenticated("next-auth-token");
        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals("registered", backend.lifecycleEvents.get(1));
    }

    @Test
    public void disabledRuntimeRemainsDisabledAcrossAuthenticationAndLogout()
        throws Exception {
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, null);

        manager.onAuthenticated("auth-token");
        assertEquals("disabled", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().getBool("configured"));

        manager.onTokenError(AndroidPushRegistrationManager.RUNTIME_APP_NAME);
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        assertEquals("disabled", manager.getStatus().getString("state"));

        manager.onLogout("auth-token");
        assertEquals("disabled", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().getBool("retryable"));
    }

    @Test
    public void runtimeChangeRevokesAndInvalidatesThePreviousBinding()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );
        manager.revokePrevious(rebind, "auth-token");

        assertEquals(1, backend.unregisterCount);
        assertEquals("awaiting_token", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().has("apiOrigin"));
        assertFalse(manager.getStatus().has("metadataRevision"));
    }

    @Test
    public void failedRuntimeApplyCanRestoreTheExactPreviousIdentity()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        String originalInstallationId = storage.load().installationId();

        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );
        manager.rollbackRebind(rebind);

        assertEquals(originalInstallationId, storage.load().installationId());
        assertEquals(TOKEN_ONE, storage.load().token());
        assertEquals("registered", manager.getStatus().getString("state"));
        assertEquals(0, backend.unregisterCount);
    }

    @Test
    public void failedRuntimeApplyRestoresDisabledPushState() throws Exception {
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, null);

        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );
        assertEquals("awaiting_token", manager.getStatus().getString("state"));

        manager.rollbackRebind(rebind);

        assertEquals("disabled", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().getBool("configured"));
    }

    @Test
    public void offlineRegistrationRemainsPendingForExplicitRetry() throws Exception {
        RecordingBackend backend = new RecordingBackend();
        backend.offline = true;
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        assertEquals("retry_pending", manager.getStatus().getString("state"));
        assertTrue(manager.getStatus().getBool("retryable"));

        backend.offline = false;
        manager.onAuthenticated("auth-token");
        assertEquals("registered", manager.getStatus().getString("state"));
    }

    @Test
    public void abstractStatusRemainsReadableWhileRegistrationIsInFlight()
        throws Exception {
        BlockingBackend backend = new BlockingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<?> registration = executor.submit(() -> {
                try {
                    manager.onTokenReceived(
                        AndroidPushRegistrationManager.RUNTIME_APP_NAME,
                        TOKEN_ONE,
                        "auth-token"
                    );
                } catch (TokenStorageException exception) {
                    throw new IllegalStateException(exception);
                }
            });
            assertTrue(backend.registrationStarted.await(2, TimeUnit.SECONDS));

            Future<JSObject> status = executor.submit(manager::getStatus);
            assertTrue(status.get(1, TimeUnit.SECONDS).getBool("configured"));

            backend.allowRegistrationToFinish.countDown();
            registration.get(2, TimeUnit.SECONDS);
        } finally {
            backend.allowRegistrationToFinish.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    public void nativeBackendBuildsTheCanonicalSchemaFourPayload() throws Exception {
        CapturingHttpClient client = new CapturingHttpClient();
        AndroidPushRegistrationManager.HttpBackend backend =
            new AndroidPushRegistrationManager.HttpBackend(client, "1.5.0", 10500);
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State state = storage.bindRuntime(API_ORIGIN, 3);
        state = storage.recordToken(API_ORIGIN, 3, TOKEN_ONE);

        assertEquals(
            201,
            backend.register(API_ORIGIN, "auth-token", state, "registered")
        );

        assertEquals("PUT", client.method);
        assertEquals(
            "/v1/me/notification-installations/" + state.installationId(),
            client.path
        );
        JSONObject body = new JSONObject(
            new String(
                Base64.decode(client.bodyBase64, Base64.NO_WRAP),
                StandardCharsets.UTF_8
            )
        );
        assertEquals(TOKEN_ONE, body.getJSONObject("registration").getString("push_token"));
        assertEquals(4, body.getJSONObject("runtime").getInt("schema_version"));
        assertEquals(3, body.getJSONObject("runtime").getInt("metadata_revision"));
        assertEquals("registered", body.getString("lifecycle_event"));
    }

    private static AndroidPushIdentityStorage createStorage(
        InMemorySharedPreferences preferences
    ) {
        return createStorage(preferences, new MemoryCipher(), new AtomicInteger());
    }

    private static AndroidPushIdentityStorage createStorage(
        InMemorySharedPreferences preferences,
        MemoryCipher cipher,
        AtomicInteger ids
    ) {
        return new AndroidPushIdentityStorage(
            preferences,
            cipher,
            () -> String.format(
                "00000000-0000-4000-8000-%012d",
                ids.incrementAndGet()
            ),
            () -> 1_700_000_000_000L
        );
    }

    private static AndroidPushRuntimeMetadata pushMetadata(int revision) {
        return new AndroidPushRuntimeMetadata(
            "fcm",
            revision,
            "api-key",
            "project-id",
            "application-id",
            "sender-id"
        );
    }

    private static final class RecordingBackend
        implements AndroidPushRegistrationManager.Backend {
        final List<String> lifecycleEvents = new ArrayList<>();
        int unregisterCount;
        boolean offline;

        @Override
        public int register(
            String apiOrigin,
            String authToken,
            AndroidPushIdentityStorage.State state,
            String lifecycleEvent
        ) throws IOException {
            if (offline) {
                throw new IOException("offline");
            }
            assertEquals(API_ORIGIN, apiOrigin);
            assertFalse(state.installationId().isEmpty());
            assertTrue(state.token().startsWith("fcm-token-"));
            lifecycleEvents.add(lifecycleEvent);
            return 201;
        }

        @Override
        public int unregister(
            String apiOrigin,
            String authToken,
            String installationId
        ) {
            unregisterCount += 1;
            return 204;
        }
    }

    private static final class BlockingBackend
        implements AndroidPushRegistrationManager.Backend {
        final CountDownLatch registrationStarted = new CountDownLatch(1);
        final CountDownLatch allowRegistrationToFinish = new CountDownLatch(1);

        @Override
        public int register(
            String apiOrigin,
            String authToken,
            AndroidPushIdentityStorage.State state,
            String lifecycleEvent
        ) throws IOException {
            registrationStarted.countDown();
            try {
                if (!allowRegistrationToFinish.await(5, TimeUnit.SECONDS)) {
                    throw new IOException("registration test timed out");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IOException("registration test interrupted", exception);
            }
            return 201;
        }

        @Override
        public int unregister(
            String apiOrigin,
            String authToken,
            String installationId
        ) {
            return 204;
        }
    }

    private static final class CapturingHttpClient extends NativeAuthHttpClient {
        String method;
        String path;
        String bodyBase64;

        @Override
        JSObject request(
            String baseUrl,
            String token,
            String method,
            String path,
            String requestBodyBase64,
            String contentType,
            String accept
        ) {
            this.method = method;
            this.path = path;
            this.bodyBase64 = requestBodyBase64;
            JSObject response = new JSObject();
            response.put("status", 201);
            return response;
        }
    }

    private static final class MemoryCipher implements TokenCipher {
        private final Map<String, String> plaintextByCiphertext = new HashMap<>();
        private int sequence;

        @Override
        public EncryptedTokenPayload encrypt(String plaintext) {
            String ciphertext = "encrypted-" + ++sequence;
            plaintextByCiphertext.put(ciphertext, plaintext);
            return new EncryptedTokenPayload(ciphertext, "iv-" + sequence);
        }

        @Override
        public String decrypt(EncryptedTokenPayload payload)
            throws TokenStorageException {
            String plaintext = plaintextByCiphertext.get(payload.getCiphertext());
            if (plaintext == null) {
                throw new TokenStorageException(
                    "missing ciphertext",
                    new IllegalStateException("missing")
                );
            }
            return plaintext;
        }
    }

    private static final class InMemorySharedPreferences implements SharedPreferences {
        private final Map<String, String> values = new HashMap<>();

        @Override
        public Map<String, ?> getAll() { return values; }

        @Override
        public String getString(String key, String defaultValue) {
            return values.getOrDefault(key, defaultValue);
        }

        @Override
        public boolean contains(String key) { return values.containsKey(key); }

        @Override
        public Editor edit() {
            return new Editor() {
                @Override
                public Editor putString(String key, String value) {
                    values.put(key, value);
                    return this;
                }

                @Override
                public Editor remove(String key) {
                    values.remove(key);
                    return this;
                }

                @Override
                public Editor clear() {
                    values.clear();
                    return this;
                }

                @Override
                public boolean commit() { return true; }

                @Override
                public void apply() {}

                @Override
                public Editor putStringSet(String key, Set<String> values) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putInt(String key, int value) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putLong(String key, long value) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putFloat(String key, float value) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putBoolean(String key, boolean value) {
                    throw new UnsupportedOperationException();
                }
            };
        }

        @Override
        public Set<String> getStringSet(String key, Set<String> defaultValues) {
            throw new UnsupportedOperationException();
        }

        @Override
        public int getInt(String key, int defaultValue) {
            throw new UnsupportedOperationException();
        }

        @Override
        public long getLong(String key, long defaultValue) {
            throw new UnsupportedOperationException();
        }

        @Override
        public float getFloat(String key, float defaultValue) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean getBoolean(String key, boolean defaultValue) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(
            OnSharedPreferenceChangeListener listener
        ) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(
            OnSharedPreferenceChangeListener listener
        ) {}
    }
}
