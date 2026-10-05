/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

public class SecPalDeviceAdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context context, Intent intent) {
        DpcPolicyEnforcer.onAdminEnabled(context, intent, getWho(context));
    }

    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        return DpcPolicyEnforcer.onDisableRequested(context);
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        DpcPolicyEnforcer.clearManagedState(context);
    }

    @Override
    public void onProfileProvisioningComplete(Context context, Intent intent) {
        DpcPolicyEnforcer.onProfileProvisioningComplete(context, intent, getWho(context));
    }
}
