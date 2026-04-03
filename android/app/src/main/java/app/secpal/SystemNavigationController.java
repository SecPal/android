/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

final class SystemNavigationController {
    private static final String LOG_TAG = "SecPalSystemNavigation";
    private static final int GESTURE_NAVIGATION_MODE = 2;
    private static final String SETTINGS_PACKAGE_NAME = "com.android.settings";
    private static final String NAVIGATION_MODE_SETTING = "navigation_mode";
    private static final String PREFS_NAME = "secpal_system_navigation";
    private static final String PREF_PROVISIONING_GESTURE_NAVIGATION_PENDING = "provisioning_gesture_navigation_pending";

    private SystemNavigationController() {
    }

    static boolean isGestureNavigationEnabled(Context context) {
        return isGestureNavigationModeValue(
            Settings.Secure.getInt(context.getContentResolver(), NAVIGATION_MODE_SETTING, 0)
        );
    }

    static boolean isGestureNavigationModeValue(int navigationMode) {
        return navigationMode == GESTURE_NAVIGATION_MODE;
    }

    static boolean canOpenGestureNavigationSettings(Context context) {
        return resolveGestureNavigationSettingsIntent(context) != null;
    }

    static boolean openGestureNavigationSettings(Activity activity) {
        Intent intent = resolveGestureNavigationSettingsIntent(activity);

        if (intent == null) {
            return false;
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            activity.startActivity(intent);
            return true;
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Failed to open gesture navigation settings", exception);
            return false;
        }
    }

    static void applyProvisioningGestureNavigationIfRequested(
        Context context,
        ComponentName adminComponent,
        EnterpriseManagedState managedState
    ) {
        if (!managedState.isDeviceOwner() || !managedState.isPreferGestureNavigation()) {
            setProvisioningGestureNavigationPending(context, false);
            return;
        }

        if (isGestureNavigationEnabled(context)) {
            setProvisioningGestureNavigationPending(context, false);
            return;
        }

        requestManagedGestureNavigationSettings(context, adminComponent);

        if (isGestureNavigationEnabled(context)) {
            setProvisioningGestureNavigationPending(context, false);
            return;
        }

        setProvisioningGestureNavigationPending(
            context,
            canOpenGestureNavigationSettings(context)
        );
    }

    static boolean maybeCompleteProvisioningGestureNavigation(
        Activity activity,
        EnterpriseManagedState managedState
    ) {
        if (!managedState.isDeviceOwner() || !managedState.isPreferGestureNavigation()) {
            setProvisioningGestureNavigationPending(activity, false);
            return false;
        }

        if (isGestureNavigationEnabled(activity)) {
            setProvisioningGestureNavigationPending(activity, false);
            return false;
        }

        if (!isProvisioningGestureNavigationPending(activity)
            || !canOpenGestureNavigationSettings(activity)) {
            return false;
        }

        if (!EnterprisePolicyController.temporarilyExitLockTask(activity)) {
            return false;
        }

        boolean launchedSettings = false;

        try {
            if (!openGestureNavigationSettings(activity)) {
                return false;
            }

            launchedSettings = true;
            setProvisioningGestureNavigationPending(activity, false);
            return true;
        } finally {
            if (!launchedSettings) {
                EnterprisePolicyController.maybeEnterLockTask(activity);
            }
        }
    }

    private static void requestManagedGestureNavigationSettings(
        Context context,
        ComponentName adminComponent
    ) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);

        if (devicePolicyManager == null || adminComponent == null) {
            return;
        }

        setSecureSetting(devicePolicyManager, adminComponent, NAVIGATION_MODE_SETTING, "2");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_gesture_hint", "1");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_gesture_while_hidden", "1");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_gesture_detail_type", "1");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_button_to_hide_keyboard", "0");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigationbar_switch_apps_when_hint_hidden", "0");
    }

    private static boolean isProvisioningGestureNavigationPending(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(PREF_PROVISIONING_GESTURE_NAVIGATION_PENDING, false);
    }

    private static void setProvisioningGestureNavigationPending(Context context, boolean pending) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_PROVISIONING_GESTURE_NAVIGATION_PENDING, pending)
            .apply();
    }

    private static void setSecureSetting(
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        String name,
        String value
    ) {
        try {
            devicePolicyManager.setSecureSetting(adminComponent, name, value);
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Failed to set secure setting " + name + " for gesture navigation", exception);
        }
    }

    private static void setGlobalSetting(
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        String name,
        String value
    ) {
        try {
            devicePolicyManager.setGlobalSetting(adminComponent, name, value);
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Failed to set global setting " + name + " for gesture navigation", exception);
        }
    }

    private static Intent resolveGestureNavigationSettingsIntent(Context context) {
        PackageManager packageManager = context.getPackageManager();

        for (Intent candidate : buildGestureNavigationSettingsCandidates()) {
            ComponentName resolvedComponent = candidate.resolveActivity(packageManager);

            if (resolvedComponent == null) {
                continue;
            }

            Intent resolvedIntent = new Intent(candidate);

            resolvedIntent.setComponent(resolvedComponent);
            return resolvedIntent;
        }

        return null;
    }

    private static List<Intent> buildGestureNavigationSettingsCandidates() {
        List<Intent> candidates = new ArrayList<>();

        candidates.add(buildSettingsActionIntent("com.samsung.settings.NAVIGATION_BAR_SETTING"));
        candidates.add(buildSettingsActionIntent("com.android.settings.GESTURE_NAVIGATION_SETTINGS"));
        candidates.add(buildSettingsActionIntent("com.android.settings.NAVIGATION_MODE_SETTINGS"));
        candidates.add(
            buildSettingsComponentIntent("com.android.settings.Settings$NavigationBarSettingsActivity")
        );
        candidates.add(
            buildSettingsComponentIntent("com.android.settings.Settings$GestureNavigationSettingsActivity")
        );

        return candidates;
    }

    private static Intent buildSettingsActionIntent(String action) {
        Intent intent = new Intent(action);

        intent.setPackage(SETTINGS_PACKAGE_NAME);
        return intent;
    }

    private static Intent buildSettingsComponentIntent(String className) {
        Intent intent = new Intent();

        intent.setComponent(new ComponentName(SETTINGS_PACKAGE_NAME, className));
        return intent;
    }
}
