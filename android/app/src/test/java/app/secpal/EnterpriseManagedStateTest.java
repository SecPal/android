/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

public class EnterpriseManagedStateTest {

    @Test
    public void debugKioskOverrideActivatesDedicatedHomeWithoutOwnerRole() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        EnterpriseManagedState managedState = new EnterpriseManagedState(
            EnterpriseManagedState.MODE_NONE,
            EnterprisePolicyConfig.fromMap(values),
            true
        );

        assertFalse(managedState.isManaged());
        assertFalse(managedState.isDeviceOwner());
        assertTrue(managedState.isKioskActive());
        assertTrue(managedState.isLockTaskEnabled());
    }

    @Test
    public void debugKioskOverrideStillNeedsKioskPolicyFlag() {
        EnterpriseManagedState managedState = new EnterpriseManagedState(
            EnterpriseManagedState.MODE_NONE,
            EnterprisePolicyConfig.disabled(),
            true
        );

        assertFalse(managedState.isKioskActive());
        assertFalse(managedState.isLockTaskEnabled());
    }
}
