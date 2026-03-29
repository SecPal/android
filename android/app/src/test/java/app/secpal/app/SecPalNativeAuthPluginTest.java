/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class SecPalNativeAuthPluginTest {

    @Test
    public void resolveErrorCodeUsesHttpStatusWhenPresent() {
        assertEquals(
            "HTTP_401",
            SecPalNativeAuthPlugin.resolveErrorCode(new NativeAuthHttpException("Unauthenticated", 401))
        );
    }

    @Test
    public void resolveErrorCodeUsesValidationFallbackWhenStatusIsZero() {
        assertEquals(
            "VALIDATION_ERROR",
            SecPalNativeAuthPlugin.resolveErrorCode(new NativeAuthHttpException("Invalid", 0))
        );
    }

    @Test
    public void resolveErrorCodeIgnoresNonHttpExceptions() {
        assertNull(SecPalNativeAuthPlugin.resolveErrorCode(new IllegalStateException("boom")));
    }
}