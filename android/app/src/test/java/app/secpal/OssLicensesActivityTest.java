/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import com.google.android.gms.oss.licenses.OssLicensesMenuActivity;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public final class OssLicensesActivityTest {
    @Test
    public void noticesActivityIsUnavailableWithoutAnAttachedActivity() {
        assertFalse(SecPalEnterprisePlugin.canOpenOssLicenses(null));
    }

    @Test
    public void noticesIntentTargetsTheGeneratedNoticesActivity() {
        assertEquals(
            OssLicensesMenuActivity.class.getName(),
            SecPalEnterprisePlugin.buildOssLicensesIntent().getComponent().getClassName()
        );
    }
}
