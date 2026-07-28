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
import android.widget.ScrollView;
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

    @Test
    public void usesWrapContentForTheScrollChildSizingContract() {
        try (ActivityController<WebViewCompatibilityActivity> controller =
            Robolectric.buildActivity(WebViewCompatibilityActivity.class).setup()) {
            ViewGroup content = controller.get().findViewById(android.R.id.content);
            ScrollView scrollView = (ScrollView) content.getChildAt(0);

            assertEquals(ViewGroup.LayoutParams.WRAP_CONTENT, scrollView.getChildAt(0).getLayoutParams().height);
        }
    }

    @Test
    public void keepsShortUpdateGuidanceCenteredInTheViewport() {
        try (ActivityController<WebViewCompatibilityActivity> controller =
            Robolectric.buildActivity(WebViewCompatibilityActivity.class).setup()) {
            ViewGroup content = controller.get().findViewById(android.R.id.content);
            ScrollView scrollView = (ScrollView) content.getChildAt(0);
            ViewGroup scrollableContent = (ViewGroup) scrollView.getChildAt(0);
            TextView title = controller.get().findViewById(R.id.webview_compatibility_title);

            measureAndLayout(scrollView, 480, 1_000);

            assertEquals(scrollView.getMeasuredHeight(), scrollableContent.getMeasuredHeight());
            assertTrue(title.getTop() > scrollableContent.getPaddingTop());
            assertFalse(scrollView.canScrollVertically(1));
        }
    }

    @Test
    public void keepsLongUpdateGuidanceScrollableInAConstrainedViewport() {
        try (ActivityController<WebViewCompatibilityActivity> controller =
            Robolectric.buildActivity(WebViewCompatibilityActivity.class).setup()) {
            ViewGroup content = controller.get().findViewById(android.R.id.content);
            ScrollView scrollView = (ScrollView) content.getChildAt(0);
            View scrollableContent = scrollView.getChildAt(0);
            TextView message = controller.get().findViewById(R.id.webview_compatibility_message);
            String updateGuidance = message.getText().toString();
            message.setText((updateGuidance + "\n").repeat(20));

            measureAndLayout(scrollView, 480, 200);

            assertTrue(scrollableContent.getMeasuredHeight() > scrollView.getMeasuredHeight());
            assertTrue(scrollView.canScrollVertically(1));
        }
    }

    private static void measureAndLayout(View view, int width, int height) {
        int widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY);
        int heightSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY);
        view.measure(widthSpec, heightSpec);
        view.layout(0, 0, view.getMeasuredWidth(), view.getMeasuredHeight());
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
