/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class KeystoreVaultRootKeyWrapperTest {

    @Test
    public void wrapAndUnwrapRoundTripUsesInjectedCipher() throws Exception {
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(new TokenCipher() {
            @Override
            public EncryptedTokenPayload encrypt(String token) {
                return new EncryptedTokenPayload(token + "-cipher", "vault-iv");
            }

            @Override
            public String decrypt(EncryptedTokenPayload payload) {
                return payload.getCiphertext().replace("-cipher", "");
            }
        });

        String wrappedRootKey = wrapper.wrap("cm9vdC1rZXk=", "subject-hash");

        assertEquals(
            "cm9vdC1rZXk=",
            wrapper.unwrap(wrappedRootKey, "subject-hash")
        );
    }

    @Test
    public void unwrapFailsWhenWrappedRootKeyTargetsDifferentSubject() throws Exception {
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(new TokenCipher() {
            @Override
            public EncryptedTokenPayload encrypt(String token) {
                return new EncryptedTokenPayload(token + "-cipher", "vault-iv");
            }

            @Override
            public String decrypt(EncryptedTokenPayload payload) {
                return payload.getCiphertext().replace("-cipher", "");
            }
        });

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
        KeystoreVaultRootKeyWrapper wrapper = new KeystoreVaultRootKeyWrapper(new TokenCipher() {
            @Override
            public EncryptedTokenPayload encrypt(String token) {
                return new EncryptedTokenPayload(token, "vault-iv");
            }

            @Override
            public String decrypt(EncryptedTokenPayload payload) {
                return payload.getCiphertext();
            }
        });

        try {
            wrapper.unwrap("not-base64", "subject-hash");
            fail("Expected TokenStorageException");
        } catch (TokenStorageException exception) {
            assertTrue(exception.getMessage().contains("unwrap"));
        }
    }
}