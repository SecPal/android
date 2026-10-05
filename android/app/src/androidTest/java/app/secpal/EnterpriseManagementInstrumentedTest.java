/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;

import static org.junit.Assert.*;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class EnterpriseManagementInstrumentedTest {
    @Test public void separateWorkConsumesAuthenticatedOwnerStateWithoutOwningPolicy() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        assertEquals(BuildConfig.APPLICATION_ID, context.getPackageName());
        assertFalse(manager.isDeviceOwnerApp(context.getPackageName()));
        assertFalse(manager.isProfileOwnerApp(context.getPackageName()));
        assertThrows(ClassNotFoundException.class, () -> Class.forName("app.secpal.DpcPolicyEnforcer"));
        assertThrows(ClassNotFoundException.class, () -> Class.forName("app.secpal.SecPalDeviceAdminReceiver"));
        android.content.pm.PackageInfo dpc = context.getPackageManager().getPackageInfo(
            BuildConfig.DPC_APPLICATION_ID, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES);
        assertNotNull(dpc.signingInfo);
        android.content.pm.Signature[] signers = dpc.signingInfo.getApkContentsSigners();
        assertEquals(1, signers.length);
        assertEquals("Installed DPC certificate must match the configured peer pin",
            BuildConfig.DPC_CERT_SHA256, ManagementPackageIdentity.digest(signers[0]));
        assertTrue(ManagementPackageIdentity.matches(context, BuildConfig.DPC_APPLICATION_ID, BuildConfig.DPC_CERT_SHA256));
        try (android.content.ContentProviderClient client = context.getContentResolver()
            .acquireUnstableContentProviderClient(android.net.Uri.parse("content://" + BuildConfig.DPC_APPLICATION_ID + ".management"))) {
            assertNotNull(client);
            android.os.Bundle snapshot = client.call("management_state", null, null);
            assertNotNull(snapshot);
            assertEquals(manager.isDeviceOwnerApp(BuildConfig.DPC_APPLICATION_ID) ? "device_owner" : "profile_owner",
                snapshot.getString("mode"));
        }
        EnterpriseManagedState state = EnterprisePolicyClient.getManagedState(context);
        if (manager.isDeviceOwnerApp(BuildConfig.DPC_APPLICATION_ID)) {
            assertTrue(state.isDeviceOwner());
            assertTrue(state.isKioskActive());
            assertTrue(manager.isLockTaskPermitted(context.getPackageName()));
        } else {
            assertTrue(manager.isProfileOwnerApp(BuildConfig.DPC_APPLICATION_ID));
            assertTrue(state.isProfileOwner());
            assertFalse(state.isKioskActive());
            assertFalse(manager.isLockTaskPermitted(context.getPackageName()));
        }
    }
}
