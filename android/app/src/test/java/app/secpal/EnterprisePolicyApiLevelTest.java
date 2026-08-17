/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.UserManager;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowDevicePolicyManager;

@RunWith(RobolectricTestRunner.class)
public class EnterprisePolicyApiLevelTest {

    @Test
    @Config(sdk = 24, shadows = RecordingDevicePolicyManager.class)
    public void api24AppliesAndClearsStatusBarPolicy() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager devicePolicyManager = applyKioskDeviceOwnerPolicy(context);
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );
        RecordingDevicePolicyManager shadowDevicePolicyManager =
            (RecordingDevicePolicyManager) shadowOf(devicePolicyManager);

        assertEquals(adminComponent, shadowDevicePolicyManager.getStatusBarAdmin());
        assertTrue(shadowDevicePolicyManager.isStatusBarDisabled());

        EnterprisePolicyController.persistDebugPolicy(
            context,
            new LinkedHashMap<>()
        );
        EnterprisePolicyController.syncPolicy(context);

        assertEquals(adminComponent, shadowDevicePolicyManager.getStatusBarAdmin());
        assertFalse(shadowDevicePolicyManager.isStatusBarDisabled());
    }

    @Test
    @Config(sdk = 27)
    public void api27OmitsAndroid28EnterprisePolicies() {
        assertNull(EnterprisePolicyController.resolveLockTaskFeatures(true));
        assertNull(EnterprisePolicyController.resolveLockTaskFeatures(false));
        assertFalse(
            EnterprisePolicyController.resolveKioskUserRestrictions()
                .contains("no_config_date_time")
        );

        Context context = RuntimeEnvironment.getApplication();
        applyKioskDeviceOwnerPolicy(context);
        UserManager userManager = context.getSystemService(UserManager.class);

        assertFalse(userManager.hasUserRestriction("no_config_date_time"));
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

        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager devicePolicyManager = applyKioskDeviceOwnerPolicy(context);
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );

        assertEquals(
            DevicePolicyManager.LOCK_TASK_FEATURE_HOME,
            devicePolicyManager.getLockTaskFeatures(adminComponent)
        );
        assertTrue(
            context.getSystemService(UserManager.class)
                .hasUserRestriction(UserManager.DISALLOW_CONFIG_DATE_TIME)
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

    @Test
    @Config(sdk = 28)
    public void debugKioskPolicyKeepsManagedPackageUpdatesAvailable() {
        assertFalse(
            EnterprisePolicyController.resolveKioskUserRestrictions(true)
                .contains(UserManager.DISALLOW_INSTALL_APPS)
        );
        assertTrue(
            EnterprisePolicyController.resolveKioskUserRestrictions(true)
                .contains(UserManager.DISALLOW_UNINSTALL_APPS)
        );

        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager devicePolicyManager = setDeviceOwner(context);
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );

        EnterprisePolicyController.setKioskUserRestrictions(
            devicePolicyManager,
            adminComponent,
            true,
            true
        );
        UserManager userManager = context.getSystemService(UserManager.class);

        assertFalse(userManager.hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS));
        assertTrue(userManager.hasUserRestriction(UserManager.DISALLOW_UNINSTALL_APPS));
    }

    @Test
    @Config(sdk = 28)
    public void releaseKioskPolicyRetainsInstallRestriction() {
        assertTrue(
            EnterprisePolicyController.resolveKioskUserRestrictions(false)
                .contains(UserManager.DISALLOW_INSTALL_APPS)
        );

        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager devicePolicyManager = setDeviceOwner(context);
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );

        EnterprisePolicyController.setKioskUserRestrictions(
            devicePolicyManager,
            adminComponent,
            true,
            false
        );

        assertTrue(
            context.getSystemService(UserManager.class)
                .hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
        );
    }

    @Test
    @Config(sdk = 28)
    public void debugKioskPolicyClearsLegacyInstallRestrictionForManagedUpdates() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager devicePolicyManager = setDeviceOwner(context);
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );

        devicePolicyManager.addUserRestriction(
            adminComponent,
            UserManager.DISALLOW_INSTALL_APPS
        );
        assertTrue(
            context.getSystemService(UserManager.class)
                .hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
        );

        EnterprisePolicyController.setKioskUserRestrictions(
            devicePolicyManager,
            adminComponent,
            true,
            true
        );

        assertFalse(
            context.getSystemService(UserManager.class)
                .hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
        );
    }

    @Test
    @Config(sdk = 28)
    public void kioskPolicyUsesCurrentBuildModeForManagedPackageUpdates() {
        Context context = RuntimeEnvironment.getApplication();
        DevicePolicyManager devicePolicyManager = setDeviceOwner(context);
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );
        Map<String, Object> policyValues = new LinkedHashMap<>();

        devicePolicyManager.addUserRestriction(
            adminComponent,
            UserManager.DISALLOW_INSTALL_APPS
        );
        policyValues.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        EnterprisePolicyController.persistDebugPolicy(context, policyValues);
        EnterprisePolicyController.syncPolicy(context);

        assertEquals(
            !BuildConfig.DEBUG,
            context.getSystemService(UserManager.class)
                .hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)
        );
    }

    @Test
    public void policySignatureChangesWhenAndroid28PoliciesBecomeAvailable() {
        Context context = RuntimeEnvironment.getApplication();
        EnterpriseManagedState managedState = new EnterpriseManagedState(
            EnterpriseManagedState.MODE_DEVICE_OWNER,
            EnterprisePolicyConfig.disabled()
        );
        String api24Signature = EnterprisePolicyController.buildAppliedPolicySignature(
            context,
            managedState,
            24
        );
        String api27Signature = EnterprisePolicyController.buildAppliedPolicySignature(
            context,
            managedState,
            27
        );
        String api28Signature = EnterprisePolicyController.buildAppliedPolicySignature(
            context,
            managedState,
            28
        );
        String api36Signature = EnterprisePolicyController.buildAppliedPolicySignature(
            context,
            managedState,
            36
        );

        assertEquals(api24Signature, api27Signature);
        assertNotEquals(api27Signature, api28Signature);
        assertEquals(api28Signature, api36Signature);
        assertTrue(api28Signature.startsWith("2|"));
    }

    private static DevicePolicyManager applyKioskDeviceOwnerPolicy(Context context) {
        DevicePolicyManager devicePolicyManager = setDeviceOwner(context);
        Map<String, Object> policyValues = new LinkedHashMap<>();

        policyValues.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        EnterprisePolicyController.persistDebugPolicy(context, policyValues);
        EnterprisePolicyController.syncPolicy(context);

        return devicePolicyManager;
    }

    private static DevicePolicyManager setDeviceOwner(Context context) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(
            DevicePolicyManager.class
        );
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );

        assertTrue(shadowOf(devicePolicyManager).setDeviceOwner(adminComponent));

        return devicePolicyManager;
    }

    @Implements(DevicePolicyManager.class)
    public static class RecordingDevicePolicyManager extends ShadowDevicePolicyManager {
        private ComponentName statusBarAdmin;
        private boolean statusBarDisabled;

        @Implementation(minSdk = 23)
        protected boolean setStatusBarDisabled(
            ComponentName adminComponent,
            boolean disabled
        ) {
            statusBarAdmin = adminComponent;
            statusBarDisabled = disabled;
            return true;
        }

        ComponentName getStatusBarAdmin() {
            return statusBarAdmin;
        }

        boolean isStatusBarDisabled() {
            return statusBarDisabled;
        }
    }
}
