/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

class NativeAuthHttpException extends Exception {
    private final int statusCode;

    NativeAuthHttpException(String message, int statusCode) { super(message); this.statusCode = statusCode; }

    int getStatusCode() { return statusCode; }
}
