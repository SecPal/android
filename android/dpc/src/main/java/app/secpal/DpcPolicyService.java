/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;

/** Android keeps the owner process bound so managed-configuration listeners remain active. */
public final class DpcPolicyService extends Service {
    @Override public void onCreate() {
        super.onCreate();
        DpcPolicyEnforcer.syncPolicy(this);
    }

    // The platform binding exposes no management commands or mutable caller state.
    @Override public IBinder onBind(Intent intent) { return new Binder(); }
}
