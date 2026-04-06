/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

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
}
