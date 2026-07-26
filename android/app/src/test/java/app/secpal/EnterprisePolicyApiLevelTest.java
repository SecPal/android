/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.admin.DevicePolicyManager;
import android.os.UserManager;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
public class EnterprisePolicyApiLevelTest {

    @Test
    @Config(sdk = 27)
    public void api27OmitsAndroid28EnterprisePolicies() {
        assertNull(EnterprisePolicyController.resolveLockTaskFeatures(true));
        assertNull(EnterprisePolicyController.resolveLockTaskFeatures(false));
        assertFalse(
            EnterprisePolicyController.resolveKioskUserRestrictions()
                .contains("no_config_date_time")
        );
    }

    @Test
    @Config(sdk = 28)
    public void api28IncludesKioskEnterprisePolicies() {
        assertEquals(
            Integer.valueOf(DevicePolicyManager.LOCK_TASK_FEATURE_HOME),
            EnterprisePolicyController.resolveLockTaskFeatures(true)
        );
        assertTrue(
            EnterprisePolicyController.resolveKioskUserRestrictions()
                .contains(UserManager.DISALLOW_CONFIG_DATE_TIME)
        );
    }

    @Test
    @Config(sdk = 28)
    public void api28RestoresNonKioskLockTaskFeatures() {
        assertEquals(
            Integer.valueOf(
                DevicePolicyManager.LOCK_TASK_FEATURE_HOME
                    | DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS
                    | DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
            ),
            EnterprisePolicyController.resolveLockTaskFeatures(false)
        );
    }
}
