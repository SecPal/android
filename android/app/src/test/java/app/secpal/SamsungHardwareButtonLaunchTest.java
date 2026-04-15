/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Intent;

import org.junit.Test;

public class SamsungHardwareButtonLaunchTest {

    @Test
    public void resolvesSyntheticKnoxLaunchExtrasToShortPress() {
        Intent intent = new Intent();

        intent.putExtra(
            SamsungHardwareButtonLaunch.EXTRA_HARDWARE_TRIGGER_ACTION,
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS
        );

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(intent, "app.secpal")
        );
        assertTrue(SamsungHardwareButtonLaunch.shouldWakeDevice(intent, "app.secpal"));
    }

    @Test
    public void resolvesSamsungEmergencyAliasesToShortAndLongPress() {
        Intent shortIntent = new Intent();
        shortIntent.setComponent(
            new ComponentName("app.secpal", "app.secpal.SamsungEmergencyShortPressAlias")
        );
        Intent longIntent = new Intent();
        longIntent.setComponent(
            new ComponentName("app.secpal", "app.secpal.SamsungEmergencyLongPressAlias")
        );

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(shortIntent, "app.secpal")
        );
        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_LONG_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(longIntent, "app.secpal")
        );
    }

    @Test
    public void ignoresUnrelatedOrAlreadyHandledLaunchIntents() {
        Intent unrelatedIntent = new Intent();
        Intent handledIntent = new Intent();

        handledIntent.putExtra(SamsungHardwareButtonLaunch.EXTRA_HARDWARE_TRIGGER_HANDLED, true);
        handledIntent.putExtra(
            SamsungHardwareButtonLaunch.EXTRA_HARDWARE_TRIGGER_ACTION,
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS
        );

        assertNull(SamsungHardwareButtonLaunch.resolveLaunchAction(unrelatedIntent, "app.secpal"));
        assertNull(SamsungHardwareButtonLaunch.resolveLaunchAction(handledIntent, "app.secpal"));
    }
}
