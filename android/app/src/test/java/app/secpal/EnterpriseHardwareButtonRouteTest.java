/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

public class EnterpriseHardwareButtonRouteTest {

    @Before
    public void resetHardKeyState() {
        SamsungHardwareButtonLaunch.resetHardKeyReportState();
    }

    @Test
    public void resolvesShortPressRouteForSupportedHardwareKey() {
        assertNull(
            EnterpriseHardwareButtonRoute.resolveRouteForKeyEvent(
                android.view.KeyEvent.ACTION_DOWN,
                SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER,
                0,
                false,
                () -> 0L
            )
        );
        assertEquals(
            EnterpriseHardwareButtonRoute.PROFILE_ROUTE,
            EnterpriseHardwareButtonRoute.resolveRouteForKeyEvent(
                android.view.KeyEvent.ACTION_UP,
                SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_XCOVER,
                0,
                false,
                () -> 250L
            )
        );
    }

    @Test
    public void resolvesLongPressRouteForSupportedHardwareKey() {
        long longPressDurationMs = SecPalEnterprisePlugin.HARDWARE_BUTTON_LONG_PRESS_THRESHOLD_MS;

        assertNull(
            EnterpriseHardwareButtonRoute.resolveRouteForKeyEvent(
                android.view.KeyEvent.ACTION_DOWN,
                SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS,
                0,
                false,
                () -> 0L
            )
        );
        assertEquals(
            EnterpriseHardwareButtonRoute.ABOUT_ROUTE,
            EnterpriseHardwareButtonRoute.resolveRouteForKeyEvent(
                android.view.KeyEvent.ACTION_UP,
                SamsungHardKeyReceiver.SAMSUNG_KEY_CODE_SOS,
                0,
                false,
                () -> longPressDurationMs
            )
        );
    }

    @Test
    public void ignoresUnsupportedHardwareKeys() {
        assertNull(
            EnterpriseHardwareButtonRoute.resolveRouteForKeyEvent(
                android.view.KeyEvent.ACTION_UP,
                android.view.KeyEvent.KEYCODE_VOLUME_UP,
                0,
                false,
                () -> 0L
            )
        );
        assertNull(EnterpriseHardwareButtonRoute.resolveRouteForHardwareAction(null));
        assertNull(EnterpriseHardwareButtonRoute.resolveRouteForHardwareAction("unsupported"));
        assertNull(EnterpriseHardwareButtonRoute.resolveRouteForKeyEvent((android.view.KeyEvent) null));
    }

    @Test
    public void buildsNavigationJavascriptForKnownRoute() {
        String javascript = EnterpriseHardwareButtonRoute.buildNavigationJavascript(
            EnterpriseHardwareButtonRoute.PROFILE_ROUTE
        );

        assertTrue(javascript.contains(EnterpriseHardwareButtonRoute.PROFILE_ROUTE));
        assertTrue(javascript.contains("location.href"));
        assertTrue(javascript.contains("new URL(pathname,currentUrl.href).toString()"));
    }
}
