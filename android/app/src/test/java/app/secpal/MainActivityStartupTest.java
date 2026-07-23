/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.ViewParent;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.shadows.ShadowActivity;

@RunWith(RobolectricTestRunner.class)
public final class MainActivityStartupTest {
    @Test
    public void startupClearsRetiredEnrollmentBootstrapState() {
        Context context = RuntimeEnvironment.getApplication();
        SharedPreferences authPreferences = context.getSharedPreferences(
            SecPalNativeAuthPlugin.NATIVE_AUTH_PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        SharedPreferences enterprisePreferences = context.getSharedPreferences(
            EnterprisePolicyController.ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );

        authPreferences.edit().putString("bootstrap_token_ciphertext", "encrypted-token").commit();
        enterprisePreferences.edit().putString("bootstrap_status", "pending").commit();

        try (ActivityController<MissingBridgeLoadMainActivity> ignored =
            Robolectric.buildActivity(MissingBridgeLoadMainActivity.class).setup()) {
            assertFalse(authPreferences.contains("bootstrap_token_ciphertext"));
            assertFalse(enterprisePreferences.contains("bootstrap_status"));
        } finally {
            authPreferences.edit().clear().commit();
            enterprisePreferences.edit().clear().commit();
        }
    }

    @Test
    public void missingBridgeLoadRoutesToNativeCompatibilityActivity() {
        try (ActivityController<MissingBridgeLoadMainActivity> controller =
            Robolectric.buildActivity(MissingBridgeLoadMainActivity.class).setup()) {
            assertCompatibilityActivityStarted(controller.get());
        }
    }

    @Test
    public void listenerInstallationFailureRoutesToNativeCompatibilityActivity() {
        try (ActivityController<ListenerFailureMainActivity> controller =
            Robolectric.buildActivity(ListenerFailureMainActivity.class).setup()) {
            ListenerFailureMainActivity activity = controller.get();

            assertCompatibilityActivityStarted(activity);
            assertNull(activity.getBridge());
        }
    }

    @Test
    public void unavailableBridgeRoutesToNativeCompatibilityWithoutCreatingBridge() {
        try (ActivityController<UnavailableBridgeMainActivity> controller =
            Robolectric.buildActivity(UnavailableBridgeMainActivity.class).setup()) {
            UnavailableBridgeMainActivity activity = controller.get();

            assertCompatibilityActivityStarted(activity);
            assertFalse(activity.createSecureBridgeCalled);
            assertNull(activity.getBridge());
        }
    }

    @Test
    public void supportedBridgeContinuesWithoutCompatibilityActivity() {
        try (ActivityController<SupportedBridgeMainActivity> controller =
            Robolectric.buildActivity(SupportedBridgeMainActivity.class).setup()) {
            SupportedBridgeMainActivity activity = controller.get();
            ShadowActivity shadowActivity = org.robolectric.Shadows.shadowOf(activity);

            assertTrue(activity.createSecureBridgeCalled);
            assertNull(shadowActivity.getNextStartedActivity());
            assertFalse(activity.isFinishing());
        }
    }

    @Test
    public void failedBridgeWebViewIsDetachedBeforeDestroy() {
        Context context = RuntimeEnvironment.getApplication();
        FrameLayout root = new FrameLayout(context);
        FrameLayout container = new FrameLayout(context);
        RecordingWebView webView = new RecordingWebView(context);

        root.addView(container);
        container.addView(webView);

        MainActivity.destroyUntrustedWebViews(root);

        assertTrue(webView.destroyCalled);
        assertNull(webView.parentAtDestroy);
        assertNull(webView.getParent());
    }

    private static void assertCompatibilityActivityStarted(MainActivity activity) {
        ShadowActivity shadowActivity = org.robolectric.Shadows.shadowOf(activity);
        Intent nextIntent = shadowActivity.getNextStartedActivity();

        assertNotNull(nextIntent);
        assertEquals(WebViewCompatibilityActivity.class.getName(), nextIntent.getComponent().getClassName());
        assertNull(shadowActivity.getNextStartedActivity());
        assertTrue(activity.isFinishing());
    }

    public static final class MissingBridgeLoadMainActivity extends MainActivity {
        @Override
        protected void load() {}
    }

    public static final class ListenerFailureMainActivity extends MainActivity {
        @Override
        boolean isSecureWebViewBridgeAvailable() {
            return true;
        }

        @Override
        void createSecureBridge() {
            throw new IllegalStateException(SecureWebViewBridgeSupport.INSTALLATION_FAILURE_MESSAGE);
        }
    }

    public static final class UnavailableBridgeMainActivity extends MainActivity {
        private boolean createSecureBridgeCalled;

        @Override
        boolean isSecureWebViewBridgeAvailable() {
            return false;
        }

        @Override
        void createSecureBridge() {
            createSecureBridgeCalled = true;
        }
    }

    public static final class SupportedBridgeMainActivity extends MainActivity {
        private boolean createSecureBridgeCalled;

        @Override
        boolean isSecureWebViewBridgeAvailable() {
            return true;
        }

        @Override
        void createSecureBridge() {
            createSecureBridgeCalled = true;
        }
    }

    private static final class RecordingWebView extends WebView {
        private boolean destroyCalled;
        private ViewParent parentAtDestroy;

        RecordingWebView(Context context) {
            super(context);
        }

        @Override
        public void destroy() {
            destroyCalled = true;
            parentAtDestroy = getParent();
            super.destroy();
        }
    }
}
