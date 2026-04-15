/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

final class SamsungHardwareButtonLaunch {
    static final String EXTRA_HARDWARE_TRIGGER_ACTION = "hardware_trigger_action";
    static final String EXTRA_HARDWARE_TRIGGER_HANDLED = "hardware_trigger_handled";
    static final String EXTRA_HARDWARE_TRIGGER_KEY_CODE = "hardware_trigger_key_code";
    static final String HARDWARE_TRIGGER_ACTION_SHORT_PRESS = "short_press";
    static final String HARDWARE_TRIGGER_ACTION_LONG_PRESS = "long_press";
    private static final String SHORT_PRESS_ALIAS_CLASS_NAME = ".SamsungEmergencyShortPressAlias";
    private static final String LONG_PRESS_ALIAS_CLASS_NAME = ".SamsungEmergencyLongPressAlias";
    private static final Map<Integer, Long> activeHardKeyReportStartedAt = new ConcurrentHashMap<>();
    static LongSupplier hardKeyReportTimeMs = () -> System.nanoTime() / 1_000_000L;

    private SamsungHardwareButtonLaunch() {
    }

    static Intent createLaunchIntent(Context context, String hardwareAction) {
        return createLaunchIntent(context, hardwareAction, KeyEvent.KEYCODE_UNKNOWN);
    }

    static Intent createLaunchIntent(Context context, String hardwareAction, int keyCode) {
        Intent launchIntent = new Intent(context, MainActivity.class);

        launchIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        launchIntent.putExtra(EXTRA_HARDWARE_TRIGGER_ACTION, hardwareAction);
        launchIntent.putExtra(EXTRA_HARDWARE_TRIGGER_KEY_CODE, keyCode);

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

        String reportAction = resolveHardKeyReportAction(intent);

        if (reportAction != null) {
            return reportAction;
        }

        ComponentName componentName = intent.getComponent();

        if (componentName == null) {
            return null;
        }

        String className = componentName.getClassName();

        return resolveAliasLaunchAction(className, packageName);
    }

    static String resolveAliasLaunchAction(String className, String packageName) {
        if (className == null || packageName == null) {
            return null;
        }

        if ((packageName + SHORT_PRESS_ALIAS_CLASS_NAME).equals(className)) {
            return HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
        }

        if ((packageName + LONG_PRESS_ALIAS_CLASS_NAME).equals(className)) {
            return HARDWARE_TRIGGER_ACTION_LONG_PRESS;
        }

        return null;
    }

    static int resolveLaunchKeyCode(Intent intent) {
        if (intent == null) {
            return KeyEvent.KEYCODE_UNKNOWN;
        }

        if (intent.hasExtra(EXTRA_HARDWARE_TRIGGER_KEY_CODE)) {
            return intent.getIntExtra(EXTRA_HARDWARE_TRIGGER_KEY_CODE, KeyEvent.KEYCODE_UNKNOWN);
        }

        return intent.getIntExtra(SamsungHardKeyReceiver.EXTRA_KEY_CODE, KeyEvent.KEYCODE_UNKNOWN);
    }

    static boolean shouldWakeDevice(Intent intent, String packageName) {
        return resolveLaunchAction(intent, packageName) != null;
    }

    static void markHandled(Intent intent) {
        if (intent != null) {
            intent.putExtra(EXTRA_HARDWARE_TRIGGER_HANDLED, true);
        }
    }

    private static String resolveHardKeyReportAction(Intent intent) {
        if (intent == null || !SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT.equals(intent.getAction())) {
            return null;
        }

        int keyCode = resolveLaunchKeyCode(intent);

        if (!isSupportedSamsungHardKeyCode(keyCode)) {
            activeHardKeyReportStartedAt.remove(Integer.valueOf(keyCode));
            return null;
        }

        Integer reportType = resolveReportType(intent);

        if (reportType == null) {
            return null;
        }

        switch (reportType.intValue()) {
            case SamsungHardKeyReceiver.REPORT_TYPE_DOWN:
                activeHardKeyReportStartedAt.put(
                    Integer.valueOf(keyCode),
                    Long.valueOf(currentHardKeyReportTimeMs())
                );
                return null;
            case SamsungHardKeyReceiver.REPORT_TYPE_UP:
                return resolveUpAction(keyCode);
            case SamsungHardKeyReceiver.REPORT_TYPE_DOWN_UP:
                activeHardKeyReportStartedAt.remove(Integer.valueOf(keyCode));
                return HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
            case SamsungHardKeyReceiver.REPORT_TYPE_LONG:
                activeHardKeyReportStartedAt.remove(Integer.valueOf(keyCode));
                return HARDWARE_TRIGGER_ACTION_LONG_PRESS;
            default:
                return null;
        }
    }

    private static String resolveUpAction(int keyCode) {
        Long pressedAt = activeHardKeyReportStartedAt.remove(Integer.valueOf(keyCode));

        if (pressedAt == null) {
            return HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
        }

        long holdDurationMs = Math.max(0L, currentHardKeyReportTimeMs() - pressedAt.longValue());

        if (holdDurationMs >= SecPalEnterprisePlugin.HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS) {
            return HARDWARE_TRIGGER_ACTION_LONG_PRESS;
        }

        return HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
    }

    private static Integer resolveReportType(Intent intent) {
        if (intent == null) {
            return null;
        }

        if (intent.getBooleanExtra(SamsungHardKeyReceiver.EXTRA_REPORT_TYPE_NEW_LONG_UP, false)) {
            return Integer.valueOf(SamsungHardKeyReceiver.REPORT_TYPE_LONG);
        }

        if (intent.hasExtra(SamsungHardKeyReceiver.EXTRA_REPORT_TYPE_NEW)) {
            return Integer.valueOf(
                intent.getIntExtra(
                    SamsungHardKeyReceiver.EXTRA_REPORT_TYPE_NEW,
                    Integer.MIN_VALUE
                )
            );
        }

        if (intent.hasExtra(SamsungHardKeyReceiver.EXTRA_REPORT_TYPE)) {
            return Integer.valueOf(
                intent.getIntExtra(
                    SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
                    Integer.MIN_VALUE
                )
            );
        }

        return null;
    }

    private static boolean isSupportedSamsungHardKeyCode(int keyCode) {
        return keyCode == SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
            || keyCode == SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS;
    }

    static void resetHardKeyReportState() {
        activeHardKeyReportStartedAt.clear();
        hardKeyReportTimeMs = () -> System.nanoTime() / 1_000_000L;
    }

    private static long currentHardKeyReportTimeMs() {
        return hardKeyReportTimeMs.getAsLong();
    }
}
