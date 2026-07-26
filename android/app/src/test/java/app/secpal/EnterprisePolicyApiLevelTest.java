/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
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
    }

    private static DevicePolicyManager applyKioskDeviceOwnerPolicy(Context context) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(
            DevicePolicyManager.class
        );
        ComponentName adminComponent = new ComponentName(
            context,
            SecPalDeviceAdminReceiver.class
        );
        Map<String, Object> policyValues = new LinkedHashMap<>();

        assertTrue(shadowOf(devicePolicyManager).setDeviceOwner(adminComponent));
        policyValues.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        EnterprisePolicyController.persistDebugPolicy(context, policyValues);
        EnterprisePolicyController.syncPolicy(context);

        return devicePolicyManager;
    }
}
