/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import androidx.annotation.Nullable;

import java.util.List;

class DedicatedDeviceHomeDependencies {
    EnterpriseManagedState getManagedState(DedicatedDeviceHomeActivity activity) {
        return EnterprisePolicyClient.getManagedState(activity);
    }

    void maybeEnterLockTask(DedicatedDeviceHomeActivity activity) {
        EnterprisePolicyClient.maybeEnterLockTask(activity);
    }

    List<EnterprisePolicyClient.AllowedLaunchApp> resolveAllowedLaunchApps(
        DedicatedDeviceHomeActivity activity
    ) {
        return EnterprisePolicyClient.resolveAllowedLaunchApps(activity);
    }

    void launchAllowedApp(DedicatedDeviceHomeActivity activity, String packageName) {
        EnterprisePolicyClient.launchAllowedApp(activity, packageName);
    }

    void launchPhone(DedicatedDeviceHomeActivity activity) {
        EnterprisePolicyClient.launchPhone(activity);
    }

    void launchSms(DedicatedDeviceHomeActivity activity) {
        EnterprisePolicyClient.launchSms(activity);
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
