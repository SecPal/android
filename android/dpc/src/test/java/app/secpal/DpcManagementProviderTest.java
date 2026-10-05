/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.content.*;
import android.content.pm.*;
import android.os.Bundle;
import android.app.admin.DevicePolicyManager;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 24)
public class DpcManagementProviderTest {
    private Context context;
    private final Signature workSignature = new Signature(new byte[] {1, 2, 3});
    private String pin;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        pin = ManagementPackageIdentity.digest(workSignature);
        PackageInfo info = new PackageInfo();
        info.packageName = "app.secpal";
        info.applicationInfo = new ApplicationInfo();
        info.applicationInfo.packageName = info.packageName;
        info.applicationInfo.uid = 12345;
        info.signatures = new Signature[] {workSignature};
        shadowOf(context.getPackageManager()).installPackage(info);
        shadowOf(context.getPackageManager()).setPackagesForUid(12345, "app.secpal");
    }
    private Bundle call(int uid, String digest, String method, String arg, Bundle extras) {
        return DpcManagementProvider.readForCaller(context, uid, "app.secpal", digest, method, arg, extras);
    }
    @Test public void onlyExclusivePinnedWorkUidCanReadAndOwnershipIsFresh() {
        assertEquals("none", call(12345, pin, ManagementSnapshot.METHOD, null, null).getString("mode"));
        DevicePolicyManager manager = context.getSystemService(DevicePolicyManager.class);
        shadowOf(manager).setProfileOwner(new ComponentName(context, SecPalDeviceAdminReceiver.class));
        Bundle state = call(12345, pin, ManagementSnapshot.METHOD, null, null);
        assertEquals("profile_owner", state.getString("mode"));
        assertFalse(state.getBoolean("kiosk"));
        assertFalse(manager.isLockTaskPermitted("app.secpal"));
        manager.clearProfileOwner(new ComponentName(context, SecPalDeviceAdminReceiver.class));
        assertEquals("none", call(12345, pin, ManagementSnapshot.METHOD, null, null).getString("mode"));
    }
    @Test public void wrongUidWrongPinAndSharedUidReject() {
        assertThrows(SecurityException.class, () -> call(99999, pin, ManagementSnapshot.METHOD, null, null));
        assertThrows(SecurityException.class, () -> call(12345, "0".repeat(64), ManagementSnapshot.METHOD, null, null));
        assertThrows(SecurityException.class, () -> call(12345, "", ManagementSnapshot.METHOD, null, null));
        shadowOf(context.getPackageManager()).setPackagesForUid(12345, "app.secpal", "evil.shared");
        assertThrows(SecurityException.class, () -> call(12345, pin, ManagementSnapshot.METHOD, null, null));
    }
    @Test public void noCallerCanRequestPolicyMutationOrInjectClaims() {
        assertThrows(IllegalArgumentException.class, () -> call(12345, pin, "set_policy", null, null));
        assertThrows(IllegalArgumentException.class, () -> call(12345, pin, ManagementSnapshot.METHOD, "managed", null));
        assertThrows(IllegalArgumentException.class, () -> call(12345, pin, ManagementSnapshot.METHOD, null, new Bundle()));
        DpcManagementProvider provider = new DpcManagementProvider();
        assertThrows(UnsupportedOperationException.class, () -> provider.insert(null, new ContentValues()));
        assertThrows(UnsupportedOperationException.class, () -> provider.update(null, new ContentValues(), null, null));
        assertThrows(UnsupportedOperationException.class, () -> provider.delete(null, null, null));
        assertThrows(UnsupportedOperationException.class, () -> provider.query(null, null, null, null, null));
    }
}
