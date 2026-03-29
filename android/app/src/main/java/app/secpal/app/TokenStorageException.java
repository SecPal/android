/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

class TokenStorageException extends Exception {
    TokenStorageException(String message, Throwable cause) { super(message, cause); }
}