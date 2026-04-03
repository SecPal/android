/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

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

final class KeystoreTokenCipher implements TokenCipher {
    private static final String KEYSTORE_TYPE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "secpal_native_auth_token";
    private static final int GCM_TAG_LENGTH = 128;

    @Override
    public EncryptedTokenPayload encrypt(String token) throws TokenStorageException {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());

            byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            byte[] initializationVector = cipher.getIV();

            return new EncryptedTokenPayload(
                Base64.encodeToString(ciphertext, Base64.NO_WRAP),
                Base64.encodeToString(initializationVector, Base64.NO_WRAP)
            );
        } catch (GeneralSecurityException exception) {
            throw new TokenStorageException("Failed to encrypt Android auth token", exception);
        }
    }

    @Override
    public String decrypt(EncryptedTokenPayload payload) throws TokenStorageException {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateSecretKey(),
                new GCMParameterSpec(GCM_TAG_LENGTH, Base64.decode(payload.getInitializationVector(), Base64.NO_WRAP))
            );

            byte[] plaintext = cipher.doFinal(Base64.decode(payload.getCiphertext(), Base64.NO_WRAP));

            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new TokenStorageException("Failed to decrypt Android auth token", exception);
        }
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
