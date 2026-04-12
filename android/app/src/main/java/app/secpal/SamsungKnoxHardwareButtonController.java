/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Build;
import android.util.Log;
import android.view.KeyEvent;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

final class SamsungKnoxHardwareButtonController {
    static final String ACTION_HARD_KEY_PRESS = "com.samsung.android.knox.intent.action.HARD_KEY_PRESS";
    static final String ACTION_HARD_KEY_REPORT = "com.samsung.android.knox.intent.action.HARD_KEY_REPORT";
    static final String EXTRA_KEY_CODE = "com.samsung.android.knox.intent.extra.KEY_CODE";
    static final String EXTRA_REPORT_TYPE = "com.samsung.android.knox.intent.extra.KEY_REPORT_TYPE";
    static final String EXTRA_REPORT_TYPE_NEW = "com.samsung.android.knox.intent.extra.KEY_REPORT_TYPE_NEW";
    static final String EXTRA_REPORT_TYPE_NEW_LONG_UP =
        "com.samsung.android.knox.intent.extra.KEY_REPORT_TYPE_NEW_LONG_UP";
    static final String PERMISSION_KNOX_CUSTOM_PROKIOSK =
        "com.samsung.android.knox.permission.KNOX_CUSTOM_PROKIOSK";
    static final String PERMISSION_KNOX_KIOSK_MODE =
        "com.samsung.android.knox.permission.KNOX_KIOSK_MODE";
    static final String EXTRA_HARDWARE_TRIGGER_PRESS_TYPE =
        "hardware_trigger_press_type";
    private static final String LOG_TAG = "SecPalHardwareButtons";
    private static final String PRO_KIOSK_MANAGER_CLASS =
        "com.samsung.android.knox.custom.ProKioskManager";
    private static final String KIOSK_MODE_CLASS = "com.samsung.android.knox.kiosk.KioskMode";
    private static final int KEYCODE_XCOVER_TOP = 1015;
    private static final int KEY_ACTION_DOWN_UP = 3;
    private static final int KEY_ACTION_LONG = 4;
    private static final int REPORT_STATE_ENABLED = 1;
    private static final int REPORT_STATE_DISABLED = 0;

    enum HardKeyPressType {
        SHORT_PRESS,
        LONG_PRESS,
        UNKNOWN,
    }

    private SamsungKnoxHardwareButtonController() {
    }

    static void syncManagedState(Context context, EnterpriseManagedState managedState) {
        if (context == null || managedState == null || !isSamsungDevice() || !isKnoxRuntimeAvailable()) {
            return;
        }

        boolean enableGlobalHardKeyBroadcast = managedState.isDeviceOwner();

        setHardKeyIntentState(enableGlobalHardKeyBroadcast);
        setHardKeyReportState(enableGlobalHardKeyBroadcast);
        allowEmergencyHardwareKeys(context, enableGlobalHardKeyBroadcast);
    }

    static boolean isSamsungHardKeyIntent(Intent intent) {
        return intent != null && ACTION_HARD_KEY_PRESS.equals(intent.getAction());
    }

    static boolean isSamsungHardKeyReportIntent(Intent intent) {
        return intent != null && ACTION_HARD_KEY_REPORT.equals(intent.getAction());
    }

    static int extractKeyCode(Intent intent) {
        if (intent == null) {
            return KeyEvent.KEYCODE_UNKNOWN;
        }

        return intent.getIntExtra(EXTRA_KEY_CODE, KeyEvent.KEYCODE_UNKNOWN);
    }

    static HardKeyPressType resolveHardKeyPressType(Intent intent) {
        if (intent == null) {
            return HardKeyPressType.UNKNOWN;
        }

        return resolveHardKeyPressType(
            getExtraValue(intent.getExtras(), EXTRA_REPORT_TYPE),
            getExtraValue(intent.getExtras(), EXTRA_REPORT_TYPE_NEW),
            getExtraValue(intent.getExtras(), EXTRA_REPORT_TYPE_NEW_LONG_UP)
        );
    }

