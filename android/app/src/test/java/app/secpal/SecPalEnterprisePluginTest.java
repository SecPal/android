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
    public void shouldEmitHardwareButtonEventAcceptsSingleActionDownForNonSystemKeys() {
        assertTrue(SecPalEnterprisePlugin.shouldEmitHardwareButtonEvent(0, 286, 0, false));
    }

    @Test
    public void shouldEmitHardwareButtonEventRejectsRepeatedAndSystemKeys() {
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonEvent(0, 286, 1, false));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonEvent(0, 24, 0, false));
    }

    @Test
    public void buildHardwareButtonEventMapIncludesKeyMetadata() {
        Map<String, Object> payload = SecPalEnterprisePlugin.buildHardwareButtonEventMap(0, 286, 703, 0, 7, 257);

        assertEquals("down", payload.get("action"));
        assertEquals("activity_dispatch", payload.get("origin"));
        assertEquals(286, payload.get("keyCode"));
        assertEquals("KEYCODE_STEM_PRIMARY", payload.get("keyName"));
        assertEquals(703, payload.get("scanCode"));
        assertEquals(0, payload.get("repeatCount"));
        assertEquals(7, payload.get("deviceId"));
        assertEquals(257, payload.get("source"));
    }

    @Test
    public void shouldEmitHardwareButtonLongPressRequiresAtLeastFiveSeconds() {
        assertTrue(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 286, 0, false, 5000L));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 286, 0, false, 4999L));
    }

    @Test
    public void shouldEmitHardwareButtonShortPressOnlyBelowFiveSeconds() {
        assertTrue(SecPalEnterprisePlugin.shouldEmitHardwareButtonShortPress(1, 286, 0, false, 4999L));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonShortPress(1, 286, 0, false, 5000L));
    }

    @Test
    public void shouldEmitHardwareButtonLongPressRejectsCanceledAndSystemKeys() {
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 286, 0, true, 5000L));
        assertFalse(SecPalEnterprisePlugin.shouldEmitHardwareButtonLongPress(1, 24, 0, false, 5000L));
    }

    @Test
    public void buildHardwareButtonLongPressEventMapIncludesHoldDuration() {
        Map<String, Object> payload = SecPalEnterprisePlugin.buildHardwareButtonLongPressEventMap(
            286,
            703,
            0,
            2,
            257,
            5000L
        );

        assertEquals("long_press", payload.get("action"));
        assertEquals("activity_dispatch", payload.get("origin"));
        assertEquals(286, payload.get("keyCode"));
        assertEquals("KEYCODE_STEM_PRIMARY", payload.get("keyName"));
        assertEquals(703, payload.get("scanCode"));
        assertEquals(0, payload.get("repeatCount"));
        assertEquals(2, payload.get("deviceId"));
        assertEquals(257, payload.get("source"));
        assertEquals(5000L, payload.get("holdDurationMs"));
    }

    @Test
    public void buildHardwareButtonShortPressEventMapIncludesHoldDuration() {
        Map<String, Object> payload = SecPalEnterprisePlugin.buildHardwareButtonShortPressEventMap(
            286,
            703,
            0,
            2,
            257,
            1200L
        );

        assertEquals("short_press", payload.get("action"));
        assertEquals("activity_dispatch", payload.get("origin"));
        assertEquals(286, payload.get("keyCode"));
        assertEquals("KEYCODE_STEM_PRIMARY", payload.get("keyName"));
        assertEquals(703, payload.get("scanCode"));
        assertEquals(0, payload.get("repeatCount"));
        assertEquals(2, payload.get("deviceId"));
        assertEquals(257, payload.get("source"));
        assertEquals(1200L, payload.get("holdDurationMs"));
    }

    @Test
    public void buildSamsungKnoxHardwareButtonEventMapMarksSamsungOrigin() {
        Map<String, Object> payload = SecPalEnterprisePlugin.buildSamsungKnoxHardwareButtonEventMap(1015);

        assertEquals("down", payload.get("action"));
        assertEquals("samsung_knox_broadcast", payload.get("origin"));
        assertEquals(1015, payload.get("keyCode"));
        assertEquals(-1, payload.get("scanCode"));
        assertEquals(0, payload.get("repeatCount"));
        assertEquals(-1, payload.get("deviceId"));
        assertEquals(0, payload.get("source"));
    }

    @Test
    public void buildSamsungKnoxHardwareButtonShortPressEventMapMarksSamsungOrigin() {
        Map<String, Object> payload = SecPalEnterprisePlugin.buildSamsungKnoxHardwareButtonShortPressEventMap(1015);

        assertEquals("short_press", payload.get("action"));
        assertEquals("samsung_knox_broadcast", payload.get("origin"));
        assertEquals(1015, payload.get("keyCode"));
        assertEquals(0L, payload.get("holdDurationMs"));
    }

    @Test
    public void buildSamsungKnoxHardwareButtonLongPressEventMapMarksSamsungOrigin() {
        Map<String, Object> payload = SecPalEnterprisePlugin.buildSamsungKnoxHardwareButtonLongPressEventMap(1015);

        assertEquals("long_press", payload.get("action"));
        assertEquals("samsung_knox_broadcast", payload.get("origin"));
        assertEquals(1015, payload.get("keyCode"));
        assertEquals(5000L, payload.get("holdDurationMs"));
    }
}
