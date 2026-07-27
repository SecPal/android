/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.os.Process;

import org.junit.Test;

public class SamsungHardKeyReceiverTest {

    @Test
    public void rejectsHardKeySenderWhenAndroidCannotExposeItsIdentity() {
        assertFalse(
            SamsungHardKeyReceiver.isTrustedKnoxSender(
                33,
                Process.SYSTEM_UID,
                (permission, uid) -> true
            )
        );
    }

    @Test
    public void rejectsHardKeySenderWithoutKnoxPermission() {
        assertFalse(
            SamsungHardKeyReceiver.isTrustedKnoxSender(
                34,
                20_001,
                (permission, uid) -> false
            )
        );
    }

    @Test
    public void rejectsHardKeySenderWithUnavailableIdentity() {
        assertFalse(
            SamsungHardKeyReceiver.isTrustedKnoxSender(
                34,
                Process.INVALID_UID,
                (permission, uid) -> true
            )
        );
    }

    @Test
    public void acceptsManagedKeyMappingSenderPermission() {
        assertTrue(
            SamsungHardKeyReceiver.isTrustedKnoxSender(
                34,
                20_001,
                (permission, uid) ->
                    SamsungHardKeyReceiver.KNOX_CUSTOM_SETTING_PERMISSION.equals(permission)
            )
        );
    }

    @Test
    public void acceptsLegacyKnoxSystemSenderPermission() {
        assertTrue(
            SamsungHardKeyReceiver.isTrustedKnoxSender(
                34,
                Process.SYSTEM_UID,
                (permission, uid) ->
                    SamsungHardKeyReceiver.KNOX_CUSTOM_SYSTEM_PERMISSION.equals(permission)
            )
        );
    }

    @Test
    public void acceptsPermissionHeldByPackageInSenderUid() {
        assertTrue(
            SamsungHardKeyReceiver.senderPackagesHoldPermission(
                new String[] { "com.example.untrusted", "com.samsung.android.knox.kpecore" },
                SamsungHardKeyReceiver.KNOX_CUSTOM_SETTING_PERMISSION,
                (permission, packageName) ->
                    "com.samsung.android.knox.kpecore".equals(packageName)
                        && SamsungHardKeyReceiver.KNOX_CUSTOM_SETTING_PERMISSION.equals(permission)
            )
        );
    }

    @Test
    public void rejectsSenderUidWithoutPackages() {
        assertFalse(
            SamsungHardKeyReceiver.senderPackagesHoldPermission(
                null,
                SamsungHardKeyReceiver.KNOX_CUSTOM_SETTING_PERMISSION,
                (permission, packageName) -> true
            )
        );
    }

    @Test
    public void ignoresSamsungHardKeyBroadcastsOutsideManagedMode() {
        FakeIntent intent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_PRESS);

        assertNull(
            SamsungHardKeyReceiver.resolveManagedHardwareAction(
                intent,
                "app.secpal",
                false,
                false
            )
        );
    }

    @Test
    public void ignoresUnknownActionBroadcastsEvenInManagedMode() {
        FakeIntent intent = new FakeIntent("com.example.unrelated.action");

        assertNull(
            SamsungHardKeyReceiver.resolveManagedHardwareAction(
                intent,
                "app.secpal",
                true,
                false
            )
        );
    }

    @Test
    public void acceptsSamsungHardKeyBroadcastsForManagedOwners() {
        FakeIntent intent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_PRESS);

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardKeyReceiver.resolveManagedHardwareAction(
                intent,
                "app.secpal",
                true,
                false
            )
        );
        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardKeyReceiver.resolveManagedHardwareAction(
                intent,
                "app.secpal",
                false,
                true
            )
        );
    }
}
