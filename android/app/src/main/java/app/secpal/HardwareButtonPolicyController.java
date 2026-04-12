/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.Intent;

final class HardwareButtonPolicyController {
    private HardwareButtonPolicyController() {
    }

    static void syncManagedState(Context context, EnterpriseManagedState managedState) {
        SamsungKnoxHardwareButtonController.syncManagedState(context, managedState);
        SamsungSystemKeyConfigurationController.syncManagedState(context, managedState);
    }

    static boolean isHardwareTriggerLaunch(Intent intent) {
        return HardwareButtonLaunchRouter.isHardwareTriggerLaunch(intent);
    }
}
