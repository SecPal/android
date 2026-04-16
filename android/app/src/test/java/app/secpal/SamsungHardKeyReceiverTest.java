/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.content.Intent;

import org.junit.Test;

public class SamsungHardKeyReceiverTest {

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
