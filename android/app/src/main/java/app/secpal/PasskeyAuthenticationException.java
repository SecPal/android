/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

class PasskeyAuthenticationException extends Exception {
    private final String errorCode;

    PasskeyAuthenticationException(String message, String errorCode) {
        super(message);
        this.errorCode = errorCode;
    }

    PasskeyAuthenticationException(String message, String errorCode, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    String getErrorCode() {
        return errorCode;
    }
}
