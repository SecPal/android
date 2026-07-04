/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

interface TokenStorage {
    void saveToken(String token) throws TokenStorageException;
    String getToken() throws TokenStorageException;
    void clearToken();
}
