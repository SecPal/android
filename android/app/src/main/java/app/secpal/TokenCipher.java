/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

interface TokenCipher {
    EncryptedTokenPayload encrypt(String token) throws TokenStorageException;

    String decrypt(EncryptedTokenPayload payload) throws TokenStorageException;
}
