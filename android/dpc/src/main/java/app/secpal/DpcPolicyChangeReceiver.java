/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android-protected management wakeups continue enforcement after process death. */
public final class DpcPolicyChangeReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent != null && (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())
            || "android.app.action.DEVICE_OWNER_CHANGED".equals(intent.getAction())
            || "android.app.action.PROFILE_OWNER_CHANGED".equals(intent.getAction())
            || Intent.ACTION_PACKAGE_ADDED.equals(intent.getAction())
            || Intent.ACTION_PACKAGE_REMOVED.equals(intent.getAction()))) {
            DpcPolicyEnforcer.syncPolicy(context);
        }
    }
}
