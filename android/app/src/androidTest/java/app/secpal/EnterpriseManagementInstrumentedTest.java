/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;

import static org.junit.Assert.*;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class EnterpriseManagementInstrumentedTest {
    @Test public void separateWorkConsumesAuthenticatedOwnerStateWithoutOwningPolicy() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        assertEquals(BuildConfig.APPLICATION_ID, context.getPackageName());
        assertFalse(manager.isDeviceOwnerApp(context.getPackageName()));
        assertFalse(manager.isProfileOwnerApp(context.getPackageName()));
        assertThrows(ClassNotFoundException.class, () -> Class.forName("app.secpal.DpcPolicyEnforcer"));
        assertThrows(ClassNotFoundException.class, () -> Class.forName("app.secpal.SecPalDeviceAdminReceiver"));
        EnterpriseManagedState state = EnterprisePolicyClient.getManagedState(context);
        if (manager.isDeviceOwnerApp(BuildConfig.DPC_APPLICATION_ID)) {
            assertTrue(state.isDeviceOwner());
            assertTrue(state.isKioskActive());
            assertTrue(manager.isLockTaskPermitted(context.getPackageName()));
        } else {
            assertTrue(manager.isProfileOwnerApp(BuildConfig.DPC_APPLICATION_ID));
            assertTrue(state.isProfileOwner());
            assertFalse(state.isKioskActive());
            assertFalse(manager.isLockTaskPermitted(context.getPackageName()));
        }
    }
}
