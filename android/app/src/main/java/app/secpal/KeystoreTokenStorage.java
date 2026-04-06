/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.SharedPreferences;

class KeystoreTokenStorage implements TokenStorage {
    private static final String PREFERENCES_NAME = "secpal_native_auth";

    private final SharedPreferences preferences;
    private final TokenCipher tokenCipher;
    private final String tokenValueKey;
    private final String tokenIvKey;

    KeystoreTokenStorage(Context context) {
        this(context, "token");
    }

    KeystoreTokenStorage(Context context, String keyPrefix) {
        this(
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE),
            new KeystoreTokenCipher(),
            keyPrefix
        );
    }

    KeystoreTokenStorage(SharedPreferences preferences, TokenCipher tokenCipher) {
        this(preferences, tokenCipher, "token");
    }

    KeystoreTokenStorage(SharedPreferences preferences, TokenCipher tokenCipher, String keyPrefix) {
        this.preferences = preferences;
        this.tokenCipher = tokenCipher;
        String normalizedPrefix = keyPrefix == null || keyPrefix.trim().isEmpty()
            ? "token"
            : keyPrefix.trim();
        tokenValueKey = normalizedPrefix + "_ciphertext";
        tokenIvKey = normalizedPrefix + "_iv";
    }

    @Override
    public void saveToken(String token) throws TokenStorageException {
        EncryptedTokenPayload payload = tokenCipher.encrypt(token);

        preferences.edit()
            .putString(tokenValueKey, payload.getCiphertext())
            .putString(tokenIvKey, payload.getInitializationVector())
            .apply();
    }

    @Override
    public String getToken() throws TokenStorageException {
        String encodedCiphertext = preferences.getString(tokenValueKey, null);
        String encodedInitializationVector = preferences.getString(tokenIvKey, null);

        if (encodedCiphertext == null || encodedInitializationVector == null) {
            return null;
        }

        try {
            return tokenCipher.decrypt(new EncryptedTokenPayload(encodedCiphertext, encodedInitializationVector));
        } catch (TokenStorageException exception) {
            clearToken();
            throw exception;
        }
    }

    @Override
    public void clearToken() {
        preferences.edit()
            .remove(tokenValueKey)
            .remove(tokenIvKey)
            .apply();
    }
}
