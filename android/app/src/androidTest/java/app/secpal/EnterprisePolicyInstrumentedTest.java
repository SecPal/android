/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.UserManager;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class EnterprisePolicyInstrumentedTest {

    @Test
    public void managedInstallRestrictionFollowsExplicitBuildMode() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        DevicePolicyManager devicePolicyManager = context.getSystemService(
            DevicePolicyManager.class
        );
        UserManager userManager = context.getSystemService(UserManager.class);
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );

        assertTrue(devicePolicyManager.isDeviceOwnerApp(context.getPackageName()));

        try {
            EnterprisePolicyController.setKioskUserRestrictions(
                devicePolicyManager,
                adminComponent,
                true,
                false
            );
            assertTrue(
                userManager.hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
            );

            EnterprisePolicyController.setKioskUserRestrictions(
                devicePolicyManager,
                adminComponent,
                true,
                true
            );
            assertFalse(
                userManager.hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
            );
        } finally {
            EnterprisePolicyController.setKioskUserRestrictions(
                devicePolicyManager,
                adminComponent,
                false,
                false
            );
        }
    }
}
