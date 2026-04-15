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

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

public class SamsungHardwareButtonLaunchTest {

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

    private static final class FakeIntent extends Intent {
        private final Map<String, Object> extras = new HashMap<>();
        private String action;
        private ComponentName componentName;

        private FakeIntent() {
        }

        private FakeIntent(String action) {
            this.action = action;
        }

        @Override
        public String getAction() {
            return action;
        }

        @Override
        public Intent setAction(String action) {
            this.action = action;
            return this;
        }

        @Override
        public ComponentName getComponent() {
            return componentName;
        }

        @Override
        public Intent setComponent(ComponentName componentName) {
            this.componentName = componentName;
            return this;
        }

        @Override
        public boolean hasExtra(String name) {
            return extras.containsKey(name);
        }

        @Override
        public String getStringExtra(String name) {
            Object value = extras.get(name);

            return value instanceof String ? (String) value : null;
        }

        @Override
        public boolean getBooleanExtra(String name, boolean defaultValue) {
            Object value = extras.get(name);

            return value instanceof Boolean ? ((Boolean) value).booleanValue() : defaultValue;
        }

        @Override
        public int getIntExtra(String name, int defaultValue) {
            Object value = extras.get(name);

            return value instanceof Integer ? ((Integer) value).intValue() : defaultValue;
        }

        @Override
        public Intent putExtra(String name, String value) {
            extras.put(name, value);
            return this;
        }

        @Override
        public Intent putExtra(String name, boolean value) {
            extras.put(name, Boolean.valueOf(value));
            return this;
        }

        @Override
        public Intent putExtra(String name, int value) {
            extras.put(name, Integer.valueOf(value));
            return this;
        }
    }
}
