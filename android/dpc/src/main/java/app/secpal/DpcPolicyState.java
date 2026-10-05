/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import io.secpal.dpc.BuildConfig;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.UserManager;

/** Shared managed-policy derivation; management claims confer no business or user authority. */
final class DpcPolicyState {
    static final String ENTERPRISE_PREFS = "secpal_enterprise_policy";

    private DpcPolicyState() {
    }

    static boolean isLockTaskPermitted(Context context) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);
        return devicePolicyManager != null
            && devicePolicyManager.isLockTaskPermitted(context.getPackageName());
    }

    static EnterpriseManagedState read(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(ENTERPRISE_PREFS, Context.MODE_PRIVATE);
        EnterprisePolicyConfig policyConfig = resolveCurrentPolicyConfig(context, preferences);
        String managedMode = resolveManagedMode(context);
        preferences.edit().putString("managed_mode", managedMode).apply();
        return new EnterpriseManagedState(
            managedMode,
            policyConfig,
            false
        );
    }

    static String resolveManagedMode(boolean deviceOwner, boolean profileOwner) {
        return EnterpriseManagedState.resolveManagedMode(deviceOwner, profileOwner);
    }

    private static EnterprisePolicyConfig resolveCurrentPolicyConfig(
        Context context,
        SharedPreferences preferences
    ) {
        Bundle applicationRestrictions = resolveApplicationRestrictions(context);

        if (applicationRestrictions != null && !applicationRestrictions.isEmpty()) {
            EnterprisePolicyConfig policyConfig = EnterprisePolicyConfig.fromBundle(applicationRestrictions);
            SharedPreferences.Editor editor = preferences.edit();
            policyConfig.writeToPreferences(editor);
            editor.apply();
            return policyConfig;
        }

        return EnterprisePolicyConfig.fromPreferences(preferences);
    }

    private static Bundle resolveApplicationRestrictions(Context context) {
        UserManager userManager = context.getSystemService(UserManager.class);

        if (userManager == null) {
            return null;
        }

        return userManager.getApplicationRestrictions(context.getPackageName());
    }

    static String resolveManagedMode(Context context) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);

        if (devicePolicyManager == null) {
            return EnterpriseManagedState.MODE_NONE;
        }

        return resolveManagedMode(
            devicePolicyManager.isDeviceOwnerApp(context.getPackageName()),
            devicePolicyManager.isProfileOwnerApp(context.getPackageName())
        );
    }

}
