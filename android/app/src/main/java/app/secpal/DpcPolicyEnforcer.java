/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.PersistableBundle;
import android.os.UserManager;
import android.util.Log;

import androidx.annotation.RequiresApi;
import androidx.annotation.VisibleForTesting;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Owns privileged Android management enforcement, independently of Work runtime and authorization. */
public final class DpcPolicyEnforcer {
    private static final String LOG_TAG = "SecPalEnterprise";
    private static final String GESTURE_NAVIGATION_LOG_TAG = "SecPalSystemNavigation";
    private static final String PREF_APPLIED_SCREEN_CAPTURE_POLICY = "applied_screen_capture_policy";
    private static final String PREF_APPLIED_POLICY_SIGNATURE = "applied_policy_signature";
    private static final String PREF_MANAGED_HIDDEN_PACKAGES = "managed_hidden_packages";
    private static final int DEVICE_OWNER_POLICY_REVISION = 2;
    private static final String[] KIOSK_REDIRECTED_SETTINGS_ACTIONS = new String[] {
        "android.settings.SETTINGS",
        "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
        "android.settings.WIFI_SETTINGS",
        "android.settings.WIRELESS_SETTINGS",
        "android.settings.BLUETOOTH_SETTINGS",
        "android.settings.DATA_USAGE_SETTINGS",
        "android.settings.NETWORK_OPERATOR_SETTINGS",
        "android.settings.SECURITY_SETTINGS",
        "android.settings.SOUND_SETTINGS",
        "android.settings.APPLICATION_SETTINGS",
        "android.settings.CALL_SETTINGS"
    };
    private static final String[] BASE_KIOSK_USER_RESTRICTIONS = new String[] {
        UserManager.DISALLOW_CONFIG_WIFI,
        UserManager.DISALLOW_CONFIG_BLUETOOTH,
        UserManager.DISALLOW_CONFIG_MOBILE_NETWORKS,
        UserManager.DISALLOW_CONFIG_TETHERING,
        UserManager.DISALLOW_CONFIG_VPN,
        UserManager.DISALLOW_APPS_CONTROL,
        UserManager.DISALLOW_INSTALL_APPS,
        UserManager.DISALLOW_UNINSTALL_APPS,
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_FACTORY_RESET
    };

    private DpcPolicyEnforcer() {
    }

    static void onAdminEnabled(Context context, Intent intent, ComponentName adminComponent) {
        persistProvisioningConfig(context, extractProvisioningAdminExtras(intent));
        EnterpriseManagedState managedState = syncPolicy(context);
        applyProvisioningGestureNavigationIfRequested(context, adminComponent, managedState);
    }

    static CharSequence onDisableRequested(Context context) {
        return syncPolicy(context).isManaged()
            ? context.getString(R.string.enterprise_disable_warning)
            : null;
    }

