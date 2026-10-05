/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.app.admin.DevicePolicyManager;
import android.content.*;
import android.content.pm.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 24)
public class EnterpriseManagementBoundaryTest {
    private static final String DPC = "io.secpal.dpc";
    private Context context;
    private DevicePolicyManager manager;
    private Signature signature;
    private StateProvider provider;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getSystemService(DevicePolicyManager.class);
        signature = new Signature(new byte[] {1, 2, 3});
        PackageInfo info = new PackageInfo();
        info.packageName = DPC;
        info.applicationInfo = new ApplicationInfo();
        info.applicationInfo.packageName = DPC;
        info.applicationInfo.uid = 12345;
        info.signatures = new Signature[] {signature};
        shadowOf(context.getPackageManager()).installPackage(info);
        ProviderInfo component = new ProviderInfo();
        component.authority = DPC + ".management";
        component.packageName = DPC;
        component.name = "app.secpal.DpcManagementProvider";
        component.applicationInfo = info.applicationInfo;
        component.exported = true;
        shadowOf(context.getPackageManager()).addOrUpdateProvider(component);
        provider = new StateProvider();
        provider.attachInfo(context, component);
        ShadowContentResolver.registerProviderInternal(component.authority, provider);
        provider.state = ManagementSnapshot.encode(context, new EnterpriseManagedState(
            EnterpriseManagedState.MODE_DEVICE_OWNER,
            new EnterprisePolicyConfig(true, true, true, false, false, java.util.Collections.emptySet())
        ));
    }

    private EnterpriseManagedState read() {
        return EnterprisePolicyState.read(context, DPC, ManagementPackageIdentity.digest(signature));
    }

    @Test public void authenticDeviceOwnerStateIsReadWithoutGrantingWorkLockTask() {
        assertTrue(shadowOf(manager).setDeviceOwner(new ComponentName(DPC, "app.secpal.SecPalDeviceAdminReceiver")));
        EnterpriseManagedState state = read();
        assertTrue(state.isDeviceOwner());
        assertTrue(state.isKioskActive());
        assertEquals(1, provider.calls);
        assertFalse(manager.isLockTaskPermitted(context.getPackageName()));
        assertFalse(manager.isDeviceOwnerApp(context.getPackageName()));
    }

    @Test public void absentPinsSubstitutedSignersAndLegacyWorkOwnershipFailClosed() {
        assertTrue(shadowOf(manager).setDeviceOwner(new ComponentName(context.getPackageName(), "old.Admin")));
        context.getSharedPreferences(EnterprisePolicyState.ENTERPRISE_PREFS, 0).edit()
            .putString("managed_mode", "device_owner").putBoolean("kiosk_mode_enabled", true).commit();
        assertFalse(read().isManaged());
        assertFalse(EnterprisePolicyState.read(context).isManaged());
        assertFalse(EnterprisePolicyState.read(context, DPC, ManagementPackageIdentity.digest(new Signature(new byte[] {9}))).isManaged());
        assertEquals(0, provider.calls);
    }

    @Test public void wrongCertificateNeverInvokesEvenARealOwnerProvider() {
        shadowOf(manager).setDeviceOwner(new ComponentName(DPC, "admin"));
        assertFalse(EnterprisePolicyState.read(context, DPC, "0".repeat(64)).isManaged());
        assertEquals(0, provider.calls);
    }

    @Test public void staleOwnerAndUnavailableProviderNeverReusePriorState() {
        shadowOf(manager).setDeviceOwner(new ComponentName(DPC, "admin"));
        assertTrue(read().isKioskActive());
        provider.beforeReply = () -> shadowOf(manager).setDeviceOwner(new ComponentName("other.owner", "admin"));
        assertFalse(read().isManaged());
        assertFalse(read().isKioskActive());
        assertEquals(2, provider.calls);
    }

    @Test public void profileOwnerCannotSupplyDeviceOwnerKioskCapabilities() {
        shadowOf(manager).setProfileOwner(new ComponentName(DPC, "admin"));
        assertFalse(read().isManaged());
        provider.state = ManagementSnapshot.encode(context, new EnterpriseManagedState(
            EnterpriseManagedState.MODE_PROFILE_OWNER, EnterprisePolicyConfig.disabled()));
        assertTrue(read().isProfileOwner());
        assertFalse(read().isLockTaskEnabled());
        provider.state.putBoolean("kiosk", true);
        assertFalse(read().isManaged());
    }

    @Test public void unknownProtocolExtraAuthorityAndProviderFailuresFailClosed() {
        shadowOf(manager).setDeviceOwner(new ComponentName(DPC, "admin"));
        provider.state.putInt("version", 2);
        assertFalse(read().isManaged());
        provider.state.putInt("version", 1);
        provider.state.putBoolean("business_authorized", true);
        assertFalse(read().isManaged());
        provider.state.remove("business_authorized");
        provider.beforeReply = () -> { throw new SecurityException("denied"); };
        assertFalse(read().isManaged());
    }

    @Test public void WorkCanOnlyEnterLockTaskAfterAndroidGrantsEligibility() {
        try (var controller = org.robolectric.Robolectric.buildActivity(LockTaskActivity.class).setup()) {
            LockTaskActivity activity = controller.get();
            EnterpriseManagedState kiosk = ManagementSnapshot.decode(provider.state, "device_owner");
            EnterprisePolicyClient.maybeEnterLockTask(activity, kiosk);
            assertEquals(0, activity.entries);
            ComponentName admin = new ComponentName(DPC, "admin");
            shadowOf(manager).setDeviceOwner(admin);
            manager.setLockTaskPackages(admin, new String[] {context.getPackageName()});
            EnterprisePolicyClient.maybeEnterLockTask(activity, kiosk);
            assertEquals(1, activity.entries);
            assertFalse(manager.isDeviceOwnerApp(context.getPackageName()));
        }
    }

    public static class LockTaskActivity extends android.app.Activity {
        int entries;
        @Override public void startLockTask() { entries++; }
    }

    public static class StateProvider extends ContentProvider {
        Bundle state;
        Runnable beforeReply = () -> {};
        int calls;
        @Override public boolean onCreate() { return true; }
        @Override public Bundle call(String method, String arg, Bundle extras) {
            assertEquals(ManagementSnapshot.METHOD, method);
            assertNull(arg);
            assertNull(extras);
            calls++;
            beforeReply.run();
            return state;
        }
        @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { throw new UnsupportedOperationException(); }
        @Override public String getType(Uri u) { throw new UnsupportedOperationException(); }
        @Override public Uri insert(Uri u, ContentValues v) { throw new UnsupportedOperationException(); }
        @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException(); }
        @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
    }
}
