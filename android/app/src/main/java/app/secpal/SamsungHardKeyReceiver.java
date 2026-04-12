/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.view.KeyEvent;

public class SamsungHardKeyReceiver extends BroadcastReceiver {
    private static final String LOG_TAG = "SecPalHardwareButtons";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (SamsungKnoxHardwareButtonController.isSamsungHardKeyReportIntent(intent)) {
            handleReportIntent(context, intent);
            return;
        }

        if (!SamsungKnoxHardwareButtonController.isSamsungHardKeyIntent(intent)) {
            return;
        }

        int keyCode = SamsungKnoxHardwareButtonController.extractKeyCode(intent);

        if (keyCode == KeyEvent.KEYCODE_UNKNOWN) {
            return;
        }

        Log.i(LOG_TAG, "Received Samsung hard-key press fallback for keyCode=" + keyCode);
        SecPalEnterprisePlugin.emitSamsungKnoxHardwareButtonEvent(keyCode);
        SamsungKnoxHardwareButtonController.launchEmergencySurface(
            context,
            keyCode,
            SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN
        );
    }

    private void handleReportIntent(Context context, Intent intent) {
        int keyCode = SamsungKnoxHardwareButtonController.extractKeyCode(intent);

        if (keyCode == KeyEvent.KEYCODE_UNKNOWN) {
            return;
        }

        SamsungKnoxHardwareButtonController.HardKeyPressType pressType =
            SamsungKnoxHardwareButtonController.resolveHardKeyPressType(intent);

        if (pressType == SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN) {
            return;
        }

        Log.i(LOG_TAG, "Received Samsung hard-key report=" + pressType + " for keyCode=" + keyCode);

        if (pressType == SamsungKnoxHardwareButtonController.HardKeyPressType.LONG_PRESS) {
            SecPalEnterprisePlugin.emitSamsungKnoxHardwareButtonLongPressEvent(keyCode);
        } else {
            SecPalEnterprisePlugin.emitSamsungKnoxHardwareButtonShortPressEvent(keyCode);
        }

        SamsungKnoxHardwareButtonController.launchEmergencySurface(context, keyCode, pressType);
    }
}
