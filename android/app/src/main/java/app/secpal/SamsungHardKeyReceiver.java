/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SamsungHardKeyReceiver extends BroadcastReceiver {
    static final String ACTION_HARD_KEY_PRESS =
        "com.samsung.android.knox.intent.action.HARD_KEY_PRESS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null || !ACTION_HARD_KEY_PRESS.equals(intent.getAction())) {
            return;
        }

        context.startActivity(
            SamsungHardwareButtonLaunch.createLaunchIntent(
                context,
                SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS
            )
        );
    }
}