    static HardKeyPressType resolveHardKeyPressType(
        Object reportType,
        Object reportTypeNew,
        Object reportTypeNewLongUp
    ) {
        if (hasSignalValue(reportTypeNewLongUp)) {
            return HardKeyPressType.LONG_PRESS;
        }

        if (hasSignalValue(reportTypeNew)) {
            return HardKeyPressType.SHORT_PRESS;
        }

        if (isLongReportType(reportType)) {
            return HardKeyPressType.LONG_PRESS;
        }

        if (isShortReportType(reportType)) {
            return HardKeyPressType.SHORT_PRESS;
        }

        return HardKeyPressType.UNKNOWN;
    }

    static boolean isHardwareTriggerLaunch(Intent intent) {
        return intent != null && intent.hasExtra(EXTRA_HARDWARE_TRIGGER_PRESS_TYPE);
    }

    static void launchEmergencySurface(Context context, int keyCode, HardKeyPressType pressType) {
        Intent launchIntent = new Intent(context, MainActivity.class);

        launchIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        launchIntent.putExtra(EXTRA_KEY_CODE, keyCode);
        launchIntent.putExtra(EXTRA_HARDWARE_TRIGGER_PRESS_TYPE, pressType.name());
        context.startActivity(launchIntent);
    }

    private static void setHardKeyIntentState(boolean enabled) {
        try {
            Class<?> managerClass = Class.forName(PRO_KIOSK_MANAGER_CLASS);
            Object manager = managerClass.getMethod("getInstance").invoke(null);

            if (manager == null) {
                return;
            }

            managerClass.getMethod("setHardKeyIntentState", boolean.class).invoke(manager, enabled);
        } catch (ClassNotFoundException exception) {
            Log.d(LOG_TAG, "Samsung Knox ProKiosk runtime unavailable", exception);
        } catch (NoSuchMethodException | IllegalAccessException | InvocationTargetException exception) {
            Log.w(LOG_TAG, "Failed to toggle Samsung Knox hard-key broadcasts", exception);
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Unexpected error while toggling Samsung Knox hard-key broadcasts", exception);
        }
    }

    private static void setHardKeyReportState(boolean enabled) {
        try {
            Object manager = resolveProKioskManager();

            if (manager == null) {
                return;
            }

            int reportState = enabled ? REPORT_STATE_ENABLED : REPORT_STATE_DISABLED;

            for (Integer keyCode : resolveEmergencyHardwareKeys()) {
                setHardKeyReportState(manager, keyCode.intValue(), KEY_ACTION_DOWN_UP, reportState);
                setHardKeyReportState(manager, keyCode.intValue(), KEY_ACTION_LONG, reportState);
            }
        } catch (ClassNotFoundException exception) {
            Log.d(LOG_TAG, "Samsung Knox ProKiosk runtime unavailable", exception);
        } catch (NoSuchFieldException | NoSuchMethodException exception) {
            Log.w(LOG_TAG, "Samsung Knox hard-key report APIs are unavailable", exception);
        } catch (IllegalAccessException | InvocationTargetException exception) {
            Log.w(LOG_TAG, "Failed to toggle Samsung Knox hard-key report broadcasts", exception);
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Unexpected error while toggling Samsung Knox hard-key report broadcasts", exception);
        }
    }

    private static void allowEmergencyHardwareKeys(Context context, boolean enabled) {
        try {
            Class<?> kioskModeClass = Class.forName(KIOSK_MODE_CLASS);
            Object kioskMode = kioskModeClass.getMethod("getInstance", Context.class).invoke(null, context);

            if (kioskMode == null) {
                return;
            }

            kioskModeClass
                .getMethod("allowHardwareKeys", List.class, boolean.class)
                .invoke(kioskMode, resolveEmergencyHardwareKeys(), enabled);
        } catch (ClassNotFoundException exception) {
            Log.d(LOG_TAG, "Samsung Knox kiosk runtime unavailable", exception);
        } catch (NoSuchMethodException | IllegalAccessException | InvocationTargetException exception) {
            Log.w(LOG_TAG, "Failed to update Samsung Knox hardware-key allowlist", exception);
        } catch (RuntimeException exception) {
            Log.w(LOG_TAG, "Unexpected error while updating Samsung Knox hardware-key allowlist", exception);
        }
    }

