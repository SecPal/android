/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

final class KeystoreVaultRootKeyWrapper {

    interface Base64Codec {
        String encode(byte[] bytes);
        byte[] decode(String encoded);
    }

    private static final String KEY_ALIAS = "secpal_offline_vault_root_key";
    private static final String VALUE_LABEL = "Android offline vault root key";
    private static final int WRAPPED_ROOT_KEY_VERSION = 1;

    private final TokenCipher tokenCipher;
    private final Base64Codec base64Codec;

    KeystoreVaultRootKeyWrapper() {
        this(new KeystoreTokenCipher(KEY_ALIAS, VALUE_LABEL), androidBase64Codec());
    }

    KeystoreVaultRootKeyWrapper(TokenCipher tokenCipher) {
        this(tokenCipher, androidBase64Codec());
    }

    KeystoreVaultRootKeyWrapper(TokenCipher tokenCipher, Base64Codec base64Codec) {
        this.tokenCipher = tokenCipher;
        this.base64Codec = base64Codec;
    }

    private static Base64Codec androidBase64Codec() {
        return new Base64Codec() {
            @Override
            public String encode(byte[] bytes) {
                return Base64.encodeToString(bytes, Base64.NO_WRAP | Base64.NO_PADDING);
            }

            @Override
            public byte[] decode(String encoded) {
                return Base64.decode(encoded, Base64.NO_WRAP);
            }
        };
    }

    boolean isAvailable() {
        try {
            EncryptedTokenPayload probePayload = tokenCipher.encrypt("availability-check");
            return probePayload != null
                && probePayload.getCiphertext() != null
                && !probePayload.getCiphertext().trim().isEmpty()
                && probePayload.getInitializationVector() != null
                && !probePayload.getInitializationVector().trim().isEmpty();
        } catch (Exception exception) {
            return false;
        }
    }

    String wrap(String rootKeyBase64, String subjectHash) throws TokenStorageException {
        String normalizedRootKeyBase64 = requireValue(rootKeyBase64, "rootKeyBase64", "wrap");
        String normalizedSubjectHash = requireValue(subjectHash, "subjectHash", "wrap");

        try {
            JSONObject payload = new JSONObject();
            payload.put("version", WRAPPED_ROOT_KEY_VERSION);
            payload.put("subjectHash", normalizedSubjectHash);
            payload.put("rootKeyBase64", normalizedRootKeyBase64);

            EncryptedTokenPayload encryptedPayload = tokenCipher.encrypt(payload.toString());

            JSONObject envelope = new JSONObject();
            envelope.put("version", WRAPPED_ROOT_KEY_VERSION);
            envelope.put("ciphertext", encryptedPayload.getCiphertext());
            envelope.put("initializationVector", encryptedPayload.getInitializationVector());

            return base64Codec.encode(envelope.toString().getBytes(StandardCharsets.UTF_8));
        } catch (JSONException exception) {
            throw new TokenStorageException("Failed to wrap Android offline vault root key", exception);
        }
    }

    String unwrap(String wrappedRootKey, String subjectHash) throws TokenStorageException {
        String normalizedWrappedRootKey = requireValue(wrappedRootKey, "wrappedRootKey", "unwrap");
        String normalizedSubjectHash = requireValue(subjectHash, "subjectHash", "unwrap");

        try {
            JSONObject envelope = new JSONObject(
                new String(base64Codec.decode(normalizedWrappedRootKey), StandardCharsets.UTF_8)
            );
            int version = envelope.optInt("version", -1);
            String ciphertext = envelope.optString("ciphertext", null);
            String initializationVector = envelope.optString("initializationVector", null);

            if (
                version != WRAPPED_ROOT_KEY_VERSION
                    || ciphertext == null
                    || ciphertext.trim().isEmpty()
                    || initializationVector == null
                    || initializationVector.trim().isEmpty()
            ) {
                throw new TokenStorageException(
                    "Failed to unwrap Android offline vault root key: invalid wrapped-root-key envelope",
                    new IllegalArgumentException("Invalid wrapped-root-key envelope")
                );
            }

            String decryptedPayload = tokenCipher.decrypt(new EncryptedTokenPayload(ciphertext, initializationVector));
            JSONObject payload = new JSONObject(decryptedPayload);

            if (payload.optInt("version", -1) != WRAPPED_ROOT_KEY_VERSION) {
                throw new TokenStorageException(
                    "Failed to unwrap Android offline vault root key: unsupported wrapped-root-key version",
                    new IllegalArgumentException("Unsupported wrapped-root-key version")
                );
            }

            String payloadSubjectHash = payload.optString("subjectHash", null);
            String rootKeyBase64 = payload.optString("rootKeyBase64", null);

            if (
                payloadSubjectHash == null
                    || payloadSubjectHash.trim().isEmpty()
                    || rootKeyBase64 == null
                    || rootKeyBase64.trim().isEmpty()
            ) {
                throw new TokenStorageException(
                    "Failed to unwrap Android offline vault root key: decrypted payload is incomplete",
                    new IllegalArgumentException("Incomplete wrapped-root-key payload")
                );
            }

            if (!normalizedSubjectHash.equals(payloadSubjectHash)) {
                throw new TokenStorageException(
                    "Failed to unwrap Android offline vault root key for a different subject",
                    new IllegalArgumentException("Wrapped root key subject mismatch")
                );
            }

            return rootKeyBase64;
        } catch (IllegalArgumentException | JSONException exception) {
            throw new TokenStorageException("Failed to unwrap Android offline vault root key", exception);
        }
    }

    private String requireValue(String value, String fieldName, String operation) throws TokenStorageException {
        if (value == null || value.trim().isEmpty()) {
            throw new TokenStorageException(
                "Failed to " + operation + " Android offline vault root key: missing required value " + fieldName,
                new IllegalArgumentException("Missing required value: " + fieldName)
            );
        }

        return value.trim();
    }
}