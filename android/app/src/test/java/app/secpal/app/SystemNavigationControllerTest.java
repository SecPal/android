/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Collections;

import org.junit.Test;

public class SystemNavigationControllerTest {

    @Test
    public void gestureNavigationModeValueIsRecognized() {
        assertTrue(SystemNavigationController.isGestureNavigationModeValue(2));
        assertFalse(SystemNavigationController.isGestureNavigationModeValue(0));
        assertFalse(SystemNavigationController.isGestureNavigationModeValue(1));
    }

    @Test
    public void gestureNavigationDefaultsToPreferredForKioskProvisioning() {
        EnterpriseManagedState managedState = new EnterpriseManagedState(
            EnterpriseManagedState.MODE_DEVICE_OWNER,
            EnterprisePolicyConfig.fromMap(Collections.singletonMap(
                EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED,
                true
            ))
        );

        assertTrue(managedState.isPreferGestureNavigation());
    }
}
