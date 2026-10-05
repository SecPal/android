/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Work-side presentation and use of policy capabilities, without owner-policy mutation. */
public final class EnterprisePolicyClient {
    private static final String LOG_TAG = "SecPalEnterprise";

    private EnterprisePolicyClient() {
    }

    public static EnterpriseManagedState getManagedState(Context context) {
        return EnterprisePolicyState.read(context);
    }

    public static void maybeEnterLockTask(Activity activity) {
        maybeEnterLockTask(activity, EnterprisePolicyState.read(activity));
    }

    static void maybeEnterLockTask(Activity activity, EnterpriseManagedState managedState) {
        ActivityManager activityManager = activity.getSystemService(ActivityManager.class);

        if (!managedState.isLockTaskEnabled()) {
            if (activityManager != null
                && activityManager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.stopLockTask();
            }

            return;
        }

        if (!EnterprisePolicyState.isLockTaskPermitted(activity)) {
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
        EnterpriseManagedState managedState = EnterprisePolicyState.read(context);

        if (!managedState.isAllowPhone()) {
            return false;
        }

        return launchIntent(
            context,
            new Intent(Intent.ACTION_DIAL).setData(android.net.Uri.parse("tel:"))
        );
    }

    public static boolean launchSms(Context context) {
        EnterpriseManagedState managedState = EnterprisePolicyState.read(context);

        if (!managedState.isAllowSms()) {
            return false;
        }

        return launchIntent(
            context,
            new Intent(Intent.ACTION_SENDTO).setData(android.net.Uri.parse("smsto:"))
        );
    }

    public static List<AllowedLaunchApp> resolveAllowedLaunchApps(Context context) {
        EnterpriseManagedState managedState = EnterprisePolicyState.read(context);

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

        EnterpriseManagedState managedState = EnterprisePolicyState.read(context);
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

    static boolean shouldOpenDedicatedHomeOnLaunch(
        Intent intent,
        EnterpriseManagedState managedState
    ) {
        if (intent == null) {
            return false;
        }

        return shouldOpenDedicatedHomeOnLaunch(
            intent.getAction(),
            intent.hasCategory(Intent.CATEGORY_LAUNCHER),
            intent.hasCategory(Intent.CATEGORY_HOME),
            managedState
        );
    }

    static boolean shouldOpenDedicatedHomeOnLaunch(
        String action,
        boolean hasLauncherCategory,
        boolean hasHomeCategory,
        EnterpriseManagedState managedState
    ) {
        if (managedState == null || !managedState.usesDebugKioskHome()) {
            return false;
        }

        if (!Intent.ACTION_MAIN.equals(action)) {
            return false;
        }

        return hasLauncherCategory || hasHomeCategory;
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

        ComponentName fallbackComponent = EnterpriseManagedState.resolveFirstComponent(
            packageManager.queryIntentActivities(intent, 0)
        );

        if (fallbackComponent == null) {
            return null;
        }

        Intent resolvedIntent = new Intent(intent);

        resolvedIntent.setComponent(fallbackComponent);
        return resolvedIntent;
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
    }}
