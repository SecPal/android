/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
package app.secpal;
import static org.junit.Assert.*;
import java.util.Map;
import java.util.LinkedHashMap;
import org.junit.Test;
public class EnterprisePolicyLaunchTest {
    @Test
    public void debugKioskLauncherLaunchesDedicatedHomeOnUnmanagedDevices() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        assertTrue(
            EnterprisePolicyClient.shouldOpenDedicatedHomeOnLaunch(
                "android.intent.action.MAIN",
                true,
                false,
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_NONE,
                    EnterprisePolicyConfig.fromMap(values),
                    true
                )
            )
        );
    }

    @Test
    public void explicitMainActivityLaunchDoesNotRedirectIntoDedicatedHome() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        assertFalse(
            EnterprisePolicyClient.shouldOpenDedicatedHomeOnLaunch(
                null,
                false,
                false,
                new EnterpriseManagedState(
                    EnterpriseManagedState.MODE_NONE,
                    EnterprisePolicyConfig.fromMap(values),
                    true
                )
            )
        );
    }
}
