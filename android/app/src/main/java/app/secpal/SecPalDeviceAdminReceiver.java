/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.PersistableBundle;

public class SecPalDeviceAdminReceiver extends DeviceAdminReceiver {

    @Override
    public void onEnabled(Context context, Intent intent) {
        PersistableBundle adminExtras = EnterprisePolicyController.extractProvisioningAdminExtras(intent);

        EnterprisePolicyController.persistProvisioningConfig(context, adminExtras);
        EnterpriseManagedState managedState = EnterprisePolicyController.syncPolicy(context);

        SystemNavigationController.applyProvisioningGestureNavigationIfRequested(
            context,
            getWho(context),
            managedState
        );
    }

    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        EnterpriseManagedState managedState = EnterprisePolicyController.syncPolicy(context);

        if (!managedState.isManaged()) {
            return null;
        }

        return context.getString(R.string.enterprise_disable_warning);
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        EnterprisePolicyController.clearManagedState(context);
    }

    @Override
    public void onProfileProvisioningComplete(Context context, Intent intent) {
        PersistableBundle adminExtras = EnterprisePolicyController.extractProvisioningAdminExtras(intent);

        EnterprisePolicyController.persistProvisioningConfig(context, adminExtras);
        EnterpriseManagedState managedState = EnterprisePolicyController.syncPolicy(context);

        SystemNavigationController.applyProvisioningGestureNavigationIfRequested(
            context,
            getWho(context),
            managedState
        );

        if (managedState.isProfileOwner()) {
            DevicePolicyManager manager = getManager(context);
            ComponentName admin = getWho(context);

            manager.setProfileName(admin, context.getString(R.string.enterprise_profile_name));
            manager.setProfileEnabled(admin);
        }

        Intent launchIntent = new Intent(context, MainActivity.class);

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launchIntent);
    }
}
