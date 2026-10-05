/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertFalse;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

public class EnterpriseManagedStateTest {

    @Test
    public void policyFlagsCannotActivateDedicatedHomeWithoutOwnerRole() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        EnterpriseManagedState managedState = new EnterpriseManagedState(
            EnterpriseManagedState.MODE_NONE,
            EnterprisePolicyConfig.fromMap(values)
        );

        assertFalse(managedState.isManaged());
        assertFalse(managedState.isDeviceOwner());
        assertFalse(managedState.isKioskActive());
        assertFalse(managedState.isLockTaskEnabled());
    }

}
