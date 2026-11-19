/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/** API 24–25 owner listener lifetime, before Android provides DeviceAdminService. */
public final class DpcLegacyPolicyService extends Service {
    static void updateLifetime(Context context, EnterpriseManagedState state) {
        if (Build.VERSION.SDK_INT >= 26) return;
        Intent intent = new Intent(context, DpcLegacyPolicyService.class);
        if (!state.isManaged()) context.stopService(intent);
        else if (!(context instanceof DpcLegacyPolicyService)) context.startService(intent);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!DpcPolicyEnforcer.syncPolicy(this).isManaged()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
