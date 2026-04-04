/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

interface TokenCipher {
    EncryptedTokenPayload encrypt(String token) throws TokenStorageException;

    String decrypt(EncryptedTokenPayload payload) throws TokenStorageException;
}
