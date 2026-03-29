/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.content.SharedPreferences;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class KeystoreTokenStorageTest {

    @Test
    public void saveAndLoadRoundTripUsesInjectedCipher() throws Exception {
        KeystoreTokenStorage storage = new KeystoreTokenStorage(new InMemorySharedPreferences(), new FakeTokenCipher());

        storage.saveToken("secret-token");

        assertEquals("secret-token", storage.getToken());
    }

    @Test
    public void getTokenReturnsNullWhenStorageIsEmpty() throws Exception {
        KeystoreTokenStorage storage = new KeystoreTokenStorage(new InMemorySharedPreferences(), new FakeTokenCipher());

        assertNull(storage.getToken());
    }

    @Test
    public void failedDecryptClearsPersistedValues() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        KeystoreTokenStorage storage = new KeystoreTokenStorage(preferences, new FakeTokenCipher());

        storage.saveToken("secret-token");
        KeystoreTokenStorage failingStorage = new KeystoreTokenStorage(preferences, new TokenCipher() {
            @Override
            public EncryptedTokenPayload encrypt(String token) {
                return new EncryptedTokenPayload(token, token);
            }

            @Override
            public String decrypt(EncryptedTokenPayload payload) throws TokenStorageException {
                throw new TokenStorageException("boom", new IllegalStateException("broken"));
            }
        });

        try {
            failingStorage.getToken();
        } catch (TokenStorageException ignored) {
            // Expected path.
        }

        assertNull(preferences.getString("token_ciphertext", null));
        assertNull(preferences.getString("token_iv", null));
    }

    private static final class FakeTokenCipher implements TokenCipher {
        @Override
        public EncryptedTokenPayload encrypt(String token) {
            return new EncryptedTokenPayload(token + "-cipher", token + "-iv");
        }

        @Override
        public String decrypt(EncryptedTokenPayload payload) {
            return payload.getCiphertext().replace("-cipher", "");
        }
    }

    private static final class InMemorySharedPreferences implements SharedPreferences {
        private final Map<String, String> values = new HashMap<>();

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
            return new Editor() {
                @Override
                public Editor putString(String key, String value) { values.put(key, value); return this; }

                @Override
                public Editor remove(String key) { values.remove(key); return this; }

                @Override
                public Editor clear() { values.clear(); return this; }

                @Override
                public void apply() {}

                @Override
                public boolean commit() { return true; }

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
