/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

final class SamsungHardwareButtonLaunch {
    static final String EXTRA_HARDWARE_TRIGGER_ACTION = "app.secpal.extra.HARDWARE_TRIGGER_ACTION";
    static final String EXTRA_HARDWARE_TRIGGER_HANDLED = "app.secpal.extra.HARDWARE_TRIGGER_HANDLED";
    static final String HARDWARE_TRIGGER_ACTION_SHORT_PRESS = "short_press";
    static final String HARDWARE_TRIGGER_ACTION_LONG_PRESS = "long_press";
    private static final String SHORT_PRESS_ALIAS_CLASS_NAME = ".SamsungEmergencyShortPressAlias";
    private static final String LONG_PRESS_ALIAS_CLASS_NAME = ".SamsungEmergencyLongPressAlias";

    private SamsungHardwareButtonLaunch() {
    }

    static Intent createLaunchIntent(Context context, String hardwareAction) {
        Intent launchIntent = new Intent(context, MainActivity.class);

        launchIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        launchIntent.putExtra(EXTRA_HARDWARE_TRIGGER_ACTION, hardwareAction);

        return launchIntent;
    }

    static String resolveLaunchAction(Intent intent, String packageName) {
        if (intent == null || intent.getBooleanExtra(EXTRA_HARDWARE_TRIGGER_HANDLED, false)) {
            return null;
        }

        String syntheticAction = intent.getStringExtra(EXTRA_HARDWARE_TRIGGER_ACTION);

        if (HARDWARE_TRIGGER_ACTION_SHORT_PRESS.equals(syntheticAction)
            || HARDWARE_TRIGGER_ACTION_LONG_PRESS.equals(syntheticAction)) {
            return syntheticAction;
        }

        ComponentName componentName = intent.getComponent();

        if (componentName == null) {
            return null;
        }

        String className = componentName.getClassName();

        if ((packageName + SHORT_PRESS_ALIAS_CLASS_NAME).equals(className)) {
            return HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
        }

        if ((packageName + LONG_PRESS_ALIAS_CLASS_NAME).equals(className)) {
            return HARDWARE_TRIGGER_ACTION_LONG_PRESS;
        }

        return null;
    }

    static boolean shouldWakeDevice(Intent intent, String packageName) {
        return resolveLaunchAction(intent, packageName) != null;
    }

    static void markHandled(Intent intent) {
        if (intent != null) {
            intent.putExtra(EXTRA_HARDWARE_TRIGGER_HANDLED, true);
        }
    }
}
