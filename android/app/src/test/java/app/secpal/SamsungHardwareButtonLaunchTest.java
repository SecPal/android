/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Intent;

import org.junit.Before;
import org.junit.Test;

public class SamsungHardwareButtonLaunchTest {

    @Before
    public void resetHardKeyState() {
        SamsungHardwareButtonLaunch.resetHardKeyReportState();
    }

    @Test
    public void resolvesSamsungHardKeyReportDownUpToShortPress() {
        FakeIntent intent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        intent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
        );
        intent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_DOWN_UP
        );

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(intent, "app.secpal")
        );
        assertEquals(
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER,
            SamsungHardwareButtonLaunch.resolveLaunchKeyCode(intent)
        );
    }

    @Test
    public void resolvesSamsungHardKeyReportLongToLongPress() {
        FakeIntent intent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        intent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS
        );
        intent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE_NEW,
            SamsungHardKeyReceiver.REPORT_TYPE_LONG
        );

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_LONG_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(intent, "app.secpal")
        );
        assertEquals(
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS,
            SamsungHardwareButtonLaunch.resolveLaunchKeyCode(intent)
        );
    }

    @Test
    public void resetHardKeyReportStateClearsAccumulatedState() {
        long threshold = SecPalEnterprisePlugin.HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS;

        FakeIntent downIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);
        downIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
        );
        downIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_DOWN
        );

        FakeIntent upIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);
        upIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
        );
        upIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_UP
        );

        assertNull(
            SamsungHardwareButtonLaunch.resolveLaunchAction(downIntent, "app.secpal", () -> 0L)
        );

        SamsungHardwareButtonLaunch.resetHardKeyReportState();

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(upIntent, "app.secpal", () -> threshold)
        );
        assertEquals(
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER,
            SamsungHardwareButtonLaunch.resolveLaunchKeyCode(upIntent)
        );
    }

    @Test
    public void ignoresSamsungHardKeyReportWithoutSupportedKeyCodeOrAction() {
        FakeIntent unsupportedKeyIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);
        unsupportedKeyIntent.putExtra(SamsungHardKeyReceiver.EXTRA_KEY_CODE, 9999);
        unsupportedKeyIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_DOWN_UP
        );

        FakeIntent keyDownIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);
        keyDownIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
        );
        keyDownIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_DOWN
        );

        assertNull(SamsungHardwareButtonLaunch.resolveLaunchAction(unsupportedKeyIntent, "app.secpal"));
        assertNull(SamsungHardwareButtonLaunch.resolveLaunchAction(keyDownIntent, "app.secpal"));
        assertEquals(9999, SamsungHardwareButtonLaunch.resolveLaunchKeyCode(unsupportedKeyIntent));
        assertFalse(SamsungHardwareButtonLaunch.shouldWakeDevice(keyDownIntent, "app.secpal"));
    }

    @Test
    public void resolvesSyntheticKnoxLaunchExtrasToShortPress() {
        FakeIntent intent = new FakeIntent();

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
        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveAliasLaunchAction(
                "app.secpal.SamsungEmergencyShortPressAlias",
                "app.secpal"
            )
        );
        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_LONG_PRESS,
            SamsungHardwareButtonLaunch.resolveAliasLaunchAction(
                "app.secpal.SamsungEmergencyLongPressAlias",
                "app.secpal"
            )
        );
    }

    @Test
    public void ignoresUnrelatedOrAlreadyHandledLaunchIntents() {
        FakeIntent unrelatedIntent = new FakeIntent();
        FakeIntent handledIntent = new FakeIntent();

        handledIntent.putExtra(SamsungHardwareButtonLaunch.EXTRA_HARDWARE_TRIGGER_HANDLED, true);
        handledIntent.putExtra(
            SamsungHardwareButtonLaunch.EXTRA_HARDWARE_TRIGGER_ACTION,
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS
        );

        assertNull(SamsungHardwareButtonLaunch.resolveLaunchAction(unrelatedIntent, "app.secpal"));
        assertNull(SamsungHardwareButtonLaunch.resolveLaunchAction(handledIntent, "app.secpal"));
    }

    @Test
    public void resolvesSamsungHardKeyReportNewLongUpBooleanToLongPress() {
        FakeIntent intent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        intent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
        );
        intent.putExtra(SamsungHardKeyReceiver.EXTRA_REPORT_TYPE_NEW_LONG_UP, true);

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_LONG_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(intent, "app.secpal")
        );
    }

    @Test
    public void resolvesSamsungHardKeyReportUpWithoutPriorDownToShortPress() {
        FakeIntent intent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        intent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER
        );
        intent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_UP
        );

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(intent, "app.secpal")
        );
    }

    @Test
    public void resolvesSamsungHardKeyReportDownThenImmediateUpToShortPress() {
        FakeIntent downIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        downIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS
        );
        downIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_DOWN
        );

        assertNull(SamsungHardwareButtonLaunch.resolveLaunchAction(downIntent, "app.secpal"));

        FakeIntent upIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        upIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS
        );
        upIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_UP
        );

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(upIntent, "app.secpal")
        );
    }

    @Test
    public void resolvesSamsungHardKeyReportDownThenLongUpToLongPress() {
        long threshold = SecPalEnterprisePlugin.HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS;

        FakeIntent downIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        downIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS
        );
        downIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_DOWN
        );

        assertNull(
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                downIntent,
                "app.secpal",
                () -> 0L
            )
        );

        FakeIntent upIntent = new FakeIntent(SamsungHardKeyReceiver.ACTION_HARD_KEY_REPORT);

        upIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_KEY_CODE,
            SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS
        );
        upIntent.putExtra(
            SamsungHardKeyReceiver.EXTRA_REPORT_TYPE,
            SamsungHardKeyReceiver.REPORT_TYPE_UP
        );

        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_LONG_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                upIntent,
                "app.secpal",
                () -> threshold
            )
        );
    }

    @Test
    public void resolvesDedicatedHomePhysicalKeyDownThenUpToShortPress() {
        assertTrue(SamsungHardwareButtonLaunch.isSupportedLaunchKeyCode(1015));
        assertNull(
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                android.view.KeyEvent.ACTION_DOWN,
                1015,
                0,
                false,
                () -> 0L
            )
        );
        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                android.view.KeyEvent.ACTION_UP,
                1015,
                0,
                false,
                () -> 250L
            )
        );
    }

    @Test
    public void resolvesDedicatedHomePhysicalKeyDownThenLongUpToLongPress() {
        long threshold = SecPalEnterprisePlugin.HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS;

        assertTrue(SamsungHardwareButtonLaunch.isSupportedLaunchKeyCode(1079));
        assertNull(
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                android.view.KeyEvent.ACTION_DOWN,
                1079,
                0,
                false,
                () -> 0L
            )
        );
        assertEquals(
            SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_LONG_PRESS,
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                android.view.KeyEvent.ACTION_UP,
                1079,
                0,
                false,
                () -> threshold
            )
        );
    }

    @Test
    public void ignoresUnsupportedOrCanceledDedicatedHomePhysicalKeyEvents() {
        assertFalse(SamsungHardwareButtonLaunch.isSupportedLaunchKeyCode(9999));
        assertNull(
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                android.view.KeyEvent.ACTION_UP,
                9999,
                0,
                false,
                () -> 0L
            )
        );
        assertNull(
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                android.view.KeyEvent.ACTION_DOWN,
                1015,
                0,
                false,
                () -> 0L
            )
        );
        assertNull(
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                android.view.KeyEvent.ACTION_UP,
                1015,
                0,
                true,
                () -> 100L
            )
        );
    }
}
