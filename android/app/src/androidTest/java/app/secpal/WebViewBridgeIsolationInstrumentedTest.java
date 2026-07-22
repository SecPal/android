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

import android.webkit.WebView;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PluginMethodHandle;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class WebViewBridgeIsolationInstrumentedTest {
    private static final String CONTROLLED_ORIGIN = "https://app.secpal.dev";
    private static final String CONTROLLED_PAGE_URL = CONTROLLED_ORIGIN + "/bridge-isolation-test.html#";
    private static final long TIMEOUT_SECONDS = 30L;
    private static final long TEARDOWN_TIMEOUT_SECONDS = 10L;
    private static final String TEST_RESULT_OBJECT = "secpalTestResult";

    @Before
    public void requireOriginAwareBridgeSupport() {
        Assume.assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
        CountingEnterprisePlugin.resetInvocations();
    }

    @Test
    public void trustedPackagedMainFrameCanInvokeRetainedNativePlugin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try (ResultCollector results = loadControlledPage(scenario, "main")) {
                assertResult(results.await(), "main-type:object", true, true);
                assertResult(results.await(), "main-reply", true, true);
            }
        }
    }

    @Test
    public void trustedChildFrameCannotInvokeRetainedNativePlugin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.moveToState(Lifecycle.State.CREATED);
            try (ResultCollector results = loadControlledPage(scenario, "child")) {
                scenario.moveToState(Lifecycle.State.RESUMED);

                assertResult(results.await(), "child-type:object", false, true);
                assertResult(results.await(), "child-barrier", true, true);
                List<String> invocations = CountingEnterprisePlugin.invocations();
                assertTrue(invocations.contains("barrier"));
                assertFalse(invocations.contains("child"));
            }
        }
    }

    @Test
    public void foreignOriginDoesNotReceiveNativeBridge() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try (ResultCollector results = loadControlledPage(scenario, "foreign")) {
                assertResult(results.await(), "foreign-type:undefined", true, true);
            }
        }
    }

    @Test
    public void directLegacyInterfacesRemainUnavailable() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try (ResultCollector results = loadControlledPage(scenario, "legacy")) {
                assertResult(
                    results.await(),
                    "legacy-types:undefined,undefined,undefined,undefined",
                    true,
                    true
                );
            }
        }
    }

    @Test
    public void unusedCorePluginsAreAbsentFromTheNativeRegistry() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNull(activity.getBridge().getPlugin("CapacitorCookies"));
                assertNull(activity.getBridge().getPlugin("CapacitorHttp"));
                assertNull(activity.getBridge().getPlugin("WebView"));
                assertNotNull(activity.getBridge().getPlugin("SecPalNativeAuth"));
                assertNotNull(activity.getBridge().getPlugin("SecPalEnterprise"));

                PluginHandle systemBars = activity.getBridge().getPlugin("SystemBars");
                assertNotNull(systemBars);
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
    }

    @Test
    public void packagedWebViewCannotInvokeForbiddenCorePlugins() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            try (ResultCollector results = loadControlledPage(scenario, "core")) {
                assertResult(results.await(), "core-surface:true,true,true,true", true, true);
                assertResult(results.await(), "core-raw-missing:true,true,true,true,true,true", true, true);
            }
        }
    }

    private static ResultCollector loadControlledPage(
        ActivityScenario<MainActivity> scenario,
        String mode
    ) {
        ResultCollector results = new ResultCollector(scenario);
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridge().getWebView();
            if ("child".equals(mode)) {
                activity.getBridge().registerPluginInstance(new CountingEnterprisePlugin());
            }
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

    @CapacitorPlugin(name = "SecPalEnterprise")
    public static final class CountingEnterprisePlugin extends SecPalEnterprisePlugin {
        private static final List<String> INVOCATIONS = Collections.synchronizedList(new ArrayList<>());

        @Override
        @PluginMethod
        public void getManagedState(PluginCall call) {
            INVOCATIONS.add(call.getCallbackId());
            call.resolve(new JSObject());
        }

        static void resetInvocations() {
            INVOCATIONS.clear();
        }

        static List<String> invocations() {
            synchronized (INVOCATIONS) {
                return new ArrayList<>(INVOCATIONS);
            }
        }
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
