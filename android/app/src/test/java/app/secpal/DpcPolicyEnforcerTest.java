/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

public class DpcPolicyEnforcerTest {

    @Test
    public void screenCapturePolicyAppliesToAllManagedModes() {
        assertTrue(
            DpcPolicyEnforcer.shouldDisableScreenCapture(
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_DEVICE_OWNER,
                    EnterprisePolicyConfig.disabled()
                )
            )
        );
        assertTrue(
            DpcPolicyEnforcer.shouldDisableScreenCapture(
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_PROFILE_OWNER,
                    EnterprisePolicyConfig.disabled()
                )
            )
        );
        assertEquals(
            false,
            DpcPolicyEnforcer.shouldDisableScreenCapture(
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_NONE,
                    EnterprisePolicyConfig.disabled()
                )
            )
        );
    }

    @Test
    public void deviceOwnerModeWinsOverProfileOwnerMode() {
        assertEquals(
            EnterpriseManagedState.MODE_DEVICE_OWNER,
            EnterprisePolicyState.resolveManagedMode(true, true)
        );
    }

    @Test
    public void profileOwnerModeIsReportedWhenNoDeviceOwnerExists() {
        assertEquals(
            EnterpriseManagedState.MODE_PROFILE_OWNER,
            EnterprisePolicyState.resolveManagedMode(false, true)
        );
    }

    @Test
    public void unmanagedModeIsReportedWhenNoOwnerRoleExists() {
        assertEquals(
            EnterpriseManagedState.MODE_NONE,
            EnterprisePolicyState.resolveManagedMode(false, false)
        );
    }

    @Test
    public void resolveFirstComponentReturnsNullWhenNothingLaunchableExists() {
        assertNull(EnterpriseManagedState.resolveFirstComponent(Collections.emptyList()));
        assertNull(EnterpriseManagedState.resolveFirstComponent(null));
    }

    @Test
    public void kioskSettingsRedirectFiltersCoverPlainAndDefaultCategoryIntents() {
        List<DpcPolicyEnforcer.KioskSettingsRedirectFilterSpec> filters =
            DpcPolicyEnforcer.buildKioskSettingsRedirectFilters();
        boolean foundWithoutCategory = false;
        boolean foundWithDefaultCategory = false;

        for (DpcPolicyEnforcer.KioskSettingsRedirectFilterSpec filter : filters) {
            if (!"android.settings.SETTINGS".equals(filter.getAction())) {
                continue;
            }

            if (!filter.hasDefaultCategory()) {
                foundWithoutCategory = true;
            }

            if (filter.hasDefaultCategory()) {
                foundWithDefaultCategory = true;
            }
        }

        assertTrue(foundWithoutCategory);
        assertTrue(foundWithDefaultCategory);
    }

    @Test
    public void debugKioskLauncherLaunchesDedicatedHomeOnUnmanagedDevices() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        assertTrue(
            EnterprisePolicyClient.shouldOpenDedicatedHomeOnLaunch(
                "android.intent.action.MAIN",
                true,
                false,
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_NONE,
                    EnterprisePolicyConfig.fromMap(values),
                    true
                )
            )
        );
    }

    @Test
    public void explicitMainActivityLaunchDoesNotRedirectIntoDedicatedHome() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        assertFalse(
            EnterprisePolicyClient.shouldOpenDedicatedHomeOnLaunch(
                null,
                false,
                false,
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_NONE,
                    EnterprisePolicyConfig.fromMap(values),
                    true
                )
            )
        );
    }
}
