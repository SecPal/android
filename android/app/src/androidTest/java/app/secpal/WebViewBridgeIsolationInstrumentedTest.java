/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class WebViewBridgeIsolationInstrumentedTest {
    private static final String CONTROLLED_PAGE_URL = "https://app.secpal.dev/bridge-isolation-test.html#";
    private static final long TIMEOUT_SECONDS = 30L;
    private static final String TEST_RESULT_OBJECT = "secpalTestResult";

    @Before
    public void requireOriginAwareBridgeSupport() {
        Assume.assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
    }

    @Test
    public void trustedPackagedMainFrameCanInvokeRetainedNativePlugin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "main");

            assertEquals("main-type:object", results.await());
            assertEquals("main-reply", results.await());
        }
    }

    @Test
    public void trustedChildFrameCannotInvokeRetainedNativePlugin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "child");

            assertEquals("child-type:object", results.await());
            assertNull(results.poll(1L, TimeUnit.SECONDS));
        }
    }

    @Test
    public void foreignOriginDoesNotReceiveNativeBridge() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "foreign");

            assertEquals("foreign-type:undefined", results.await());
        }
    }

    @Test
    public void directLegacyInterfacesRemainUnavailable() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "legacy");

            assertEquals(
                "legacy-types:undefined,undefined,undefined,undefined",
                results.await()
            );
        }
    }

    private static ResultCollector loadControlledPage(
        ActivityScenario<MainActivity> scenario,
        String mode
    ) {
        ResultCollector results = new ResultCollector();
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridge().getWebView();
            WebViewCompat.addWebMessageListener(
                webView,
                TEST_RESULT_OBJECT,
                Collections.singleton("*"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> results.add(message.getData())
            );
            webView.loadUrl(CONTROLLED_PAGE_URL + mode);
        });
        return results;
    }

    private static final class ResultCollector {
        private final LinkedBlockingQueue<String> messages = new LinkedBlockingQueue<>();

        void add(String message) {
            messages.add(message);
        }

        String await() throws InterruptedException {
            return poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        String poll(long timeout, TimeUnit unit) throws InterruptedException {
            return messages.poll(timeout, unit);
        }
    }
}
