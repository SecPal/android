/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.os.Bundle;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

/** Management presentation only; carries no endpoint, tenant, user, session or business authority. */
final class ManagementSnapshot {
    static final String METHOD = "management_state";
    private static final Set<String> KEYS = new LinkedHashSet<>(Arrays.asList(
        "version", "mode", "kiosk", "lock_task", "phone", "sms", "gesture", "packages", "gesture_pending"
    ));
    private ManagementSnapshot() {}

    static EnterpriseManagedState unavailable() {
        return EnterpriseManagedState.unavailable();
    }

    static Bundle encode(Context context, EnterpriseManagedState state) {
        Bundle result = new Bundle();
        result.putInt("version", 1);
        result.putString("mode", state.getMode());
        result.putBoolean("kiosk", state.isKioskActive());
        result.putBoolean("lock_task", state.isLockTaskEnabled());
        result.putBoolean("phone", state.isManaged() && state.isAllowPhone());
        result.putBoolean("sms", state.isManaged() && state.isAllowSms());
        result.putBoolean("gesture", state.isPreferGestureNavigation());
        result.putStringArray("packages", state.isManaged()
            ? state.resolveAllowedPackages(context).toArray(new String[0]) : new String[0]);
        result.putBoolean("gesture_pending", state.isDeviceOwner()
            && SystemNavigationSettings.isProvisioningGestureNavigationPending(context));
        return result;
    }

    @SuppressWarnings("deprecation")
    static EnterpriseManagedState decode(Bundle bundle, String currentOwnerMode) {
        if ((!EnterpriseManagedState.MODE_DEVICE_OWNER.equals(currentOwnerMode)
            && !EnterpriseManagedState.MODE_PROFILE_OWNER.equals(currentOwnerMode)
            && !EnterpriseManagedState.MODE_NONE.equals(currentOwnerMode))
            || bundle == null || !KEYS.equals(bundle.keySet())
            || !(bundle.get("version") instanceof Integer) || bundle.getInt("version") != 1
            || !currentOwnerMode.equals(bundle.get("mode"))) return unavailable();
        boolean unmanaged = EnterpriseManagedState.MODE_NONE.equals(currentOwnerMode);
        for (String key : Arrays.asList("kiosk", "lock_task", "phone", "sms", "gesture", "gesture_pending")) {
            if (!(bundle.get(key) instanceof Boolean) || (unmanaged && bundle.getBoolean(key))) return unavailable();
        }
        if (!(bundle.get("packages") instanceof String[])) return unavailable();
        if (unmanaged) {
            return bundle.getStringArray("packages").length == 0
                ? new EnterpriseManagedState(currentOwnerMode, EnterprisePolicyConfig.disabled()) : unavailable();
        }
        boolean deviceOwner = EnterpriseManagedState.MODE_DEVICE_OWNER.equals(currentOwnerMode);
        if (!deviceOwner && (bundle.getBoolean("kiosk") || bundle.getBoolean("lock_task")
            || bundle.getBoolean("gesture") || bundle.getBoolean("gesture_pending"))) return unavailable();
        Set<String> packages = new LinkedHashSet<>();
        for (String name : bundle.getStringArray("packages")) {
            if (name == null || name.isEmpty()) return unavailable();
            packages.add(name);
        }
        return new EnterpriseManagedState(currentOwnerMode, new EnterprisePolicyConfig(
            bundle.getBoolean("kiosk"), bundle.getBoolean("lock_task"),
            bundle.getBoolean("phone"), bundle.getBoolean("sms"), bundle.getBoolean("gesture"), packages
        ));
    }
}
