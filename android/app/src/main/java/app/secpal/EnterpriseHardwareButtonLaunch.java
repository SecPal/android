/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;

final class EnterpriseHardwareButtonLaunch {
    private EnterpriseHardwareButtonLaunch() {
    }

    static boolean isSupportedLaunchKeyCode(int keyCode) {
        return SamsungHardwareButtonLaunch.isSupportedLaunchKeyCode(keyCode);
    }

    static String resolveLaunchAction(KeyEvent event) {
        return SamsungHardwareButtonLaunch.resolveLaunchAction(event);
    }

    static Intent createLaunchIntent(Context context, String hardwareAction, int keyCode) {
        return SamsungHardwareButtonLaunch.createLaunchIntent(context, hardwareAction, keyCode);
    }
}
