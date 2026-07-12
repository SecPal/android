/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.view.ViewGroup;

import com.google.android.gms.oss.licenses.v2.OssLicensesMenuActivity;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;

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

    @Test
    public void noticesActivityStartsAndRendersContent() {
        try (
            ActivityController<OssLicensesMenuActivity> controller =
                Robolectric.buildActivity(OssLicensesMenuActivity.class).setup()
        ) {
            Activity activity = controller.get();
            ViewGroup content = activity.findViewById(android.R.id.content);

            assertFalse(activity.isFinishing());
            assertTrue(content.getChildCount() > 0);
        }
    }
}
