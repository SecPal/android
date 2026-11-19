/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Application;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import androidx.core.content.ContextCompat;

/** DPC-only management lifecycle; no Work activities are registered or invoked. */
public final class DpcPolicyApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        DpcPolicyEnforcer.syncPolicy(this);
        // All registered actions are protected system broadcasts; ordinary apps cannot send them.
        BroadcastReceiver policyChanges = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                DpcPolicyEnforcer.syncPolicy(context);
            }
        };
        ContextCompat.registerReceiver(
            this,
            policyChanges,
            new IntentFilter(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED),
            ContextCompat.RECEIVER_EXPORTED
        );
        IntentFilter packages = new IntentFilter();
        packages.addAction(Intent.ACTION_PACKAGE_ADDED);
        packages.addAction(Intent.ACTION_PACKAGE_REMOVED);
        packages.addDataScheme("package");
        ContextCompat.registerReceiver(this, policyChanges, packages, ContextCompat.RECEIVER_EXPORTED);
    }

}
