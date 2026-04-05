/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.List;

import org.junit.Test;

public class EnterprisePolicyControllerTest {

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
}