    private static boolean isSamsungDevice() {
        return "samsung".equalsIgnoreCase(Build.MANUFACTURER);
    }

    private static boolean isKnoxRuntimeAvailable() {
        return isClassAvailable(PRO_KIOSK_MANAGER_CLASS) && isClassAvailable(KIOSK_MODE_CLASS);
    }

    private static boolean isClassAvailable(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (ClassNotFoundException exception) {
            return false;
        }
    }

    private static Object resolveProKioskManager()
        throws ClassNotFoundException, NoSuchMethodException, IllegalAccessException, InvocationTargetException {
        Class<?> managerClass = Class.forName(PRO_KIOSK_MANAGER_CLASS);

        return managerClass.getMethod("getInstance").invoke(null);
    }

    private static void setHardKeyReportState(Object manager, int keyCode, int keyAction, int reportState)
        throws ClassNotFoundException,
            NoSuchFieldException,
            NoSuchMethodException,
            IllegalAccessException,
            InvocationTargetException {
        Class<?> managerClass = Class.forName(PRO_KIOSK_MANAGER_CLASS);

        try {
            Method directMethod = managerClass.getMethod(
                "setHardKeyReportState",
                int.class,
                int.class,
                int.class,
                int.class
            );

            directMethod.invoke(manager, keyCode, keyAction, reportState, reportState);
            return;
        } catch (NoSuchMethodException exception) {
            Field serviceField = managerClass.getDeclaredField("mService");

            serviceField.setAccessible(true);

            Object service = serviceField.get(manager);

            if (service == null) {
                return;
            }

            Method serviceMethod = service.getClass().getMethod(
                "setHardKeyReportState",
                int.class,
                int.class,
                int.class,
                int.class
            );

            serviceMethod.invoke(service, keyCode, keyAction, reportState, reportState);
        }
    }

    private static Object getExtraValue(Bundle extras, String key) {
        if (extras == null || !extras.containsKey(key)) {
            return null;
        }

        return extras.get(key);
    }

    private static boolean hasSignalExtra(Bundle extras, String key) {
        return hasSignalValue(getExtraValue(extras, key));
    }

    private static boolean hasSignalValue(Object value) {

        if (value == null) {
            return false;
        }

        if (value instanceof Boolean) {
            return ((Boolean) value).booleanValue();
        }

        if (value instanceof Number) {
            return ((Number) value).intValue() != 0;
        }

        if (value instanceof CharSequence) {
            return ((CharSequence) value).length() > 0;
        }

        return true;
    }

    private static boolean isLongReportType(Object reportType) {
        if (reportType instanceof Number) {
            return ((Number) reportType).intValue() == KEY_ACTION_LONG;
        }

        if (reportType instanceof CharSequence) {
            String normalizedReportType = reportType.toString().trim().toLowerCase();

            return normalizedReportType.contains("long");
        }

        return false;
    }

    private static boolean isShortReportType(Object reportType) {
        if (reportType instanceof Number) {
            int numericReportType = ((Number) reportType).intValue();

            return numericReportType == KEY_ACTION_DOWN_UP;
        }

        if (reportType instanceof CharSequence) {
            String normalizedReportType = reportType.toString().trim().toLowerCase();

            if (normalizedReportType.contains("long")) {
                return false;
            }

            return normalizedReportType.contains("short")
                || normalizedReportType.contains("down_up")
                || normalizedReportType.contains("up");
        }

        return false;
    }

    private static List<Integer> resolveEmergencyHardwareKeys() {
        ArrayList<Integer> keys = new ArrayList<>();

        keys.add(KeyEvent.KEYCODE_STEM_PRIMARY);

        if (KEYCODE_XCOVER_TOP != KeyEvent.KEYCODE_STEM_PRIMARY) {
            keys.add(KEYCODE_XCOVER_TOP);
        }

        return keys;
    }
}
