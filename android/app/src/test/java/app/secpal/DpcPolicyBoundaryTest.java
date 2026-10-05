/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Looper;
import android.os.UserManager;

import java.util.Collections;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadows.ShadowDevicePolicyManager;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, shadows = DpcPolicyBoundaryTest.RecordingDevicePolicyManager.class)
public class DpcPolicyBoundaryTest {
    @Test
    public void deviceOwnerConsumptionDoesNotGrantPolicyButResumeEnforcesBeforeLockTaskUse() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        ComponentName admin = new ComponentName(context, SecPalDeviceAdminReceiver.class);
        assertTrue(shadowOf(manager).setDeviceOwner(admin));
        DpcPolicyEnforcer.persistDebugPolicy(
            context,
            Collections.singletonMap(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true)
        );

        EnterpriseManagedState state = EnterprisePolicyClient.getManagedState(context);
        assertTrue(state.isDeviceOwner());
        assertTrue(state.isLockTaskEnabled());
        assertFalse(manager.getScreenCaptureDisabled(admin));
        assertFalse(manager.isLockTaskPermitted(context.getPackageName()));
        EnterprisePolicyClient.resolveAllowedLaunchApps(context);
        assertFalse(manager.getScreenCaptureDisabled(admin));
        assertFalse(manager.isLockTaskPermitted(context.getPackageName()));

        try (var controller = Robolectric.buildActivity(PolicyConsumingActivity.class).setup()) {
            assertTrue(controller.get().screenCaptureDisabledBeforeCreateConsumption);
            assertTrue(controller.get().screenCaptureDisabledBeforeConsumption);
            assertTrue(controller.get().lockTaskPermittedBeforeConsumption);
        }
    }

    @Test
    public void profileOwnerEnforcementRetainsScreenCaptureWithoutDeviceOwnerKioskGrants() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        ComponentName admin = new ComponentName(context, SecPalDeviceAdminReceiver.class);
        shadowOf(manager).setProfileOwner(admin);
        DpcPolicyEnforcer.persistDebugPolicy(
            context,
            Collections.singletonMap(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true)
        );

        EnterpriseManagedState state = EnterprisePolicyClient.getManagedState(context);
        assertTrue(state.isProfileOwner());
        assertFalse(state.isKioskActive());
        assertFalse(state.isLockTaskEnabled());
        assertFalse(manager.getScreenCaptureDisabled(admin));
        DpcPolicyEnforcer.syncPolicy(context);
        assertTrue(manager.getScreenCaptureDisabled(admin));
        assertFalse(manager.isLockTaskPermitted(context.getPackageName()));
    }

    @Test
    public void managedConfigurationChangeEnforcesIndependentlyOfWorkConsumption() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        ComponentName admin = new ComponentName(context, SecPalDeviceAdminReceiver.class);
        assertTrue(shadowOf(manager).setDeviceOwner(admin));
        DpcPolicyEnforcer.syncPolicy(context);
        assertFalse(context.getSystemService(UserManager.class).hasUserRestriction(UserManager.DISALLOW_CONFIG_WIFI));

        Bundle restrictions = new Bundle();
        restrictions.putBoolean(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        shadowOf(context.getSystemService(UserManager.class)).setApplicationRestrictions(context.getPackageName(), restrictions);
        context.sendBroadcast(new Intent(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED));
        shadowOf(Looper.getMainLooper()).idle();

        assertTrue(context.getSystemService(UserManager.class).hasUserRestriction(UserManager.DISALLOW_CONFIG_WIFI));
        assertTrue(EnterprisePolicyClient.getManagedState(context).isKioskActive());
        assertEquals(DevicePolicyManager.LOCK_TASK_FEATURE_HOME, manager.getLockTaskFeatures(admin));
    }

    public static class PolicyConsumingActivity extends Activity {
        boolean screenCaptureDisabledBeforeCreateConsumption;
        boolean screenCaptureDisabledBeforeConsumption;
        boolean lockTaskPermittedBeforeConsumption;

        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            screenCaptureDisabledBeforeCreateConsumption = getSystemService(DevicePolicyManager.class)
                .getScreenCaptureDisabled(new ComponentName(this, SecPalDeviceAdminReceiver.class));
            EnterprisePolicyClient.getManagedState(this);
        }

        @Override
        protected void onResume() {
            super.onResume();
            DevicePolicyManager manager = getSystemService(DevicePolicyManager.class);
            screenCaptureDisabledBeforeConsumption = manager.getScreenCaptureDisabled(
                new ComponentName(this, SecPalDeviceAdminReceiver.class)
            );
            lockTaskPermittedBeforeConsumption = manager.isLockTaskPermitted(getPackageName());
            EnterprisePolicyClient.maybeEnterLockTask(this);
        }
    }
    // Robolectric 4.14 does not implement the screen-capture setters/getters.
    // Record their real call arguments alongside its existing owner/lock-task simulation.
    @Implements(DevicePolicyManager.class)
    public static class RecordingDevicePolicyManager extends ShadowDevicePolicyManager {
        private ComponentName screenCaptureAdmin;
        private boolean screenCaptureDisabled;

        @Implementation
        protected void setScreenCaptureDisabled(ComponentName admin, boolean disabled) {
            screenCaptureAdmin = admin;
            screenCaptureDisabled = disabled;
        }

        @Implementation
        protected boolean getScreenCaptureDisabled(ComponentName admin) {
            return admin.equals(screenCaptureAdmin) && screenCaptureDisabled;
        }
    }
}
