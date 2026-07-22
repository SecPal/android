/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.TextView;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;

@RunWith(RobolectricTestRunner.class)
public final class WebViewCompatibilityActivityTest {
    @Test
    public void appliesScreenshotProtectionBeforeRendering() {
        try (ActivityController<WebViewCompatibilityActivity> controller =
            Robolectric.buildActivity(WebViewCompatibilityActivity.class).create()) {
            int windowFlags = controller.get().getWindow().getAttributes().flags;

            assertTrue((windowFlags & WindowManager.LayoutParams.FLAG_SECURE) != 0);
        }
    }

    @Test
    public void enforcesManagedPolicyWhenResumed() {
        try (ActivityController<RecordingCompatibilityActivity> controller =
            Robolectric.buildActivity(RecordingCompatibilityActivity.class).setup()) {
            assertTrue(controller.get().managedPolicyEnforced);
        }
    }

    @Test
    public void rendersActionableUpdateMessageWithoutWebView() {
        try (ActivityController<WebViewCompatibilityActivity> controller =
            Robolectric.buildActivity(WebViewCompatibilityActivity.class).setup()) {
            WebViewCompatibilityActivity activity = controller.get();
            TextView title = activity.findViewById(R.id.webview_compatibility_title);
            TextView message = activity.findViewById(R.id.webview_compatibility_message);

            assertEquals(activity.getString(R.string.webview_compatibility_title), title.getText().toString());
            assertEquals(activity.getString(R.string.webview_compatibility_message), message.getText().toString());
            assertFalse(containsWebView(activity.findViewById(android.R.id.content)));
        }
    }

    private static boolean containsWebView(View view) {
        if (view instanceof WebView) {
            return true;
        }
        if (!(view instanceof ViewGroup viewGroup)) {
            return false;
        }

        for (int index = 0; index < viewGroup.getChildCount(); index++) {
            if (containsWebView(viewGroup.getChildAt(index))) {
                return true;
            }
        }
        return false;
    }

    public static final class RecordingCompatibilityActivity extends WebViewCompatibilityActivity {
        private boolean managedPolicyEnforced;

        @Override
        void enforceManagedPolicy() {
            managedPolicyEnforced = true;
        }
    }
}
