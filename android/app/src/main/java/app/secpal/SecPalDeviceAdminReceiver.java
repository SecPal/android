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
import android.util.Log;

public class SecPalDeviceAdminReceiver extends DeviceAdminReceiver {
    private static final String LOG_TAG = "SecPalDeviceAdmin";

    @Override
    public void onEnabled(Context context, Intent intent) {
        PersistableBundle adminExtras = EnterprisePolicyController.extractProvisioningAdminExtras(intent);

        persistBootstrapExtras(context, adminExtras);
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

        persistBootstrapExtras(context, adminExtras);
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

    private void persistBootstrapExtras(Context context, PersistableBundle adminExtras) {
        ProvisioningBootstrapStore bootstrapStore = ProvisioningBootstrapStore.fromContext(context);

        try {
            bootstrapStore.persistProvisioningExtras(adminExtras);
        } catch (TokenStorageException | RuntimeException exception) {
            Log.w(LOG_TAG, "Failed to persist bootstrap provisioning extras", exception);
            bootstrapStore.markExchangeFailure(
                ProvisioningBootstrapCoordinator.TOKEN_STORAGE_ERROR_CODE,
                true
            );
        }
    }
}
