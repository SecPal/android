/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.function.BiPredicate;

public class SamsungHardKeyReceiver extends BroadcastReceiver {
    static final String ACTION_HARD_KEY_PRESS =
        "com.samsung.android.knox.intent.action.HARD_KEY_PRESS";
    static final String ACTION_HARD_KEY_REPORT =
        "com.samsung.android.knox.intent.action.HARD_KEY_REPORT";
    static final String KNOX_CUSTOM_SETTING_PERMISSION =
        "com.samsung.android.knox.permission.KNOX_CUSTOM_SETTING";
    static final String KNOX_CUSTOM_SYSTEM_PERMISSION =
        "com.samsung.android.knox.permission.KNOX_CUSTOM_SYSTEM";
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

        // This receiver is exported, so any app can target it. Reject unknown
        // actions before sender-permission and DevicePolicyManager lookups.
        String action = intent.getAction();
        if (!ACTION_HARD_KEY_PRESS.equals(action) && !ACTION_HARD_KEY_REPORT.equals(action)) {
            return;
        }

        PackageManager packageManager = context.getPackageManager();

        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            || !isTrustedKnoxSender(
                Build.VERSION.SDK_INT,
                getSentFromUid(),
                (permission, uid) ->
                    uidHasPermission(packageManager, permission, uid)
            )
        ) {
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

    static boolean isTrustedKnoxSender(
        int sdkInt,
        int senderUid,
        BiPredicate<String, Integer> permissionChecker
    ) {
        if (
            sdkInt < Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            || senderUid < 0
            || permissionChecker == null
        ) {
            return false;
        }

        return permissionChecker.test(KNOX_CUSTOM_SETTING_PERMISSION, senderUid)
            || permissionChecker.test(KNOX_CUSTOM_SYSTEM_PERMISSION, senderUid);
    }

    static boolean uidHasPermission(
        PackageManager packageManager,
        String permission,
        int uid
    ) {
        if (packageManager == null || permission == null || uid < 0) {
            return false;
        }

        String[] packageNames = packageManager.getPackagesForUid(uid);

        return senderPackagesHoldPermission(
            packageNames,
            permission,
            (candidatePermission, packageName) ->
                packageManager.checkPermission(candidatePermission, packageName)
                    == PackageManager.PERMISSION_GRANTED
        );
    }

    static boolean senderPackagesHoldPermission(
        String[] packageNames,
        String permission,
        BiPredicate<String, String> permissionChecker
    ) {
        if (packageNames == null || permission == null || permissionChecker == null) {
            return false;
        }

        for (String packageName : packageNames) {
            if (packageName != null && permissionChecker.test(permission, packageName)) {
                return true;
            }
        }

        return false;
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
