/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

final class EncryptedTokenPayload {
    private final String ciphertext;
    private final String initializationVector;

    EncryptedTokenPayload(String ciphertext, String initializationVector) {
        this.ciphertext = ciphertext;
        this.initializationVector = initializationVector;
    }

    String getCiphertext() { return ciphertext; }

    String getInitializationVector() { return initializationVector; }
}
