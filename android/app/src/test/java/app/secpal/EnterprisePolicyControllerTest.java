/*
 * SPDX-FileCopyrightText: 2026 SecPal
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

public class EnterprisePolicyControllerTest {

    @Test
    public void screenCapturePolicyAppliesToAllManagedModes() {
        assertTrue(
            EnterprisePolicyController.shouldDisableScreenCapture(
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_DEVICE_OWNER,
                    EnterprisePolicyConfig.disabled()
                )
            )
        );
        assertTrue(
            EnterprisePolicyController.shouldDisableScreenCapture(
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_PROFILE_OWNER,
                    EnterprisePolicyConfig.disabled()
                )
            )
        );
        assertEquals(
            false,
            EnterprisePolicyController.shouldDisableScreenCapture(
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
            EnterprisePolicyController.resolveManagedMode(true, true)
        );
    }

    @Test
    public void profileOwnerModeIsReportedWhenNoDeviceOwnerExists() {
        assertEquals(
            EnterpriseManagedState.MODE_PROFILE_OWNER,
            EnterprisePolicyController.resolveManagedMode(false, true)
        );
    }

    @Test
    public void unmanagedModeIsReportedWhenNoOwnerRoleExists() {
        assertEquals(
            EnterpriseManagedState.MODE_NONE,
            EnterprisePolicyController.resolveManagedMode(false, false)
        );
    }

    @Test
    public void resolveFirstComponentReturnsNullWhenNothingLaunchableExists() {
        assertNull(EnterprisePolicyController.resolveFirstComponent(Collections.emptyList()));
        assertNull(EnterprisePolicyController.resolveFirstComponent(null));
    }

    @Test
    public void kioskSettingsRedirectFiltersCoverPlainAndDefaultCategoryIntents() {
        List<EnterprisePolicyController.KioskSettingsRedirectFilterSpec> filters =
            EnterprisePolicyController.buildKioskSettingsRedirectFilters();
        boolean foundWithoutCategory = false;
        boolean foundWithDefaultCategory = false;

        for (EnterprisePolicyController.KioskSettingsRedirectFilterSpec filter : filters) {
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
            EnterprisePolicyController.shouldOpenDedicatedHomeOnLaunch(
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
            EnterprisePolicyController.shouldOpenDedicatedHomeOnLaunch(
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