    static void onProfileProvisioningComplete(Context context, Intent intent, ComponentName adminComponent) {
        persistProvisioningConfig(context, extractProvisioningAdminExtras(intent));
        EnterpriseManagedState managedState = syncPolicy(context);
        applyProvisioningGestureNavigationIfRequested(context, adminComponent, managedState);
        if (managedState.isProfileOwner()) {
            DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
            manager.setProfileName(adminComponent, context.getString(R.string.enterprise_profile_name));
            manager.setProfileEnabled(adminComponent);
        }
        Intent launchIntent = new Intent().setComponent(
            new ComponentName(context.getPackageName(), "app.secpal.MainActivity")
        );
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launchIntent);
    }

    public static EnterpriseManagedState syncPolicy(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(
            EnterprisePolicyState.ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );
        EnterpriseManagedState managedState = EnterprisePolicyState.read(context);
        String screenCapturePolicySignature = buildScreenCapturePolicySignature(managedState);
        String previousScreenCapturePolicySignature = preferences.getString(
            PREF_APPLIED_SCREEN_CAPTURE_POLICY,
            null
        );

        if (managedState.isManaged()) {
            if (!screenCapturePolicySignature.equals(previousScreenCapturePolicySignature)) {
                if (applyManagedScreenCapturePolicy(context, managedState)) {
                    preferences.edit()
                        .putString(PREF_APPLIED_SCREEN_CAPTURE_POLICY, screenCapturePolicySignature)
                        .apply();
                }
            }
        } else {
            preferences.edit().remove(PREF_APPLIED_SCREEN_CAPTURE_POLICY).apply();
        }

        if (managedState.isDeviceOwner()) {
            String appliedPolicySignature = buildAppliedPolicySignature(context, managedState);
            String previousAppliedPolicySignature = preferences.getString(
                PREF_APPLIED_POLICY_SIGNATURE,
                null
            );

            if (!appliedPolicySignature.equals(previousAppliedPolicySignature)) {
                applyDeviceOwnerPolicy(context, managedState);
                preferences.edit()
                    .putString(PREF_APPLIED_POLICY_SIGNATURE, appliedPolicySignature)
                    .apply();
            }
        } else {
            preferences.edit().remove(PREF_APPLIED_POLICY_SIGNATURE).apply();
        }

        return managedState;
    }

    public static void persistProvisioningConfig(Context context, PersistableBundle extras) {
        if (extras == null || extras.isEmpty()) {
            return;
        }

        SharedPreferences preferences = context.getSharedPreferences(
            EnterprisePolicyState.ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );
        SharedPreferences.Editor editor = preferences.edit();

        EnterprisePolicyConfig.fromPersistableBundle(extras).writeToPreferences(editor);
        editor.apply();
    }

    public static void clearManagedState(Context context) {
        context.getSharedPreferences(EnterprisePolicyState.ENTERPRISE_PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply();

        setDedicatedHomeEnabled(context, false);
    }

    public static void persistDebugPolicy(Context context, Bundle extras) {
        Map<String, Object> values = new LinkedHashMap<>();

        if (extras != null && !extras.isEmpty()) {
            for (String key : extras.keySet()) {
                values.put(key, getBundleValue(extras, key));
            }
        }

        persistDebugPolicy(context, values);
    }

    static void persistDebugPolicy(Context context, Map<String, ?> values) {
        SharedPreferences preferences = context.getSharedPreferences(
            EnterprisePolicyState.ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );
        SharedPreferences.Editor editor = preferences.edit();

        EnterprisePolicyConfig.fromMap(values).writeToPreferences(editor);

        if (!editor.commit()) {
            Log.e(LOG_TAG, "Failed to persist debug policy synchronously");
        }
    }

    public static void clearDebugPolicy(Context context) {
        SharedPreferences.Editor editor = context.getSharedPreferences(
            EnterprisePolicyState.ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        ).edit();

        editor.remove("kiosk_mode_enabled");
        editor.remove("lock_task_enabled");
        editor.remove("allow_phone");
        editor.remove("allow_sms");
        editor.remove("allowed_packages");
        editor.remove("prefer_gesture_navigation");

        if (!editor.commit()) {
            Log.e(LOG_TAG, "Failed to clear debug policy synchronously");
        }
    }

    public static PersistableBundle extractProvisioningAdminExtras(Intent intent) {
        if (intent == null) {
            return null;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(
                DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
                PersistableBundle.class
            );
        }

        return getProvisioningAdminExtrasLegacy(intent);
    }

    static boolean shouldDisableScreenCapture(EnterpriseManagedState managedState) {
        return managedState != null
            && managedState.isManaged();
    }

    private static void applyDeviceOwnerPolicy(Context context, EnterpriseManagedState managedState) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);

        if (devicePolicyManager == null) {
            return;
        }

        ComponentName adminComponent = new ComponentName(context, SecPalDeviceAdminReceiver.class);
        Set<String> managedHiddenPackages = readManagedHiddenPackages(context);

        if (managedState.isKioskActive()) {
            restoreManagedHiddenPackages(devicePolicyManager, adminComponent, managedHiddenPackages);
            Set<String> allowedPackages = managedState.resolveAllowedPackages(context);

            devicePolicyManager.setLockTaskPackages(
                adminComponent,
                allowedPackages.toArray(new String[0])
            );
            setLockTaskFeaturesIfSupported(devicePolicyManager, adminComponent, true);

            devicePolicyManager.setStatusBarDisabled(adminComponent, true);

            setKioskUserRestrictions(devicePolicyManager, adminComponent, true);

            configureDedicatedHome(context, devicePolicyManager, adminComponent);
            persistManagedHiddenPackages(
                context,
                reconcileLauncherVisibility(
                    context,
                    devicePolicyManager,
                    adminComponent,
                    allowedPackages,
                    true
                )
            );
            return;
        }

        setDedicatedHomeEnabled(context, false);
        restoreManagedHiddenPackages(devicePolicyManager, adminComponent, managedHiddenPackages);

        devicePolicyManager.setLockTaskPackages(adminComponent, new String[] { context.getPackageName() });
        setLockTaskFeaturesIfSupported(devicePolicyManager, adminComponent, false);

        devicePolicyManager.setStatusBarDisabled(adminComponent, false);

        setKioskUserRestrictions(devicePolicyManager, adminComponent, false);

        devicePolicyManager.clearPackagePersistentPreferredActivities(adminComponent, context.getPackageName());
        reconcileLauncherVisibility(
            context,
            devicePolicyManager,
            adminComponent,
            managedState.resolveAllowedPackages(context),
            false
        );
        persistManagedHiddenPackages(context, Collections.emptySet());
    }

    private static boolean applyManagedScreenCapturePolicy(
        Context context,
        EnterpriseManagedState managedState
    ) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);

        if (devicePolicyManager == null) {
            return false;
        }

        return applyScreenCapturePolicy(
            devicePolicyManager,
            new ComponentName(context, SecPalDeviceAdminReceiver.class),
            shouldDisableScreenCapture(managedState)
        );
    }

    private static void configureDedicatedHome(
        Context context,
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent
    ) {
        ComponentName dedicatedHomeComponent = new ComponentName(context.getPackageName(), "app.secpal.DedicatedDeviceHomeActivity");

        setDedicatedHomeEnabled(context, true);
        devicePolicyManager.clearPackagePersistentPreferredActivities(adminComponent, context.getPackageName());

        IntentFilter homeIntentFilter = new IntentFilter(Intent.ACTION_MAIN);

        homeIntentFilter.addCategory(Intent.CATEGORY_HOME);
        homeIntentFilter.addCategory(Intent.CATEGORY_DEFAULT);

        devicePolicyManager.addPersistentPreferredActivity(
            adminComponent,
            homeIntentFilter,
            dedicatedHomeComponent
        );

        for (KioskSettingsRedirectFilterSpec filterSpec : buildKioskSettingsRedirectFilters()) {
            IntentFilter settingsIntentFilter = new IntentFilter(filterSpec.getAction());

            if (filterSpec.hasDefaultCategory()) {
                settingsIntentFilter.addCategory(Intent.CATEGORY_DEFAULT);
            }

            devicePolicyManager.addPersistentPreferredActivity(
                adminComponent,
                settingsIntentFilter,
                dedicatedHomeComponent
            );
        }
    }

    static List<KioskSettingsRedirectFilterSpec> buildKioskSettingsRedirectFilters() {
        ArrayList<KioskSettingsRedirectFilterSpec> filters = new ArrayList<>();

        for (String action : KIOSK_REDIRECTED_SETTINGS_ACTIONS) {
            filters.add(new KioskSettingsRedirectFilterSpec(action, false));
            filters.add(new KioskSettingsRedirectFilterSpec(action, true));
        }

        return filters;
    }

    private static String buildScreenCapturePolicySignature(EnterpriseManagedState managedState) {
        return String.join(
            "|",
            managedState.getMode(),
            String.valueOf(shouldDisableScreenCapture(managedState))
        );
    }

    static final class KioskSettingsRedirectFilterSpec {
        private final String action;
        private final boolean defaultCategory;

        KioskSettingsRedirectFilterSpec(String action, boolean defaultCategory) {
            this.action = action;
            this.defaultCategory = defaultCategory;
        }

        String getAction() {
            return action;
        }

        boolean hasDefaultCategory() {
            return defaultCategory;
        }
    }

    private static void setKioskUserRestrictions(
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        boolean enabled
    ) {
        setKioskUserRestrictions(
            devicePolicyManager,
            adminComponent,
            enabled,
            BuildConfig.DEBUG
        );
    }

    @VisibleForTesting
    static void setKioskUserRestrictions(
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        boolean enabled,
        boolean debugBuild
    ) {
        if (debugBuild) {
            // Revision 1 blocked the documented ADB replacement path for test-only APKs.
            devicePolicyManager.clearUserRestriction(
                adminComponent,
                UserManager.DISALLOW_INSTALL_APPS
            );
        }

        for (String restriction : resolveKioskUserRestrictions(debugBuild)) {
            if (enabled) {
                devicePolicyManager.addUserRestriction(adminComponent, restriction);
            } else {
                devicePolicyManager.clearUserRestriction(adminComponent, restriction);
            }
        }
    }

    static List<String> resolveKioskUserRestrictions() {
        return resolveKioskUserRestrictions(BuildConfig.DEBUG);
    }

    static List<String> resolveKioskUserRestrictions(boolean debugBuild) {
        ArrayList<String> restrictions = new ArrayList<>();

        Collections.addAll(restrictions, BASE_KIOSK_USER_RESTRICTIONS);

        if (debugBuild) {
            restrictions.remove(UserManager.DISALLOW_INSTALL_APPS);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            restrictions.add(Api28EnterprisePolicy.dateTimeRestriction());
        }

        return restrictions;
    }

    static Integer resolveLockTaskFeatures(boolean kioskActive) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return null;
        }

        return Api28EnterprisePolicy.resolveLockTaskFeatures(kioskActive);
    }

    private static void setLockTaskFeaturesIfSupported(
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        boolean kioskActive
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return;
        }

        Api28EnterprisePolicy.setLockTaskFeatures(
            devicePolicyManager,
            adminComponent,
            resolveLockTaskFeatures(kioskActive)
        );
    }

    @RequiresApi(Build.VERSION_CODES.P)
    private static final class Api28EnterprisePolicy {
        private Api28EnterprisePolicy() {
        }

        static String dateTimeRestriction() {
            return UserManager.DISALLOW_CONFIG_DATE_TIME;
        }

        static int resolveLockTaskFeatures(boolean kioskActive) {
            if (kioskActive) {
                return DevicePolicyManager.LOCK_TASK_FEATURE_HOME;
            }

            return DevicePolicyManager.LOCK_TASK_FEATURE_HOME
                | DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS
                | DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO;
        }

        static void setLockTaskFeatures(
            DevicePolicyManager devicePolicyManager,
            ComponentName adminComponent,
            int lockTaskFeatures
        ) {
            devicePolicyManager.setLockTaskFeatures(adminComponent, lockTaskFeatures);
        }
    }

    private static boolean applyScreenCapturePolicy(
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        boolean disabled
    ) {
        try {
            devicePolicyManager.setScreenCaptureDisabled(adminComponent, disabled);
            return true;
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Failed to update screen-capture policy", exception);
            return false;
        }
    }

    private static Set<String> reconcileLauncherVisibility(
        Context context,
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        Set<String> allowedPackages,
        boolean hideDisallowedPackages
    ) {
        LinkedHashSet<String> hiddenPackages = new LinkedHashSet<>();

        for (String packageName : resolveLaunchablePackages(context)) {
            boolean shouldHide = hideDisallowedPackages
                && !context.getPackageName().equals(packageName)
                && !allowedPackages.contains(packageName);

            try {
                devicePolicyManager.setApplicationHidden(adminComponent, packageName, shouldHide);

                if (shouldHide) {
                    hiddenPackages.add(packageName);
                }
            } catch (RuntimeException exception) {
                Log.w(LOG_TAG, "Failed to change launcher visibility for " + packageName, exception);
            }
        }

        return hiddenPackages;
    }

    private static Set<String> readManagedHiddenPackages(Context context) {
        Set<String> storedPackages = context.getSharedPreferences(EnterprisePolicyState.ENTERPRISE_PREFS, Context.MODE_PRIVATE)
            .getStringSet(PREF_MANAGED_HIDDEN_PACKAGES, Collections.emptySet());

        return storedPackages == null
            ? new LinkedHashSet<>()
            : new LinkedHashSet<>(storedPackages);
    }

    private static void persistManagedHiddenPackages(Context context, Set<String> packageNames) {
        context.getSharedPreferences(EnterprisePolicyState.ENTERPRISE_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(PREF_MANAGED_HIDDEN_PACKAGES, new LinkedHashSet<>(packageNames))
            .apply();
    }

    private static void restoreManagedHiddenPackages(
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent,
        Set<String> packageNames
    ) {
        for (String packageName : packageNames) {
            try {
                devicePolicyManager.setApplicationHidden(adminComponent, packageName, false);
            } catch (RuntimeException exception) {
                Log.w(LOG_TAG, "Failed to restore launcher visibility for " + packageName, exception);
            }
        }
    }

    private static Set<String> resolveLaunchablePackages(Context context) {
        Intent launcherIntent = new Intent(Intent.ACTION_MAIN);

        launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);

        List<ResolveInfo> resolveInfos = context.getPackageManager().queryIntentActivities(launcherIntent, 0);
        LinkedHashSet<String> packageNames = new LinkedHashSet<>();

        for (ResolveInfo resolveInfo : resolveInfos) {
            if (resolveInfo.activityInfo != null && resolveInfo.activityInfo.packageName != null) {
                packageNames.add(resolveInfo.activityInfo.packageName);
            }
        }

        packageNames.add(context.getPackageName());

        return packageNames;
    }

    private static String buildAppliedPolicySignature(
        Context context,
        EnterpriseManagedState managedState
    ) {
        return buildAppliedPolicySignature(
            context,
            managedState,
            Build.VERSION.SDK_INT
        );
    }

    static String buildAppliedPolicySignature(
        Context context,
        EnterpriseManagedState managedState,
        int sdkInt
    ) {
        List<String> allowedPackages = new ArrayList<>(managedState.resolveAllowedPackages(context));
        List<String> launchablePackages = new ArrayList<>(resolveLaunchablePackages(context));

        Collections.sort(allowedPackages);
        Collections.sort(launchablePackages);

        return String.join(
            "|",
            String.valueOf(DEVICE_OWNER_POLICY_REVISION),
            String.valueOf(sdkInt >= Build.VERSION_CODES.P),
            managedState.getMode(),
            String.valueOf(managedState.isKioskActive()),
            String.valueOf(managedState.isLockTaskEnabled()),
            String.valueOf(managedState.isAllowPhone()),
            String.valueOf(managedState.isAllowSms()),
            String.join(",", allowedPackages),
            String.join(",", launchablePackages)
        );
    }

    private static void setDedicatedHomeEnabled(Context context, boolean enabled) {
        int newState = enabled
            ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;

        context.getPackageManager().setComponentEnabledSetting(
            new ComponentName(context.getPackageName(), "app.secpal.DedicatedDeviceHomeActivity"),
            newState,
            PackageManager.DONT_KILL_APP
        );
    }

    @SuppressWarnings("deprecation")
    private static Object getBundleValue(Bundle bundle, String key) {
        return bundle.get(key);
    }

    @SuppressWarnings("deprecation")
    private static PersistableBundle getProvisioningAdminExtrasLegacy(Intent intent) {
        return intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
    }

    static void applyProvisioningGestureNavigationIfRequested(
        Context context,
        ComponentName adminComponent,
        EnterpriseManagedState managedState
    ) {
        if (!managedState.isDeviceOwner() || !managedState.isPreferGestureNavigation()) {
            SystemNavigationSettings.setProvisioningGestureNavigationPending(context, false);
            return;
        }

        if (SystemNavigationSettings.isGestureNavigationEnabled(context)) {
            SystemNavigationSettings.setProvisioningGestureNavigationPending(context, false);
            return;
        }

        requestManagedGestureNavigationSettings(context, adminComponent);

        if (SystemNavigationSettings.isGestureNavigationEnabled(context)) {
            SystemNavigationSettings.setProvisioningGestureNavigationPending(context, false);
            return;
        }

        SystemNavigationSettings.setProvisioningGestureNavigationPending(
            context,
            SystemNavigationSettings.canOpenGestureNavigationSettings(context)
        );
    }

    private static void requestManagedGestureNavigationSettings(
        Context context,
        ComponentName adminComponent
    ) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);

        if (devicePolicyManager == null || adminComponent == null) {
            return;
        }

        setSecureSetting(devicePolicyManager, adminComponent, SystemNavigationSettings.NAVIGATION_MODE_SETTING, "2");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_gesture_hint", "1");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_gesture_while_hidden", "1");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_gesture_detail_type", "1");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigation_bar_button_to_hide_keyboard", "0");
        setGlobalSetting(devicePolicyManager, adminComponent, "navigationbar_switch_apps_when_hint_hidden", "0");
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
            Log.w(GESTURE_NAVIGATION_LOG_TAG, "Failed to set secure setting " + name + " for gesture navigation", exception);
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
            Log.w(GESTURE_NAVIGATION_LOG_TAG, "Failed to set global setting " + name + " for gesture navigation", exception);
        }
    }
}
