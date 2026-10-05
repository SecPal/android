/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.content.Intent;
import android.util.Log;

final class SystemNavigationController {
    private static final String LOG_TAG = "SecPalSystemNavigation";

    private SystemNavigationController() {
    }

    static boolean openGestureNavigationSettings(Activity activity) {
        Intent intent = SystemNavigationSettings.resolveGestureNavigationSettingsIntent(activity);

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

    static boolean maybeCompleteProvisioningGestureNavigation(
        Activity activity,
        EnterpriseManagedState managedState
    ) {
        if (!managedState.isDeviceOwner() || !managedState.isPreferGestureNavigation()) {
            SystemNavigationSettings.setProvisioningGestureNavigationPending(activity, false);
            return false;
        }

        if (SystemNavigationSettings.isGestureNavigationEnabled(activity)) {
            SystemNavigationSettings.setProvisioningGestureNavigationPending(activity, false);
            return false;
        }

        if (!SystemNavigationSettings.isProvisioningGestureNavigationPending(activity)
            || !SystemNavigationSettings.canOpenGestureNavigationSettings(activity)) {
            return false;
        }

        if (!EnterprisePolicyClient.temporarilyExitLockTask(activity)) {
            return false;
        }

        boolean launchedSettings = false;

        try {
            if (!openGestureNavigationSettings(activity)) {
                return false;
            }

            launchedSettings = true;
            SystemNavigationSettings.setProvisioningGestureNavigationPending(activity, false);
            return true;
        } finally {
            if (!launchedSettings) {
                EnterprisePolicyClient.maybeEnterLockTask(activity);
            }
        }
    }
}
