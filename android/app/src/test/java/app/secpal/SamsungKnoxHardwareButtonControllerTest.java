/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SamsungKnoxHardwareButtonControllerTest {

    @Test
    public void resolveHardKeyPressTypeUsesNumericLongReportFallback() {
        assertEquals(
            SamsungKnoxHardwareButtonController.HardKeyPressType.LONG_PRESS,
            SamsungKnoxHardwareButtonController.resolveHardKeyPressType(4, null, null)
        );
    }

    @Test
    public void resolveHardKeyPressTypeUsesLongUpMarkerForLongPresses() {
        assertEquals(
            SamsungKnoxHardwareButtonController.HardKeyPressType.LONG_PRESS,
            SamsungKnoxHardwareButtonController.resolveHardKeyPressType(null, null, true)
        );
    }

    @Test
    public void resolveHardKeyPressTypeUsesNewReportMarkerForShortPresses() {
        assertEquals(
            SamsungKnoxHardwareButtonController.HardKeyPressType.SHORT_PRESS,
            SamsungKnoxHardwareButtonController.resolveHardKeyPressType(null, true, null)
        );
    }

    @Test
    public void resolveHardKeyPressTypeReturnsUnknownWithoutRecognizedMarkers() {
        assertTrue(
            SamsungKnoxHardwareButtonController.resolveHardKeyPressType(null, null, null)
                == SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN
        );
    }
}
