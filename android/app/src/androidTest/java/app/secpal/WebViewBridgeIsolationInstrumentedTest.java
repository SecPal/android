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

import android.content.Intent;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethodHandle;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class WebViewBridgeIsolationInstrumentedTest {
    private static final String CONTROLLED_ORIGIN = "https://app.secpal.dev";
    private static final String CONTROLLED_PAGE_URL = CONTROLLED_ORIGIN + "/bridge-isolation-test.html#";
    private static final long TIMEOUT_SECONDS = 30L;
    private static final long TEARDOWN_TIMEOUT_SECONDS = 10L;
    private static final String TEST_RESULT_OBJECT = "secpalTestResult";

    // AndroidX finishes activities between JUnit methods. Keep these assertions in one
    // WebView session to avoid rapid native WebView destruction and recreation on older devices.
    @Test
    public void allBridgeIsolationGuaranteesHoldInSingleWebViewSession() throws Exception {
        Assume.assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
        Intent intent = new Intent(
            ApplicationProvider.getApplicationContext(),
            MainActivity.class
        );
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(intent)) {
            assertPackagedFrontendCannotExposeForbiddenNativePlugins(scenario);
            assertUnusedCorePluginsAreAbsentFromTheNativeRegistry(scenario);
            assertTrustedPackagedMainFrameCanInvokeRetainedNativePlugin(scenario);
            assertTrustedChildFrameCannotInvokeRetainedNativePlugin(scenario);
            assertForeignOriginDoesNotReceiveNativeBridge(scenario);
            assertDirectLegacyInterfacesRemainUnavailable(scenario);
            assertPackagedWebViewCannotInvokeForbiddenCorePlugins(scenario);
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private static void assertTrustedPackagedMainFrameCanInvokeRetainedNativePlugin(
        ActivityScenario<MainActivity> scenario
    ) throws Exception {
        try (ResultCollector results = loadControlledPage(scenario, "main")) {
            assertResult(results.await(), "main-type:object", true, true);
            assertResult(results.await(), "main-reply", true, true);
        }
    }

    private static void assertTrustedChildFrameCannotInvokeRetainedNativePlugin(
        ActivityScenario<MainActivity> scenario
    ) throws Exception {
        try (ResultCollector results = loadControlledPage(scenario, "child")) {
            assertResult(results.await(), "child-type:object", false, true);
            assertResult(results.await(), "child-barrier", true, true);
            assertNull(
                "Child frame unexpectedly received a native plugin reply",
                results.poll(1L, TimeUnit.SECONDS)
            );
        }
    }

    private static void assertForeignOriginDoesNotReceiveNativeBridge(
        ActivityScenario<MainActivity> scenario
    ) throws Exception {
        try (ResultCollector results = loadControlledPage(scenario, "foreign")) {
            assertResult(results.await(), "foreign-type:undefined", true, true);
        }
    }

    private static void assertDirectLegacyInterfacesRemainUnavailable(
        ActivityScenario<MainActivity> scenario
    ) throws Exception {
        try (ResultCollector results = loadControlledPage(scenario, "legacy")) {
            assertResult(
                results.await(),
                "legacy-types:undefined,undefined,undefined,undefined",
                true,
                true
            );
        }
    }

    private static void assertUnusedCorePluginsAreAbsentFromTheNativeRegistry(
        ActivityScenario<MainActivity> scenario
    ) {
        scenario.onActivity(activity -> {
            assertNull(activity.getBridge().getPlugin("CapacitorCookies"));
            assertNull(activity.getBridge().getPlugin("CapacitorHttp"));
            assertNull(activity.getBridge().getPlugin("WebView"));
            assertNotNull(activity.getBridge().getPlugin("SecPalNativeAuth"));
            assertNotNull(activity.getBridge().getPlugin("SecPalEnterprise"));

            PluginHandle systemBars = activity.getBridge().getPlugin("SystemBars");
            assertNotNull(systemBars);
            assertNotNull(systemBars.getInstance());
            List<String> methodNames = new ArrayList<>();
            for (PluginMethodHandle method : systemBars.getMethods()) {
                methodNames.add(method.getName());
            }
            assertFalse(methodNames.contains("setStyle"));
            assertFalse(methodNames.contains("show"));
            assertFalse(methodNames.contains("hide"));
            assertFalse(methodNames.contains("setAnimation"));
        });
    }

    private static void assertPackagedWebViewCannotInvokeForbiddenCorePlugins(
        ActivityScenario<MainActivity> scenario
    ) throws Exception {
        try (ResultCollector results = loadControlledPage(scenario, "core")) {
            assertResult(results.await(), "core-surface:true,true,true", true, true);
            assertResult(results.await(), "core-raw-missing:true,true,true,true,true,true", true, true);
        }
    }

    private static void assertPackagedFrontendCannotExposeForbiddenNativePlugins(
        ActivityScenario<MainActivity> scenario
    ) throws Exception {
        String script =
            "(function () {" +
            "var capacitor = window.Capacitor;" +
            "if (!capacitor || !Array.isArray(capacitor.PluginHeaders) || " +
            "typeof capacitor.isPluginAvailable !== 'function') { return null; }" +
            "var pluginIds = ['CapacitorCookies', 'CapacitorHttp', 'WebView', 'SystemBars'];" +
            "var headersAbsent = pluginIds.every(function (pluginId) {" +
            "return !capacitor.PluginHeaders.some(function (header) { return header.name === pluginId; });" +
            "});" +
            "var nativePluginsUnavailable = pluginIds.every(function (pluginId) {" +
            "return !capacitor.isPluginAvailable(pluginId);" +
            "});" +
            "return 'packaged-core:' + headersAbsent + ',' + nativePluginsUnavailable;" +
            "})()";

        assertEquals(
            "\"packaged-core:true,true\"",
            awaitJavascriptResult(scenario, script)
        );
    }

    private static String awaitJavascriptResult(
        ActivityScenario<MainActivity> scenario,
        String script
    ) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);

        while (System.nanoTime() < deadline) {
            LinkedBlockingQueue<String> results = new LinkedBlockingQueue<>();
            scenario.onActivity(activity ->
                activity.getBridge().getWebView().evaluateJavascript(script, results::add)
            );
            String result = results.poll(1L, TimeUnit.SECONDS);
            if (result != null && !"null".equals(result)) {
                return result;
            }
        }

        return null;
    }

    private static ResultCollector loadControlledPage(
        ActivityScenario<MainActivity> scenario,
        String mode
    ) {
        ResultCollector results = new ResultCollector(scenario);
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridge().getWebView();
            WebViewCompat.addWebMessageListener(
                webView,
                TEST_RESULT_OBJECT,
                Collections.singleton("*"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) ->
                    results.add(
                        webView,
                        view,
                        message.getData(),
                        sourceOrigin.toString(),
                        isMainFrame,
                        replyProxy != null
                    )
            );
            webView.loadUrl(CONTROLLED_PAGE_URL + mode);
        });
        return results;
    }

    private static void assertResult(
        BridgeResult result,
        String message,
        boolean mainFrame,
        boolean trustedOrigin
    ) {
        assertNotNull(result);
        assertEquals(message, result.message);
        assertTrue(result.expectedView == result.actualView);
        assertEquals(mainFrame, result.mainFrame);
        assertEquals(trustedOrigin, CONTROLLED_ORIGIN.equals(result.sourceOrigin));
        assertTrue(result.replyProxyAvailable);
    }

    private static final class ResultCollector implements AutoCloseable {
        private final ActivityScenario<MainActivity> scenario;
        private final LinkedBlockingQueue<BridgeResult> messages = new LinkedBlockingQueue<>();

        ResultCollector(ActivityScenario<MainActivity> scenario) {
            this.scenario = scenario;
        }

        void add(
            WebView expectedView,
            WebView actualView,
            String message,
            String sourceOrigin,
            boolean mainFrame,
            boolean replyProxyAvailable
        ) {
            messages.add(
                new BridgeResult(
                    expectedView,
                    actualView,
                    message,
                    sourceOrigin,
                    mainFrame,
                    replyProxyAvailable
                )
            );
        }

        BridgeResult await() throws InterruptedException {
            return poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        BridgeResult poll(long timeout, TimeUnit unit) throws InterruptedException {
            return messages.poll(timeout, unit);
        }

        @Override
        public void close() throws InterruptedException {
            CountDownLatch teardownReady = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                WebView webView = activity.getBridge().getWebView();
                WebViewCompat.removeWebMessageListener(
                    webView,
                    TEST_RESULT_OBJECT
                );
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.postVisualStateCallback(
                    0L,
                    new WebView.VisualStateCallback() {
                        @Override
                        public void onComplete(long requestId) {
                            teardownReady.countDown();
                        }
                    }
                );
            });
            assertTrue(
                "WebView did not reach a quiescent teardown state",
                teardownReady.await(TEARDOWN_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            );
            messages.clear();
        }
    }

    private static final class BridgeResult {
        private final WebView expectedView;
        private final WebView actualView;
        private final String message;
        private final String sourceOrigin;
        private final boolean mainFrame;
        private final boolean replyProxyAvailable;

        BridgeResult(
            WebView expectedView,
            WebView actualView,
            String message,
            String sourceOrigin,
            boolean mainFrame,
            boolean replyProxyAvailable
        ) {
            this.expectedView = expectedView;
            this.actualView = actualView;
            this.message = message;
            this.sourceOrigin = sourceOrigin;
            this.mainFrame = mainFrame;
            this.replyProxyAvailable = replyProxyAvailable;
        }
    }
}
