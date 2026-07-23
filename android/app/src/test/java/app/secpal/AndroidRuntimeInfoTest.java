/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AndroidRuntimeInfoTest {

    @Test
    public void containsOnlyVersionMetadataNeededByTheRuntimeBridge() {
        AndroidRuntimeInfo runtimeInfo = new AndroidRuntimeInfo(" 1.2.3 ", 42L);

        assertEquals("1.2.3", runtimeInfo.getPackageVersionName());
        assertEquals(42L, runtimeInfo.getPackageVersionCode());
    }
}
