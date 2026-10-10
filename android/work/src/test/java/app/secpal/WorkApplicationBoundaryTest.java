/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.ProviderInfo;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 24)
public class WorkApplicationBoundaryTest {
    @Test public void separatePackageAndPrivateStorageHaveNoUserRuntimeEntry() {
        Context context = RuntimeEnvironment.getApplication();
        assertEquals("io.secpal", context.getPackageName());
        assertEquals(context.getDataDir(), context.getFilesDir().getParentFile());
        Intent launch = new Intent(context, WorkActivity.class)
            .putExtra("APPROVED_WORK", true).putExtra("logged_in", true);
        try (var controller = Robolectric.buildActivity(WorkActivity.class, launch).setup()) {
            WorkActivity activity = controller.get();
            assertBlocked(activity);
            controller.pause().stop().restart().start().resume();
            assertBlocked(activity);
            assertNull(shadowOf(activity).getNextStartedActivity());
        }
    }

    @Test public void authenticatedDpcOwnershipIsManagementOnlyAndCannotApproveWork() {
        Context context = RuntimeEnvironment.getApplication();
        String dpc = "io.secpal.dpc";
        Signature signature = new Signature(new byte[] {1, 2, 3});
        PackageInfo info = new PackageInfo();
        info.packageName = dpc;
        info.applicationInfo = new ApplicationInfo();
        info.applicationInfo.packageName = dpc;
        info.applicationInfo.uid = 12345;
        info.signatures = new Signature[] {signature};
        shadowOf(context.getPackageManager()).installPackage(info);
        ProviderInfo component = new ProviderInfo();
        component.authority = dpc + ".management";
        component.packageName = dpc;
        component.name = StateProvider.class.getName();
        component.applicationInfo = info.applicationInfo;
        component.exported = true;
        shadowOf(context.getPackageManager()).addOrUpdateProvider(component);
        StateProvider provider = new StateProvider();
        provider.attachInfo(context, component);
        ShadowContentResolver.registerProviderInternal(component.authority, provider);
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        assertTrue(shadowOf(manager).setDeviceOwner(new ComponentName(dpc, "admin")));

        // Missing/substituted evidence cannot invoke the provider.
        assertFalse(EnterprisePolicyState.read(context).isAvailable());
        assertFalse(EnterprisePolicyState.read(context, dpc, "0".repeat(64)).isAvailable());
        assertEquals(0, provider.calls);
        assertTrue(EnterprisePolicyState.read(context, dpc,
            ManagementPackageIdentity.digest(signature)).isDeviceOwner());
        assertEquals(1, provider.calls);
        assertFalse(manager.isDeviceOwnerApp(context.getPackageName()));
        assertFalse(manager.isLockTaskPermitted(context.getPackageName()));
        try (var controller = Robolectric.buildActivity(WorkActivity.class).setup()) {
            assertBlocked(controller.get());
            assertNull(shadowOf(controller.get()).getNextStartedActivity());
        }
    }

    private static void assertBlocked(Activity activity) {
        TextView text = activity.findViewById(android.R.id.message);
        assertEquals(activity.getString(R.string.work_endpoint_authority_unavailable), text.getText().toString());
    }

    public static class StateProvider extends ContentProvider {
        int calls;
        @Override public boolean onCreate() { return true; }
        @Override public Bundle call(String method, String arg, Bundle extras) {
            assertEquals(ManagementSnapshot.METHOD, method);
            assertNull(arg);
            assertNull(extras);
            calls++;
            return ManagementSnapshot.encode(getContext(), new EnterpriseManagedState(
                EnterpriseManagedState.MODE_DEVICE_OWNER, EnterprisePolicyConfig.disabled()));
        }
        @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { throw new UnsupportedOperationException(); }
        @Override public String getType(Uri u) { throw new UnsupportedOperationException(); }
        @Override public Uri insert(Uri u, ContentValues v) { throw new UnsupportedOperationException(); }
        @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException(); }
        @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
    }
}
