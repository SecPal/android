/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;

import java.util.ArrayList;
import java.util.List;

/** Shared platform navigation observations and provisioning handoff state. */
final class SystemNavigationSettings {
    private static final int GESTURE_NAVIGATION_MODE = 2;
    private static final String SETTINGS_PACKAGE_NAME = "com.android.settings";
    static final String NAVIGATION_MODE_SETTING = "navigation_mode";
    private static final String PREFS_NAME = "secpal_system_navigation";
    private static final String PREF_PROVISIONING_GESTURE_NAVIGATION_PENDING = "provisioning_gesture_navigation_pending";

    private static final String PREF_GESTURE_REQUEST_SEEN = "gesture_request_seen";

    private SystemNavigationSettings() {
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

    static boolean isProvisioningGestureNavigationPending(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(PREF_PROVISIONING_GESTURE_NAVIGATION_PENDING, false);
    }

    static void setProvisioningGestureNavigationPending(Context context, boolean pending) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREF_PROVISIONING_GESTURE_NAVIGATION_PENDING, pending)
            .apply();
    }

    // Work owns consumption of the UI handoff; this flag is never management authority.
    static void observeProvisioningGestureNavigationRequest(Context context, boolean requested) {
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean seen = preferences.getBoolean(PREF_GESTURE_REQUEST_SEEN, false);
        if (!requested || !seen) {
            preferences.edit().putBoolean(PREF_GESTURE_REQUEST_SEEN, requested)
                .putBoolean(PREF_PROVISIONING_GESTURE_NAVIGATION_PENDING, requested).apply();
        }
    }

    static Intent resolveGestureNavigationSettingsIntent(Context context) {
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
