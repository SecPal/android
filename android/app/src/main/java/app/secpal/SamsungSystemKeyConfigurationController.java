/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.util.Log;

final class SamsungSystemKeyConfigurationController {
    private static final String LOG_TAG = "SecPalHardwareButtons";
    private static final String SETTING_ACTIVE_KEY_ON_LOCKSCREEN = "active_key_on_lockscreen";
    private static final String SETTING_DEDICATED_APP_LABEL_XCOVER = "dedicated_app_label_xcover";
    private static final String SETTING_DEDICATED_APP_XCOVER = "dedicated_app_xcover";
    private static final String SETTING_DEDICATED_APP_XCOVER_SWITCH = "dedicated_app_xcover_switch";
    private static final String SETTING_SHORT_PRESS_APP = "short_press_app";
    private static final String SETTING_LONG_PRESS_APP = "long_press_app";
    private static final int SETTING_ENABLED = 1;

    interface SettingWriter {
        void putInt(String key, int value);

        void putString(String key, String value);
    }

    @FunctionalInterface
    private interface WriteOperation {
        void run();
    }

    private SamsungSystemKeyConfigurationController() {
    }

    static void syncManagedState(Context context, EnterpriseManagedState managedState) {
        if (context == null || managedState == null || !managedState.isManaged() || !isSamsungDevice()) {
            return;
        }

        SettingWriter writer = resolveSettingWriter(context, managedState);

        if (writer == null) {
            return;
        }

        int failedWrites = applyManagedState(
            writer,
            context.getPackageName(),
            context.getString(R.string.app_name)
        );

        if (failedWrites == 0) {
            Log.i(LOG_TAG, "Applied Samsung XCover system key mappings for SecPal");
            return;
        }

        Log.w(
            LOG_TAG,
            "Applied Samsung XCover system key mappings with " + failedWrites + " partial failure(s)"
        );
    }

    static int applyManagedState(SettingWriter writer, String packageName, String appName) {
        int failedWrites = 0;

        failedWrites += applyWrite(
            SETTING_ACTIVE_KEY_ON_LOCKSCREEN,
            () -> writer.putInt(SETTING_ACTIVE_KEY_ON_LOCKSCREEN, SETTING_ENABLED)
        );
        failedWrites += applyWrite(
            SETTING_DEDICATED_APP_LABEL_XCOVER,
            () -> writer.putString(SETTING_DEDICATED_APP_LABEL_XCOVER, appName)
        );
        failedWrites += applyWrite(
            SETTING_DEDICATED_APP_XCOVER,
            () -> writer.putString(
                SETTING_DEDICATED_APP_XCOVER,
                buildComponent(packageName, HardwareButtonLaunchRouter.PROFILE_HARDWARE_TRIGGER_ACTIVITY)
            )
        );
        failedWrites += applyWrite(
            SETTING_DEDICATED_APP_XCOVER_SWITCH,
            () -> writer.putInt(SETTING_DEDICATED_APP_XCOVER_SWITCH, SETTING_ENABLED)
        );
        failedWrites += applyWrite(
            SETTING_SHORT_PRESS_APP,
            () -> writer.putString(
                SETTING_SHORT_PRESS_APP,
                buildComponent(packageName, HardwareButtonLaunchRouter.PROFILE_HARDWARE_TRIGGER_ACTIVITY)
            )
        );
        failedWrites += applyWrite(
            SETTING_LONG_PRESS_APP,
            () -> writer.putString(
                SETTING_LONG_PRESS_APP,
                buildComponent(packageName, HardwareButtonLaunchRouter.ABOUT_HARDWARE_TRIGGER_ACTIVITY)
            )
        );

        return failedWrites;
    }

    private static boolean isSamsungDevice() {
        return "samsung".equalsIgnoreCase(Build.MANUFACTURER);
    }

    private static SettingWriter resolveSettingWriter(
        Context context,
        EnterpriseManagedState managedState
    ) {
        if (!managedState.isDeviceOwner()) {
            Log.i(LOG_TAG, "Skipping Samsung system key sync because device owner is required");
            return null;
        }

        DevicePolicyManager devicePolicyManager = context.getSystemService(DevicePolicyManager.class);

        if (devicePolicyManager == null) {
            Log.w(LOG_TAG, "Skipping Samsung system key sync because DevicePolicyManager is unavailable");
            return null;
        }

        return new DevicePolicyManagerSettingWriter(
            devicePolicyManager,
            new ComponentName(context, SecPalDeviceAdminReceiver.class)
        );
    }

    private static int applyWrite(String settingName, WriteOperation operation) {
        try {
            operation.run();
            return 0;
        } catch (RuntimeException exception) {
            return 1;
        }
    }

    private static String buildComponent(String packageName, String className) {
        return packageName + "/" + className;
    }

    private static final class DevicePolicyManagerSettingWriter implements SettingWriter {
        private final DevicePolicyManager devicePolicyManager;
        private final ComponentName adminComponent;

        private DevicePolicyManagerSettingWriter(
            DevicePolicyManager devicePolicyManager,
            ComponentName adminComponent
        ) {
            this.devicePolicyManager = devicePolicyManager;
            this.adminComponent = adminComponent;
        }

        @Override
        public void putInt(String key, int value) {
            putString(key, Integer.toString(value));
        }

        @Override
        public void putString(String key, String value) {
            devicePolicyManager.setSecureSetting(adminComponent, key, value);
        }
    }
}
