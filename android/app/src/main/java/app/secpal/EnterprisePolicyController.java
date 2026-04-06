/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.PersistableBundle;
import android.os.UserManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class EnterprisePolicyController {
    private static final String LOG_TAG = "SecPalEnterprise";
    static final String ENTERPRISE_PREFS = "secpal_enterprise_policy";
    private static final String PREF_MANAGED_MODE = "managed_mode";
    private static final String PREF_APPLIED_POLICY_SIGNATURE = "applied_policy_signature";
    private static final String PREF_MANAGED_HIDDEN_PACKAGES = "managed_hidden_packages";
    private static final int KIOSK_LOCK_TASK_FEATURES = DevicePolicyManager.LOCK_TASK_FEATURE_HOME;
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
    private static final String[] KIOSK_USER_RESTRICTIONS = new String[] {
        UserManager.DISALLOW_CONFIG_WIFI,
        UserManager.DISALLOW_CONFIG_BLUETOOTH,
        UserManager.DISALLOW_CONFIG_MOBILE_NETWORKS,
        UserManager.DISALLOW_CONFIG_TETHERING,
        UserManager.DISALLOW_CONFIG_VPN,
        UserManager.DISALLOW_CONFIG_DATE_TIME,
        UserManager.DISALLOW_APPS_CONTROL,
        UserManager.DISALLOW_INSTALL_APPS,
        UserManager.DISALLOW_UNINSTALL_APPS,
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_FACTORY_RESET
    };

    private EnterprisePolicyController() {
    }

    public static EnterpriseManagedState syncPolicy(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(
            ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );
        EnterprisePolicyConfig policyConfig = resolveCurrentPolicyConfig(context, preferences);
        String managedMode = resolveManagedMode(context);

        preferences.edit().putString(PREF_MANAGED_MODE, managedMode).apply();

        EnterpriseManagedState managedState = new EnterpriseManagedState(managedMode, policyConfig);

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
            ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );
        SharedPreferences.Editor editor = preferences.edit();

        EnterprisePolicyConfig.fromPersistableBundle(extras).writeToPreferences(editor);
        editor.apply();
    }

    public static void clearManagedState(Context context) {
        context.getSharedPreferences(ENTERPRISE_PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply();

        setDedicatedHomeEnabled(context, false);
    }

    public static void persistDebugPolicy(Context context, Bundle extras) {
        SharedPreferences preferences = context.getSharedPreferences(
            ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );
        SharedPreferences.Editor editor = preferences.edit();

        EnterprisePolicyConfig.fromBundle(extras).writeToPreferences(editor);
        editor.apply();
    }

    public static void clearDebugPolicy(Context context) {
        SharedPreferences.Editor editor = context.getSharedPreferences(
            ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        ).edit();

        editor.remove("kiosk_mode_enabled");
        editor.remove("lock_task_enabled");
        editor.remove("allow_phone");
        editor.remove("allow_sms");
        editor.remove("allowed_packages");
        editor.remove("prefer_gesture_navigation");
        editor.apply();
    }

    public static void maybeEnterLockTask(Activity activity) {
        EnterpriseManagedState managedState = syncPolicy(activity);
        ActivityManager activityManager = activity.getSystemService(ActivityManager.class);

        if (!managedState.isLockTaskEnabled()) {
            if (activityManager != null
                && activityManager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.stopLockTask();
            }

            return;
        }

        DevicePolicyManager devicePolicyManager = activity.getSystemService(DevicePolicyManager.class);
        if (devicePolicyManager == null || !devicePolicyManager.isLockTaskPermitted(activity.getPackageName())) {
            return;
        }

        if (activityManager != null
            && activityManager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) {
            return;
        }

        activity.startLockTask();
    }

    static boolean temporarilyExitLockTask(Activity activity) {
        ActivityManager activityManager = activity.getSystemService(ActivityManager.class);

        if (activityManager == null
            || activityManager.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) {
            return true;
        }

        try {
            activity.stopLockTask();
            return true;
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Failed to exit lock task for a temporary system settings flow", exception);
            return false;
        }
    }

    public static boolean launchPhone(Context context) {
        EnterpriseManagedState managedState = syncPolicy(context);

        if (!managedState.isAllowPhone()) {
            return false;
        }

        return launchIntent(
            context,
            new Intent(Intent.ACTION_DIAL).setData(android.net.Uri.parse("tel:"))
        );
    }

    public static boolean launchSms(Context context) {
        EnterpriseManagedState managedState = syncPolicy(context);

        if (!managedState.isAllowSms()) {
            return false;
        }

        return launchIntent(
            context,
            new Intent(Intent.ACTION_SENDTO).setData(android.net.Uri.parse("smsto:"))
        );
    }

    public static List<AllowedLaunchApp> resolveAllowedLaunchApps(Context context) {
        EnterpriseManagedState managedState = syncPolicy(context);

        if (!managedState.isKioskActive()) {
            return Collections.emptyList();
        }

        PackageManager packageManager = context.getPackageManager();
        List<AllowedLaunchApp> apps = new ArrayList<>();
        Set<String> excludedPackages = new LinkedHashSet<>();

        if (managedState.isAllowPhone()) {
            String dialerPackage = managedState.resolveDialerPackage(context);

            if (dialerPackage != null) {
                excludedPackages.add(dialerPackage);
            }
        }

        if (managedState.isAllowSms()) {
            String smsPackage = managedState.resolveSmsPackage(context);

            if (smsPackage != null) {
                excludedPackages.add(smsPackage);
            }
        }

        for (String packageName : managedState.resolveAllowedPackages(context)) {
            if (context.getPackageName().equals(packageName) || excludedPackages.contains(packageName)) {
                continue;
            }

            Intent launchIntent = resolveLaunchIntentForPackage(context, packageName);

            if (launchIntent == null) {
                continue;
            }

            try {
                ApplicationInfo applicationInfo = packageManager.getApplicationInfo(packageName, 0);
                String label = String.valueOf(packageManager.getApplicationLabel(applicationInfo));

                apps.add(new AllowedLaunchApp(packageName, label));
            } catch (PackageManager.NameNotFoundException exception) {
                Log.w(LOG_TAG, "Allowed package disappeared before it could be launched: " + packageName, exception);
            }
        }

        apps.sort(Comparator.comparing(AllowedLaunchApp::getLabel, String.CASE_INSENSITIVE_ORDER));

        return apps;
    }

    public static boolean launchAllowedApp(Context context, String packageName) {
        if (packageName == null || packageName.trim().isEmpty()) {
            return false;
        }

        EnterpriseManagedState managedState = syncPolicy(context);
        String normalizedPackageName = packageName.trim();

        if (!managedState.isKioskActive() || !managedState.resolveAllowedPackages(context).contains(normalizedPackageName)) {
            return false;
        }

        Intent launchIntent = resolveLaunchIntentForPackage(context, normalizedPackageName);

        if (launchIntent == null) {
            return false;
        }

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(launchIntent);

        return true;
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

        return intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
    }

    static String resolveManagedMode(boolean deviceOwner, boolean profileOwner) {
        if (deviceOwner) {
            return EnterpriseManagedState.MODE_DEVICE_OWNER;
        }

        if (profileOwner) {
            return EnterpriseManagedState.MODE_PROFILE_OWNER;
        }

        return EnterpriseManagedState.MODE_NONE;
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

    private static String resolveManagedMode(Context context) {
        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);

        if (devicePolicyManager == null) {
            return EnterpriseManagedState.MODE_NONE;
        }

        return resolveManagedMode(
            devicePolicyManager.isDeviceOwnerApp(context.getPackageName()),
            devicePolicyManager.isProfileOwnerApp(context.getPackageName())
        );
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

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                devicePolicyManager.setLockTaskFeatures(adminComponent, KIOSK_LOCK_TASK_FEATURES);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                devicePolicyManager.setStatusBarDisabled(adminComponent, true);
            }

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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            devicePolicyManager.setLockTaskFeatures(
                adminComponent,
                DevicePolicyManager.LOCK_TASK_FEATURE_HOME
                    | DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS
                    | DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
            );
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            devicePolicyManager.setStatusBarDisabled(adminComponent, false);
        }

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

    private static void configureDedicatedHome(
        Context context,
        DevicePolicyManager devicePolicyManager,
        ComponentName adminComponent
    ) {
        ComponentName dedicatedHomeComponent = new ComponentName(context, DedicatedDeviceHomeActivity.class);

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
        for (String restriction : KIOSK_USER_RESTRICTIONS) {
            if (enabled) {
                devicePolicyManager.addUserRestriction(adminComponent, restriction);
            } else {
                devicePolicyManager.clearUserRestriction(adminComponent, restriction);
            }
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
        Set<String> storedPackages = context.getSharedPreferences(ENTERPRISE_PREFS, Context.MODE_PRIVATE)
            .getStringSet(PREF_MANAGED_HIDDEN_PACKAGES, Collections.emptySet());

        return storedPackages == null
            ? new LinkedHashSet<>()
            : new LinkedHashSet<>(storedPackages);
    }

    private static void persistManagedHiddenPackages(Context context, Set<String> packageNames) {
        context.getSharedPreferences(ENTERPRISE_PREFS, Context.MODE_PRIVATE)
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
        List<String> allowedPackages = new ArrayList<>(managedState.resolveAllowedPackages(context));
        List<String> launchablePackages = new ArrayList<>(resolveLaunchablePackages(context));

        Collections.sort(allowedPackages);
        Collections.sort(launchablePackages);

        return String.join(
            "|",
            managedState.getMode(),
            String.valueOf(managedState.isKioskActive()),
            String.valueOf(managedState.isLockTaskEnabled()),
            String.valueOf(managedState.isAllowPhone()),
            String.valueOf(managedState.isAllowSms()),
            String.join(",", allowedPackages),
            String.join(",", launchablePackages)
        );
    }

    private static boolean launchIntent(Context context, Intent intent) {
        Intent resolvedIntent = resolveLaunchableIntent(context, intent);

        if (resolvedIntent == null) {
            return false;
        }

        resolvedIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(resolvedIntent);
        return true;
    }

    private static Intent resolveLaunchableIntent(Context context, Intent intent) {
        PackageManager packageManager = context.getPackageManager();
        ComponentName defaultComponent = intent.resolveActivity(packageManager);

        if (defaultComponent != null) {
            Intent resolvedIntent = new Intent(intent);

            resolvedIntent.setComponent(defaultComponent);
            return resolvedIntent;
        }

        ComponentName fallbackComponent = resolveFirstComponent(
            packageManager.queryIntentActivities(intent, 0)
        );

        if (fallbackComponent == null) {
            return null;
        }

        Intent resolvedIntent = new Intent(intent);

        resolvedIntent.setComponent(fallbackComponent);
        return resolvedIntent;
    }

    static ComponentName resolveFirstComponent(List<ResolveInfo> resolveInfos) {
        if (resolveInfos == null) {
            return null;
        }

        for (ResolveInfo resolveInfo : resolveInfos) {
            if (resolveInfo == null
                || resolveInfo.activityInfo == null
                || resolveInfo.activityInfo.packageName == null
                || resolveInfo.activityInfo.name == null) {
                continue;
            }

            return new ComponentName(resolveInfo.activityInfo.packageName, resolveInfo.activityInfo.name);
        }

        return null;
    }

    private static Intent resolveLaunchIntentForPackage(Context context, String packageName) {
        PackageManager packageManager = context.getPackageManager();
        Intent launcherIntent = new Intent(Intent.ACTION_MAIN);

        launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        launcherIntent.setPackage(packageName);

        List<ResolveInfo> resolveInfos = packageManager.queryIntentActivities(launcherIntent, 0);

        for (ResolveInfo resolveInfo : resolveInfos) {
            if (resolveInfo.activityInfo == null || resolveInfo.activityInfo.name == null) {
                continue;
            }

            Intent resolvedIntent = new Intent(launcherIntent);

            resolvedIntent.setComponent(
                new ComponentName(resolveInfo.activityInfo.packageName, resolveInfo.activityInfo.name)
            );

            return resolvedIntent;
        }

        return packageManager.getLaunchIntentForPackage(packageName);
    }

    private static void setDedicatedHomeEnabled(Context context, boolean enabled) {
        int newState = enabled
            ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;

        context.getPackageManager().setComponentEnabledSetting(
            new ComponentName(context, DedicatedDeviceHomeActivity.class),
            newState,
            PackageManager.DONT_KILL_APP
        );
    }

    public static final class AllowedLaunchApp {
        private final String packageName;
        private final String label;

        AllowedLaunchApp(String packageName, String label) {
            this.packageName = packageName;
            this.label = label;
        }

        public String getPackageName() {
            return packageName;
        }

        public String getLabel() {
            return label;
        }
    }
}
