/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

class KeystoreTokenStorage implements TokenStorage {
    private static final String KEYSTORE_TYPE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "secpal_native_auth_token";
    private static final String PREFERENCES_NAME = "secpal_native_auth";
    private static final String TOKEN_VALUE_KEY = "token_ciphertext";
    private static final String TOKEN_IV_KEY = "token_iv";
    private static final int GCM_TAG_LENGTH = 128;

    private final SharedPreferences preferences;

    KeystoreTokenStorage(Context context) {
        this.preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    @Override
    public void saveToken(String token) throws TokenStorageException {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());

            byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            byte[] initializationVector = cipher.getIV();

            preferences.edit()
                .putString(TOKEN_VALUE_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .putString(TOKEN_IV_KEY, Base64.encodeToString(initializationVector, Base64.NO_WRAP))
                .apply();
        } catch (GeneralSecurityException exception) {
            throw new TokenStorageException("Failed to encrypt Android auth token", exception);
        }
    }

    @Override
    public String getToken() throws TokenStorageException {
        String encodedCiphertext = preferences.getString(TOKEN_VALUE_KEY, null);
        String encodedInitializationVector = preferences.getString(TOKEN_IV_KEY, null);

        if (encodedCiphertext == null || encodedInitializationVector == null) {
            return null;
        }

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateSecretKey(),
                new GCMParameterSpec(GCM_TAG_LENGTH, Base64.decode(encodedInitializationVector, Base64.NO_WRAP))
            );

            byte[] plaintext = cipher.doFinal(Base64.decode(encodedCiphertext, Base64.NO_WRAP));

            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException exception) {
            clearToken();
            throw new TokenStorageException("Failed to decrypt Android auth token", exception);
        }
    }

    @Override
    public void clearToken() {
        preferences.edit()
            .remove(TOKEN_VALUE_KEY)
            .remove(TOKEN_IV_KEY)
            .apply();
    }

    private SecretKey getOrCreateSecretKey() throws GeneralSecurityException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_TYPE);
        try {
            keyStore.load(null);
        } catch (Exception exception) {
            throw new GeneralSecurityException("Failed to load Android keystore", exception);
        }

        SecretKey existingKey = (SecretKey) keyStore.getKey(KEY_ALIAS, null);

        if (existingKey != null) {
            return existingKey;
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_TYPE
        );
        keyGenerator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );

        return keyGenerator.generateKey();
    }
}