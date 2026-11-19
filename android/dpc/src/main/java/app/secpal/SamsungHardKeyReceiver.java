/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import io.secpal.dpc.BuildConfig;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SamsungHardKeyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        // The manifest restricts this exported receiver to Knox's
        // platform-signature-protected managed-key sender permission.
        String action = intent.getAction();
        if (!SamsungHardKeyContract.ACTION_HARD_KEY_PRESS.equals(action) && !SamsungHardKeyContract.ACTION_HARD_KEY_REPORT.equals(action)) {
            return;
        }

        String packageName = context.getPackageName();
        String managedMode = DpcPolicyState.resolveManagedMode(context);

        String hardwareAction = resolveManagedHardwareAction(
            intent,
            packageName,
            EnterpriseManagedState.MODE_DEVICE_OWNER.equals(managedMode),
            EnterpriseManagedState.MODE_PROFILE_OWNER.equals(managedMode)
        );

        if (hardwareAction == null) {
            return;
        }

        if (!ManagementPackageIdentity.matches(context, BuildConfig.WORK_APPLICATION_ID, BuildConfig.WORK_CERT_SHA256)) return;
        Intent launchIntent = SamsungHardwareButtonLaunch.createLaunchIntent(
            context, hardwareAction, SamsungHardwareButtonLaunch.resolveLaunchKeyCode(intent)
        );
        launchIntent.setComponent(new android.content.ComponentName(BuildConfig.WORK_APPLICATION_ID, "app.secpal.MainActivity"));
        context.startActivity(launchIntent);
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
        if (SamsungHardKeyContract.ACTION_HARD_KEY_PRESS.equals(intent.getAction())) {
            return SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS;
        }

        if (!SamsungHardKeyContract.ACTION_HARD_KEY_REPORT.equals(intent.getAction())) {
            return null;
        }

        return SamsungHardwareButtonLaunch.resolveLaunchAction(intent, packageName);
    }

    private static boolean isManagedOwner(boolean deviceOwner, boolean profileOwner) {
        return !EnterpriseManagedState.MODE_NONE.equals(
            DpcPolicyState.resolveManagedMode(deviceOwner, profileOwner)
        );
    }
}
