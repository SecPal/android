/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

public class DebugEnterprisePolicyReceiver extends BroadcastReceiver {
    static final String ACTION_SET_POLICY = "app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY";
    static final String ACTION_CLEAR_POLICY = "app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();

        if (ACTION_CLEAR_POLICY.equals(action)) {
            EnterprisePolicyController.clearDebugPolicy(context);
            EnterprisePolicyController.syncPolicy(context);
            return;
        }

        if (!ACTION_SET_POLICY.equals(action)) {
            return;
        }

        Bundle extras = intent.getExtras();

        EnterprisePolicyController.persistDebugPolicy(context, extras == null ? Bundle.EMPTY : extras);
        EnterprisePolicyController.syncPolicy(context);
    }
}
