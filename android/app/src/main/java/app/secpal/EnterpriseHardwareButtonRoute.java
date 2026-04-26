/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.view.KeyEvent;

import java.util.function.LongSupplier;

final class EnterpriseHardwareButtonRoute {
    static final String PROFILE_ROUTE = "/profile";
    static final String ABOUT_ROUTE = "/about";

    private EnterpriseHardwareButtonRoute() {
    }

    static String resolveRouteForHardwareAction(String hardwareAction) {
        if (SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_SHORT_PRESS.equals(hardwareAction)) {
            return PROFILE_ROUTE;
        }

        if (SamsungHardwareButtonLaunch.HARDWARE_TRIGGER_ACTION_LONG_PRESS.equals(hardwareAction)) {
            return ABOUT_ROUTE;
        }

        return null;
    }

    static String resolveRouteForKeyEvent(KeyEvent event) {
        if (event == null) {
            return null;
        }

        return resolveRouteForKeyEvent(event, event::getEventTime);
    }

    static String resolveRouteForKeyEvent(KeyEvent event, LongSupplier timeMs) {
        if (event == null) {
            return null;
        }

        return resolveRouteForKeyEvent(
            event.getAction(),
            event.getKeyCode(),
            event.getRepeatCount(),
            event.isCanceled(),
            timeMs
        );
    }

    static String resolveRouteForKeyEvent(
        int action,
        int keyCode,
        int repeatCount,
        boolean canceled,
        LongSupplier timeMs
    ) {
        return resolveRouteForHardwareAction(
            SamsungHardwareButtonLaunch.resolveLaunchAction(
                action,
                keyCode,
                repeatCount,
                canceled,
                timeMs
            )
        );
    }

    static String buildNavigationJavascript(String pathname) {
        String escapedPathname = pathname.replace("\\", "\\\\").replace("'", "\\'");

        return String.format(
            "(function(){const pathname='%s';const location=window.location;if(!location){return;}try{const currentUrl=new URL(location.href);if(currentUrl.pathname===pathname){return;}location.href=new URL(pathname,currentUrl.href).toString();}catch(_error){location.href=pathname;}})();",
            escapedPathname
        );
    }
}
