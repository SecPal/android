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
    public void ownerActivationAndSystemServiceRestartEnforceWithoutWorkLifecycle() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        ComponentName admin = new ComponentName(context, SecPalDeviceAdminReceiver.class);
        assertTrue(shadowOf(manager).setDeviceOwner(admin));
        new DpcPolicyChangeReceiver().onReceive(context,
            new Intent(DevicePolicyManager.ACTION_DEVICE_OWNER_CHANGED));
        assertTrue(manager.getScreenCaptureDisabled(admin));
        DpcPolicyEnforcer.persistDebugPolicy(context,
            Collections.singletonMap(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true));
        var service = Robolectric.buildService(DpcPolicyService.class).create();
        try {
            assertTrue(manager.isLockTaskPermitted(context.getPackageName()));
            assertTrue(service.get().onBind(new Intent()) instanceof android.os.Binder);
        } finally {
            service.destroy();
        }
    }

    @Test
    public void packageAllowlistCannotBypassWorkCertificateAuthentication() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        ComponentName admin = new ComponentName(context, SecPalDeviceAdminReceiver.class);
        assertTrue(shadowOf(manager).setDeviceOwner(admin));
        Bundle restrictions = new Bundle();
        restrictions.putBoolean(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        restrictions.putStringArray(EnterprisePolicyConfig.KEY_ALLOWED_PACKAGES,
            new String[] {io.secpal.dpc.BuildConfig.WORK_APPLICATION_ID});
        shadowOf(context.getSystemService(UserManager.class)).setApplicationRestrictions(context.getPackageName(), restrictions);
        DpcPolicyEnforcer.syncPolicy(context);
        assertFalse(manager.isLockTaskPermitted(io.secpal.dpc.BuildConfig.WORK_APPLICATION_ID));
    }

    @Test
    public void deviceOwnerStateReadCannotGrantPolicyUntilDpcEnforces() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        ComponentName admin = new ComponentName(context, SecPalDeviceAdminReceiver.class);
        assertTrue(shadowOf(manager).setDeviceOwner(admin));
        DpcPolicyEnforcer.persistDebugPolicy(
            context,
            Collections.singletonMap(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true)
        );

        EnterpriseManagedState state = DpcPolicyState.read(context);
        assertTrue(state.isDeviceOwner());
        assertTrue(state.isLockTaskEnabled());
        assertFalse(manager.getScreenCaptureDisabled(admin));
        assertFalse(manager.isLockTaskPermitted(context.getPackageName()));
        DpcPolicyEnforcer.syncPolicy(context);
        assertTrue(manager.getScreenCaptureDisabled(admin));
        assertTrue(manager.isLockTaskPermitted(context.getPackageName()));
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

        EnterpriseManagedState state = DpcPolicyState.read(context);
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
        assertTrue(DpcPolicyState.read(context).isKioskActive());
        assertEquals(DevicePolicyManager.LOCK_TASK_FEATURE_HOME, manager.getLockTaskFeatures(admin));
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
