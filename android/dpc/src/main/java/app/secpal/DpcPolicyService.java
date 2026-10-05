/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.admin.DeviceAdminService;

/** Android keeps the owner process bound so managed-configuration listeners remain active. */
// The versioned manifest resource disables this class before API 26.
@android.annotation.TargetApi(26)
public final class DpcPolicyService extends DeviceAdminService {
    @Override public void onCreate() {
        super.onCreate();
        DpcPolicyEnforcer.syncPolicy(this);
    }

}
