/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import androidx.annotation.Nullable;

import java.util.List;

class DedicatedDeviceHomeDependencies {
    EnterpriseManagedState syncPolicy(DedicatedDeviceHomeActivity activity) {
        return EnterprisePolicyController.syncPolicy(activity);
    }

    void maybeEnterLockTask(DedicatedDeviceHomeActivity activity) {
        EnterprisePolicyController.maybeEnterLockTask(activity);
    }

    List<EnterprisePolicyController.AllowedLaunchApp> resolveAllowedLaunchApps(
        DedicatedDeviceHomeActivity activity
    ) {
        return EnterprisePolicyController.resolveAllowedLaunchApps(activity);
    }

    void launchAllowedApp(DedicatedDeviceHomeActivity activity, String packageName) {
        EnterprisePolicyController.launchAllowedApp(activity, packageName);
    }

    void launchPhone(DedicatedDeviceHomeActivity activity) {
        EnterprisePolicyController.launchPhone(activity);
    }

    void launchSms(DedicatedDeviceHomeActivity activity) {
        EnterprisePolicyController.launchSms(activity);
    }

    @Nullable
    String resolveDialerPackage(EnterpriseManagedState managedState, DedicatedDeviceHomeActivity activity) {
        return managedState.resolveDialerPackage(activity);
    }

    @Nullable
    String resolveSmsPackage(EnterpriseManagedState managedState, DedicatedDeviceHomeActivity activity) {
        return managedState.resolveSmsPackage(activity);
    }
}
