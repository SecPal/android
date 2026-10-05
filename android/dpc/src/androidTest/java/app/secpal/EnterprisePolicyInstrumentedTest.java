/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
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

        boolean deviceOwner = devicePolicyManager.isDeviceOwnerApp(context.getPackageName());
        boolean profileOwner = devicePolicyManager.isProfileOwnerApp(context.getPackageName());
        assertTrue(deviceOwner || profileOwner);
        assertEquals(io.secpal.dpc.BuildConfig.APPLICATION_ID, context.getPackageName());
        assertThrows(ClassNotFoundException.class, () -> Class.forName("app.secpal.MainActivity"));
        assertThrows(ClassNotFoundException.class, () -> Class.forName("app.secpal.SecPalEnterprisePlugin"));
        if (profileOwner && !deviceOwner) {
            DpcPolicyEnforcer.persistDebugPolicy(context, java.util.Collections.singletonMap(
                EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true));
            EnterpriseManagedState state = DpcPolicyEnforcer.syncPolicy(context);
            assertTrue(state.isProfileOwner());
            assertFalse(state.isKioskActive());
            assertFalse(devicePolicyManager.isLockTaskPermitted(io.secpal.dpc.BuildConfig.WORK_APPLICATION_ID));
            return;
        }

        try {
            DpcPolicyEnforcer.setKioskUserRestrictions(
                devicePolicyManager,
                adminComponent,
                true,
                false
            );
            assertTrue(
                userManager.hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
            );

            DpcPolicyEnforcer.setKioskUserRestrictions(
                devicePolicyManager,
                adminComponent,
                true,
                true
            );
            assertFalse(
                userManager.hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
            );
        } finally {
            DpcPolicyEnforcer.setKioskUserRestrictions(
                devicePolicyManager,
                adminComponent,
                false,
                false
            );
        }
        DpcPolicyEnforcer.persistDebugPolicy(context, java.util.Collections.singletonMap(
            EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true));
        assertTrue(DpcPolicyEnforcer.syncPolicy(context).isKioskActive());
        assertTrue(devicePolicyManager.isLockTaskPermitted(io.secpal.dpc.BuildConfig.WORK_APPLICATION_ID));
    }
}
