/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.admin.DevicePolicyManager;
import android.content.ContentProviderClient;
import android.content.Context;
import android.content.pm.ProviderInfo;
import android.net.Uri;
import android.os.Bundle;

/** Work consumes fresh authenticated management snapshots and never derives owner policy locally. */
final class EnterprisePolicyState {
    // Retained only to erase legacy Work-local management preferences during bootstrap cleanup.
    static final String ENTERPRISE_PREFS = "secpal_enterprise_policy";
    private EnterprisePolicyState() {}

    static boolean isLockTaskPermitted(Context context) {
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        return manager != null && manager.isLockTaskPermitted(context.getPackageName());
    }

    static EnterpriseManagedState read(Context context) {
        return read(context, BuildConfig.DPC_APPLICATION_ID, BuildConfig.DPC_CERT_SHA256);
    }

    static EnterpriseManagedState read(Context context, String dpcPackage, String dpcCertificate) {
        try {
            String authority = dpcPackage + ".management";
            ProviderInfo provider = context.getPackageManager().resolveContentProvider(authority, 0);
            if (provider == null || !dpcPackage.equals(provider.packageName)
                || !ManagementPackageIdentity.matches(context, provider.packageName, dpcCertificate)
                || ManagementPackageIdentity.matches(context, context.getPackageName(), dpcCertificate)) {
                return ManagementSnapshot.unavailable();
            }
            String before = resolveManagedMode(context, dpcPackage);
            try (ContentProviderClient client = context.getContentResolver()
                .acquireUnstableContentProviderClient(Uri.parse("content://" + authority))) {
                if (client == null) return ManagementSnapshot.unavailable();
                Bundle result = client.call(ManagementSnapshot.METHOD, null, null);
                if (!before.equals(resolveManagedMode(context, dpcPackage))) return ManagementSnapshot.unavailable();
                EnterpriseManagedState state = ManagementSnapshot.decode(result, before);
                if (state.isAvailable()) SystemNavigationSettings.observeProvisioningGestureNavigationRequest(
                    context, state.isDeviceOwner() && result != null && result.getBoolean("gesture_pending", false)
                );
                return state;
            }
        } catch (android.os.RemoteException | RuntimeException exception) {
            // No persisted snapshot or Work-local managed preference is a fallback.
            return ManagementSnapshot.unavailable();
        }
    }

    static String resolveManagedMode(Context context) {
        return resolveManagedMode(context, BuildConfig.DPC_APPLICATION_ID);
    }

    private static String resolveManagedMode(Context context, String dpcPackage) {
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        return manager == null ? EnterpriseManagedState.MODE_NONE : resolveManagedMode(
            manager.isDeviceOwnerApp(dpcPackage),
            manager.isProfileOwnerApp(dpcPackage)
        );
    }

    static String resolveManagedMode(boolean deviceOwner, boolean profileOwner) {
        return EnterpriseManagedState.resolveManagedMode(deviceOwner, profileOwner);
    }
}
