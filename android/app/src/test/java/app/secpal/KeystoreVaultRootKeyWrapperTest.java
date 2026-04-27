/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class KeystoreVaultRootKeyWrapperTest {

    /**
     * JVM-compatible Base64 codec using java.util.Base64 for unit tests.
     * Production code uses android.util.Base64 which is not available on the JVM.
     */
    private static KeystoreVaultRootKeyWrapper.Base64Codec jvmBase64Codec() {
        return new KeystoreVaultRootKeyWrapper.Base64Codec() {
            @Override
            public String encode(byte[] bytes) {
                return java.util.Base64.getEncoder().withoutPadding().encodeToString(bytes);
            }

            @Override
            public byte[] decode(String encoded) {
                return java.util.Base64.getDecoder().decode(encoded);
            }
        };
    }

    private static TokenCipher fakeTokenCipher() {
        return new TokenCipher() {
            @Override
            public EncryptedTokenPayload encrypt(String token) {
                return new EncryptedTokenPayload(token + "-cipher", "vault-iv");
            }

            @Override
            public String decrypt(EncryptedTokenPayload payload) {
                return payload.getCiphertext().replace("-cipher", "");
            }
        };
    }

    @Test
    public void wrapAndUnwrapRoundTripUsesInjectedCipher() throws Exception {
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(fakeTokenCipher(), jvmBase64Codec());

        String wrappedRootKey = wrapper.wrap("cm9vdC1rZXk=", "subject-hash");

        assertEquals(
            "cm9vdC1rZXk=",
            wrapper.unwrap(wrappedRootKey, "subject-hash")
        );
    }

    @Test
    public void unwrapFailsWhenWrappedRootKeyTargetsDifferentSubject() throws Exception {
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(fakeTokenCipher(), jvmBase64Codec());

        String wrappedRootKey = wrapper.wrap("cm9vdC1rZXk=", "subject-a");

        try {
            wrapper.unwrap(wrappedRootKey, "subject-b");
            fail("Expected TokenStorageException");
        } catch (TokenStorageException exception) {
            assertTrue(exception.getMessage().contains("different subject"));
        }
    }

    @Test
    public void unwrapFailsFastForInvalidEnvelopeData() {
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(fakeTokenCipher(), jvmBase64Codec());

        try {
            wrapper.unwrap("not-base64", "subject-hash");
            fail("Expected TokenStorageException");
        } catch (TokenStorageException exception) {
            assertTrue(exception.getMessage().contains("unwrap"));
        }
    }

    @Test
    public void isAvailableReturnsTrueWhenCipherSucceeds() {
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(fakeTokenCipher(), jvmBase64Codec());

        assertTrue(wrapper.isAvailable());
    }

    @Test
    public void isAvailableReturnsFalseWhenCipherThrows() {
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(
            new TokenCipher() {
                @Override
                public EncryptedTokenPayload encrypt(String token) throws TokenStorageException {
                    throw new TokenStorageException("Keystore unavailable", new RuntimeException("probe failed"));
                }

                @Override
                public String decrypt(EncryptedTokenPayload payload) throws TokenStorageException {
                    throw new TokenStorageException("Keystore unavailable", new RuntimeException("probe failed"));
                }
            },
            jvmBase64Codec()
        );

        assertFalse(wrapper.isAvailable());
    }
}