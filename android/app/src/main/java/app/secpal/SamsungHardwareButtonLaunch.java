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

    static Intent createForegroundLaunchIntent(Context context, String hardwareAction, int keyCode) {
        Intent launchIntent = new Intent(context, MainActivity.class);

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launchIntent.putExtra(EXTRA_HARDWARE_TRIGGER_ACTION, hardwareAction);
        launchIntent.putExtra(EXTRA_HARDWARE_TRIGGER_KEY_CODE, keyCode);

        return launchIntent;
    }

    static String resolveLaunchAction(Intent intent, String packageName) {
        return resolveLaunchAction(intent, packageName, hardKeyReportTimeMs);
    }

    static String resolveLaunchAction(Intent intent, String packageName, LongSupplier timeMs) {
        LongSupplier effectiveTimeMs = timeMs == null ? hardKeyReportTimeMs : timeMs;

        if (intent == null || intent.getBooleanExtra(EXTRA_HARDWARE_TRIGGER_HANDLED, false)) {
            return null;
        }

        String syntheticAction = intent.getStringExtra(EXTRA_HARDWARE_TRIGGER_ACTION);

        if (HARDWARE_TRIGGER_ACTION_SHORT_PRESS.equals(syntheticAction)
            || HARDWARE_TRIGGER_ACTION_LONG_PRESS.equals(syntheticAction)) {
            return syntheticAction;
        }

        String reportAction = resolveHardKeyReportAction(intent, effectiveTimeMs);

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

    static String resolveLaunchAction(KeyEvent event) {
        if (event == null) {
            return null;
        }

        return resolveLaunchAction(
            event.getAction(),
            event.getKeyCode(),
            event.getRepeatCount(),
            event.isCanceled(),
            event::getEventTime
        );
    }

    static String resolveLaunchAction(KeyEvent event, LongSupplier timeMs) {
        if (event == null) {
            return null;
        }

        return resolveLaunchAction(
            event.getAction(),
            event.getKeyCode(),
            event.getRepeatCount(),
            event.isCanceled(),
            timeMs
        );
    }

    static String resolveLaunchAction(
        int action,
        int keyCode,
        int repeatCount,
        boolean canceled,
        LongSupplier timeMs
    ) {
        LongSupplier effectiveTimeMs = timeMs == null ? hardKeyReportTimeMs : timeMs;

        if (!isSupportedLaunchKeyCode(keyCode) || canceled) {
            activeHardKeyReportStartedAt.remove(Integer.valueOf(keyCode));
            return null;
        }

        switch (action) {
            case KeyEvent.ACTION_DOWN:
                if (repeatCount == 0) {
                    activeHardKeyReportStartedAt.put(
                        Integer.valueOf(keyCode),
                        Long.valueOf(effectiveTimeMs.getAsLong())
                    );
                }
                return null;
            case KeyEvent.ACTION_UP:
                return resolveUpAction(keyCode, effectiveTimeMs);
            default:
                return null;
        }
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

    private static String resolveHardKeyReportAction(Intent intent, LongSupplier timeMs) {
        if (intent == null || !SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT.equals(intent.getAction())) {
            return null;
        }

        int keyCode = resolveLaunchKeyCode(intent);

        if (!isSupportedLaunchKeyCode(keyCode)) {
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
                    Long.valueOf(timeMs.getAsLong())
                );
                return null;
            case SamsungHardKeyReceiver.REPORT_TYPE_UP:
                return resolveUpAction(keyCode, timeMs);
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

    private static String resolveUpAction(int keyCode, LongSupplier timeMs) {
        Long pressedAt = activeHardKeyReportStartedAt.remove(Integer.valueOf(keyCode));

        if (pressedAt == null) {
            return HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
        }

        long holdDurationMs = Math.max(0L, timeMs.getAsLong() - pressedAt.longValue());

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

    static boolean isSupportedLaunchKeyCode(int keyCode) {
        return keyCode == SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
            || keyCode == SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS;
    }

    static void resetHardKeyReportState() {
        activeHardKeyReportStartedAt.clear();
        hardKeyReportTimeMs = () -> System.nanoTime() / 1_000_000L;
    }
}
