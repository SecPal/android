/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.ComponentName;
import android.content.Intent;

final class HardwareButtonLaunchRouter {
    static final String PROFILE_HARDWARE_TRIGGER_ACTIVITY = "app.secpal.ProfileHardwareTriggerActivity";
    static final String ABOUT_HARDWARE_TRIGGER_ACTIVITY = "app.secpal.AboutHardwareTriggerActivity";

    private HardwareButtonLaunchRouter() {
    }

    static boolean isHardwareTriggerLaunch(Intent intent) {
        return resolvePressType(intent) != SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN;
    }

    static SamsungKnoxHardwareButtonController.HardKeyPressType resolvePressType(Intent intent) {
        if (intent == null) {
            return SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN;
        }

        return resolvePressType(
            resolveComponentClassName(intent.getComponent()),
            intent.getStringExtra(SamsungKnoxHardwareButtonController.EXTRA_HARDWARE_TRIGGER_PRESS_TYPE)
        );
    }

    static SamsungKnoxHardwareButtonController.HardKeyPressType resolvePressType(
        String componentClassName,
        String encodedPressType
    ) {
        if (PROFILE_HARDWARE_TRIGGER_ACTIVITY.equals(componentClassName)) {
            return SamsungKnoxHardwareButtonController.HardKeyPressType.SHORT_PRESS;
        }

        if (ABOUT_HARDWARE_TRIGGER_ACTIVITY.equals(componentClassName)) {
            return SamsungKnoxHardwareButtonController.HardKeyPressType.LONG_PRESS;
        }

        if (encodedPressType == null || encodedPressType.isBlank()) {
            return SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN;
        }

        try {
            return SamsungKnoxHardwareButtonController.HardKeyPressType.valueOf(encodedPressType);
        } catch (IllegalArgumentException exception) {
            return SamsungKnoxHardwareButtonController.HardKeyPressType.UNKNOWN;
        }
    }

    private static String resolveComponentClassName(ComponentName componentName) {
        if (componentName == null) {
            return null;
        }

        return componentName.getClassName();
    }
}
