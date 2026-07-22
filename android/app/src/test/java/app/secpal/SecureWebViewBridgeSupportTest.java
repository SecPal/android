/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SecureWebViewBridgeSupportTest {
    @Test
    public void acceptsSupportedOriginAwareWebMessageListener() {
        assertTrue(SecureWebViewBridgeSupport.isAvailable(() -> true, () -> "83.0.4103.106"));
    }

    @Test
    public void rejectsUnavailableOriginAwareWebMessageListener() {
        assertFalse(SecureWebViewBridgeSupport.isAvailable(() -> false, () -> "83.0.4103.106"));
    }

    @Test
    public void rejectsWebViewBelowSupportedFloor() {
        assertFalse(SecureWebViewBridgeSupport.isAvailable(() -> true, () -> "82.0.4085.5"));
    }

    @Test
    public void rejectsMissingOrMalformedWebViewVersion() {
        assertFalse(SecureWebViewBridgeSupport.isAvailable(() -> true, () -> null));
        assertFalse(SecureWebViewBridgeSupport.isAvailable(() -> true, () -> "unknown"));
    }

    @Test
    public void rejectsCapabilityDetectionFailure() {
        assertFalse(
            SecureWebViewBridgeSupport.isAvailable(
                () -> {
                    throw new RuntimeException("WebView provider unavailable");
                },
                () -> "83.0.4103.106"
            )
        );
    }

    @Test
    public void rejectsWebViewVersionDetectionFailure() {
        assertFalse(
            SecureWebViewBridgeSupport.isAvailable(
                () -> true,
                () -> {
                    throw new RuntimeException("WebView package unavailable");
                }
            )
        );
    }

    @Test
    public void recognizesListenerInstallationFailure() {
        assertTrue(
            SecureWebViewBridgeSupport.isBridgeSecurityFailure(
                new IllegalStateException(SecureWebViewBridgeSupport.INSTALLATION_FAILURE_MESSAGE)
            )
        );
    }

    @Test
    public void doesNotHideUnrelatedBridgeFailure() {
        assertFalse(
            SecureWebViewBridgeSupport.isBridgeSecurityFailure(
                new IllegalStateException("Unrelated bridge failure")
            )
        );
    }
}
