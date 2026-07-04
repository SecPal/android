/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

class NetworkUnavailableException extends Exception {
    NetworkUnavailableException(String message) {
        super(message);
    }
}
