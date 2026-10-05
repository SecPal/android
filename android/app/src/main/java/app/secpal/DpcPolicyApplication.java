/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.app.Application;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;

import androidx.core.content.ContextCompat;

/** Current single-app management wiring; Work consumers never invoke enforcement. */
public final class DpcPolicyApplication extends Application implements Application.ActivityLifecycleCallbacks {
    @Override
    public void onCreate() {
        super.onCreate();
        registerActivityLifecycleCallbacks(this);
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

    @Override
    public void onActivityResumed(Activity activity) {
        // Runs during super.onResume(), before Work reads state or enters authorized lock task.
        DpcPolicyEnforcer.syncPolicy(activity);
    }

    @Override
    public void onActivityCreated(Activity activity, Bundle savedInstanceState) {
        DpcPolicyEnforcer.syncPolicy(activity);
    }

    @Override
    public void onActivityStarted(Activity activity) {
    }

    @Override
    public void onActivityPaused(Activity activity) {
    }

    @Override
    public void onActivityStopped(Activity activity) {
    }

    @Override
    public void onActivitySaveInstanceState(Activity activity, Bundle outState) {
    }

    @Override
    public void onActivityDestroyed(Activity activity) {
    }
}
