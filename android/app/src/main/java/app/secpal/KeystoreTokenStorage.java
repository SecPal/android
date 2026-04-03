/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.SharedPreferences;

class KeystoreTokenStorage implements TokenStorage {
    private static final String PREFERENCES_NAME = "secpal_native_auth";
    private static final String TOKEN_VALUE_KEY = "token_ciphertext";
    private static final String TOKEN_IV_KEY = "token_iv";

    private final SharedPreferences preferences;
    private final TokenCipher tokenCipher;

    KeystoreTokenStorage(Context context) {
        this(context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE), new KeystoreTokenCipher());
    }

    KeystoreTokenStorage(SharedPreferences preferences, TokenCipher tokenCipher) {
        this.preferences = preferences;
        this.tokenCipher = tokenCipher;
    }

    @Override
    public void saveToken(String token) throws TokenStorageException {
        EncryptedTokenPayload payload = tokenCipher.encrypt(token);

        preferences.edit()
            .putString(TOKEN_VALUE_KEY, payload.getCiphertext())
            .putString(TOKEN_IV_KEY, payload.getInitializationVector())
            .apply();
    }

    @Override
    public String getToken() throws TokenStorageException {
        String encodedCiphertext = preferences.getString(TOKEN_VALUE_KEY, null);
        String encodedInitializationVector = preferences.getString(TOKEN_IV_KEY, null);

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
            .remove(TOKEN_VALUE_KEY)
            .remove(TOKEN_IV_KEY)
            .apply();
    }
}
