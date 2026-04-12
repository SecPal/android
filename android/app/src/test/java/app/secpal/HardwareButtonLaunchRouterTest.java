/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class HardwareButtonLaunchRouterTest {

    @Test
    public void resolvesProfileAliasAsShortPress() {
        assertEquals(
            SamsungKnoxHardwareButtonController.HardKeyPressType.SHORT_PRESS,
            HardwareButtonLaunchRouter.resolvePressType(
                HardwareButtonLaunchRouter.PROFILE_HARDWARE_TRIGGER_ACTIVITY,
                null
            )
        );
    }

    @Test
    public void resolvesAboutAliasAsLongPress() {
        assertEquals(
            SamsungKnoxHardwareButtonController.HardKeyPressType.LONG_PRESS,
            HardwareButtonLaunchRouter.resolvePressType(
                HardwareButtonLaunchRouter.ABOUT_HARDWARE_TRIGGER_ACTIVITY,
                null
            )
        );
    }

    @Test
    public void resolvesEncodedLaunchPressTypeFallback() {
        assertEquals(
            SamsungKnoxHardwareButtonController.HardKeyPressType.SHORT_PRESS,
            HardwareButtonLaunchRouter.resolvePressType(null, "SHORT_PRESS")
        );
        assertEquals(
            SamsungKnoxHardwareButtonController.HardKeyPressType.LONG_PRESS,
            HardwareButtonLaunchRouter.resolvePressType(null, "LONG_PRESS")
        );
    }

    @Test
    public void ignoresUnknownLaunchValues() {
        assertTrue(
            HardwareButtonLaunchRouter.resolvePressType(null, "invalid")
                == SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN
        );
        assertFalse(
            HardwareButtonLaunchRouter.resolvePressType(null, null)
                != SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN
        );
    }
}
