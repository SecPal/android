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
import static org.junit.Assert.fail;

import android.content.SharedPreferences;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class AndroidPushIdentityStorageTest {
    private static final String API_ORIGIN = "https://tenant-a.example";
    private static final String TOKEN =
        "fcm-token-one-1234567890abcdefghijklmnopqrstuvwxyz";

    @Test
    public void protectedStateNeverPersistsRawIdentityValues() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);

        AndroidPushIdentityStorage.State state = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, TOKEN);

        String persisted = preferences.getString(
            AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY,
            null
        );
        assertFalse(persisted.contains(TOKEN));
        assertFalse(persisted.contains(state.installationId()));
        assertFalse(preferences.getAll().containsValue(TOKEN));
        assertFalse(preferences.getAll().containsValue(state.installationId()));
    }

    @Test
    public void restartReusesIdentityForTheSameRuntime() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);

        AndroidPushIdentityStorage.State first = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, TOKEN);
        AndroidPushIdentityStorage.State restored = createStorage(
            preferences,
            cipher,
            ids
        ).bindRuntime(API_ORIGIN, 3);

        assertEquals(first.installationId(), restored.installationId());
        assertEquals(TOKEN, restored.token());
    }

    @Test
    public void runtimeChangeCreatesAnUnregisteredIdentity() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);

        AndroidPushIdentityStorage.State first = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, TOKEN);
        AndroidPushIdentityStorage.State rebound = storage.bindRuntime(
            "https://tenant-b.example",
            4
        );

        assertNotEquals(first.installationId(), rebound.installationId());
        assertNull(rebound.token());
        assertFalse(rebound.hasServerRegistration());
    }

    @Test
    public void mismatchedTokenCallbackCannotCrossRuntimeBindings() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);

        AndroidPushIdentityStorage.State unchanged = storage.recordToken(
            "https://tenant-b.example",
            4,
            TOKEN
        );

        assertEquals(bound.installationId(), unchanged.installationId());
        assertNull(unchanged.token());
    }

    @Test
    public void unreadableStateIsInvalidatedAndRequiresTokenRotation()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putString(AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY, "missing")
            .putString(AndroidPushIdentityStorage.STATE_IV_KEY, "iv")
            .commit();
        AndroidPushIdentityStorage storage = createStorage(preferences);

        try {
            storage.load();
            fail("Expected protected storage failure");
        } catch (TokenStorageException expected) {
            assertTrue(storage.requiresTokenRotation());
            assertFalse(preferences.contains(
                AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY
            ));
            assertFalse(preferences.contains(AndroidPushIdentityStorage.STATE_IV_KEY));
        }
    }

    @Test
    public void aFreshTokenCompletesRequiredRotation() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        storage.invalidateIdentityForTokenRotation();
        storage.bindRuntime(API_ORIGIN, 3);

        storage.recordToken(API_ORIGIN, 3, TOKEN);

        assertFalse(storage.requiresTokenRotation());
    }

    private static AndroidPushIdentityStorage createStorage(
        InMemorySharedPreferences preferences
    ) {
        return createStorage(preferences, new MemoryCipher(), new AtomicInteger());
    }

    private static AndroidPushIdentityStorage createStorage(
        InMemorySharedPreferences preferences,
        TokenCipher cipher,
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
        private final Map<String, Object> values = new HashMap<>();

        @Override
        public Map<String, ?> getAll() { return values; }

        @Override
        public String getString(String key, String defaultValue) {
            Object value = values.get(key);
            return value instanceof String ? (String) value : defaultValue;
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
                public Editor putStringSet(String key, Set<String> value) {
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
                    values.put(key, value);
                    return this;
                }
            };
        }

        @Override
        public Set<String> getStringSet(String key, Set<String> defaults) {
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
            Object value = values.get(key);
            return value instanceof Boolean ? (Boolean) value : defaultValue;
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
