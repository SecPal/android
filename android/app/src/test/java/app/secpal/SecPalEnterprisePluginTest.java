/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Map;

import org.junit.Test;

public class SecPalEnterprisePluginTest {

    @Test
    public void buildDistributionStateMapIncludesChannelMetadataAfterSuccessfulBootstrap() {
        ProvisioningBootstrapState state = new ProvisioningBootstrapState(
            ProvisioningBootstrapState.STATUS_COMPLETED,
            "session-123",
            "managed_device",
            "https://apk.secpal.app/android/channels/managed_device/latest.json",
            "https://api.secpal.dev/v1",
            "Tenant 7",
            7,
            null
        );

        Map<String, Object> payload = SecPalEnterprisePlugin.buildDistributionStateMap(state);

        assertEquals("completed", payload.get("bootstrapStatus"));
        assertEquals("managed_device", payload.get("updateChannel"));
        assertEquals(
            "https://apk.secpal.app/android/channels/managed_device/latest.json",
            payload.get("releaseMetadataUrl")
        );
        assertNull(payload.get("bootstrapLastErrorCode"));
    }

    @Test
    public void buildDistributionStateMapPreservesFailedErrorVisibilityWithoutTokenData() {
        ProvisioningBootstrapState state = new ProvisioningBootstrapState(
            ProvisioningBootstrapState.STATUS_FAILED,
            "session-123",
            null,
            null,
            null,
            null,
            0,
            "HTTP_409"
        );

        Map<String, Object> payload = SecPalEnterprisePlugin.buildDistributionStateMap(state);

        assertEquals("failed", payload.get("bootstrapStatus"));
        assertNull(payload.get("updateChannel"));
        assertNull(payload.get("releaseMetadataUrl"));
        assertEquals("HTTP_409", payload.get("bootstrapLastErrorCode"));
    }

    @Test
    public void buildDistributionStateMapExposesPendingStatusWithoutTokenData() {
        ProvisioningBootstrapState state = new ProvisioningBootstrapState(
            ProvisioningBootstrapState.STATUS_PENDING,
            null,
            null,
            null,
            null,
            null,
            0,
            null
        );

        Map<String, Object> payload = SecPalEnterprisePlugin.buildDistributionStateMap(state);

        assertEquals("pending", payload.get("bootstrapStatus"));
        assertNull(payload.get("updateChannel"));
        assertNull(payload.get("releaseMetadataUrl"));
        assertNull(payload.get("bootstrapLastErrorCode"));
    }

    @Test
    public void shouldEmitHardwareButtonEventAcceptsOnlySingleActionDownForNonSystemKeys() {
        assertTrue(SecPalEnterprisePlugin.shouldEmitHardwareButtonEvent(0, 286, 0, false));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonEvent(0, 286, 1, false));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonEvent(0, 24, 0, false));
    }

    @Test
    public void hardwareButtonEventMapsIncludeKeyMetadataAndDurations() {
        Map<String, Object> pressedPayload = SecPalEnterprisePlugin.buildHardwareButtonEventMap(0, 286, 703, 0, 7, 257);
        Map<String, Object> shortPayload = SecPalEnterprisePlugin.buildHardwareButtonShortPressEventMap(
            286,
            703,
            0,
            2,
            257,
            1200L
        );
        Map<String, Object> longPayload = SecPalEnterprisePlugin.buildHardwareButtonLongPressEventMap(
            286,
            703,
            0,
            2,
            257,
            5000L
        );

        assertEquals("down", pressedPayload.get("action"));
        assertEquals("activity_dispatch", pressedPayload.get("origin"));
        assertEquals(286, pressedPayload.get("keyCode"));
        assertEquals("KEYCODE_STEM_PRIMARY", pressedPayload.get("keyName"));
        assertEquals(703, pressedPayload.get("scanCode"));
        assertEquals(0, pressedPayload.get("repeatCount"));
        assertEquals(7, pressedPayload.get("deviceId"));
        assertEquals(257, pressedPayload.get("source"));

        assertEquals("short_press", shortPayload.get("action"));
        assertEquals("activity_dispatch", shortPayload.get("origin"));
        assertEquals(1200L, shortPayload.get("holdDurationMs"));

        assertEquals("long_press", longPayload.get("action"));
        assertEquals("activity_dispatch", longPayload.get("origin"));
        assertEquals(5000L, longPayload.get("holdDurationMs"));
    }

    @Test
    public void hardwareButtonPressThresholdsRespectTheFiveSecondBoundary() {
        assertTrue(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 286, 0, false, 5000L));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 286, 0, false, 4999L));
        assertTrue(SecPalEnterprisePlugin.shouldEmitHardwareButtonShortPress(1, 286, 0, false, 4999L));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonShortPress(1, 286, 0, false, 5000L));
    }

    @Test
    public void shouldEmitHardwareButtonLongPressRejectsCanceledAndSystemKeys() {
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 286, 0, true, 5000L));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 24, 0, false, 5000L));
    }
}
