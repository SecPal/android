/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

interface TokenStorage {
    void saveToken(String token) throws TokenStorageException;
    String getToken() throws TokenStorageException;
    void clearToken();
}