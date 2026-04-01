/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

class NetworkUnavailableException extends Exception {
    NetworkUnavailableException(String message) {
        super(message);
    }
}
