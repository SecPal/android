/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SamsungHardKeyReceiver extends BroadcastReceiver {
    static final String ACTION_HARD_KEY_PRESS =
        "com.samsung.android.knox.intent.action.HARD_KEY_PRESS";
    static final String ACTION_HARD_KEY_REPORT =
        "com.samsung.android.knox.intent.action.HARD_KEY_REPORT";
    static final String EXTRA_KEY_CODE =
        "com.samsung.android.knox.intent.extra.KEY_CODE";
    static final String EXTRA_REPORT_TYPE =
        "com.samsung.android.knox.intent.extra.KEY_REPORT_TYPE";
    static final String EXTRA_REPORT_TYPE_NEW =
        "com.samsung.android.knox.intent.extra.KEY_REPORT_TYPE_NEW";
    static final String EXTRA_REPORT_TYPE_NEW_LONG_UP =
        "com.samsung.android.knox.intent.extra.EXTRA_REPORT_TYPE_NEW_LONG_UP";
    static final int SAMSUNG_KEY_CODE_XCOVER = 1015;
    static final int SAMSUNG_KEY_CODE_SOS = 1079;
    static final int REPORT_TYPE_DOWN = 1;
    static final int REPORT_TYPE_UP = 2;
    static final int REPORT_TYPE_DOWN_UP = 3;
    static final int REPORT_TYPE_LONG = 4;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        // Short-circuit before any binder call: this receiver is exported, so
        // any app can broadcast to it. Reject unknown actions before touching
        // DevicePolicyManager to reduce unnecessary IPC overhead.
        String action = intent.getAction();
        if (!ACTION_HARD_KEY_PRESS.equals(action) && !ACTION_HARD_KEY_REPORT.equals(action)) {
            return;
        }

        String packageName = context.getPackageName();
        DevicePolicyManager dpm = context.getSystemService(DevicePolicyManager.class);

        String hardwareAction = resolveManagedHardwareAction(
            intent,
            packageName,
            dpm != null && dpm.isDeviceOwnerApp(packageName),
            dpm != null && dpm.isProfileOwnerApp(packageName)
        );

        if (hardwareAction == null) {
            return;
        }

        context.startActivity(
            SamsungHardwareButtonLaunch.createLaunchIntent(
                context,
                hardwareAction,
                SamsungHardwareButtonLaunch.resolveLaunchKeyCode(intent)
            )
        );
    }

    static String resolveManagedHardwareAction(
        Intent intent,
        String packageName,
        boolean deviceOwner,
        boolean profileOwner
    ) {
        if (intent == null || packageName == null || !isManagedOwner(deviceOwner, profileOwner)) {
            return null;
        }

        return resolveHardwareAction(intent, packageName);
    }

    private static String resolveHardwareAction(Intent intent, String packageName) {
        if (ACTION_HARD_KEY_PRESS.equals(intent.getAction())) {
            return SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
        }

        if (!ACTION_HARD_KEY_REPORT.equals(intent.getAction())) {
            return null;
        }

        return SamsungHardwareButtonLaunch.resolveLaunchAction(intent, packageName);
    }

    private static boolean isManagedOwner(boolean deviceOwner, boolean profileOwner) {
        return !EnterpriseManagedState.MODE_NONE.equals(
            EnterprisePolicyController.resolveManagedMode(deviceOwner, profileOwner)
        );
    }
}
