/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
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
    private static final String TEST_RESULT_OBJECT = "secpalTestResult";

    @Before
    public void requireOriginAwareBridgeSupport() {
        Assume.assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));
        CountingEnterprisePlugin.resetInvocations();
    }

    @Test
    public void trustedPackagedMainFrameCanInvokeRetainedNativePlugin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "main");

            assertResult(results.await(), "main-type:object", true, true);
            assertResult(results.await(), "main-reply", true, true);
        }
    }

    @Test
    public void trustedChildFrameCannotInvokeRetainedNativePlugin() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "child");

            assertResult(results.await(), "child-type:object", false, false);
            assertResult(results.await(), "child-barrier", true, true);
            List<String> invocations = CountingEnterprisePlugin.invocations();
            assertTrue(invocations.contains("barrier"));
            assertFalse(invocations.contains("child"));
        }
    }

    @Test
    public void foreignOriginDoesNotReceiveNativeBridge() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "foreign");

            assertResult(results.await(), "foreign-type:undefined", true, true);
        }
    }

    @Test
    public void directLegacyInterfacesRemainUnavailable() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ResultCollector results = loadControlledPage(scenario, "legacy");

            assertResult(
                results.await(),
                "legacy-types:undefined,undefined,undefined,undefined",
                true,
                true
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
            if ("child".equals(mode)) {
                activity.getBridge().registerPlugin(CountingEnterprisePlugin.class);
            }
            WebViewCompat.addWebMessageListener(
                webView,
                TEST_RESULT_OBJECT,
                Collections.singleton("*"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) ->
                    results.add(webView, view, message.getData(), sourceOrigin.toString(), isMainFrame, replyProxy)
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
        assertNotNull(result.replyProxy);
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

    private static final class ResultCollector {
        private final LinkedBlockingQueue<BridgeResult> messages = new LinkedBlockingQueue<>();

        void add(
            WebView expectedView,
            WebView actualView,
            String message,
            String sourceOrigin,
            boolean mainFrame,
            JavaScriptReplyProxy replyProxy
        ) {
            messages.add(new BridgeResult(expectedView, actualView, message, sourceOrigin, mainFrame, replyProxy));
        }

        BridgeResult await() throws InterruptedException {
            return poll(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        BridgeResult poll(long timeout, TimeUnit unit) throws InterruptedException {
            return messages.poll(timeout, unit);
        }
    }

    private static final class BridgeResult {
        private final WebView expectedView;
        private final WebView actualView;
        private final String message;
        private final String sourceOrigin;
        private final boolean mainFrame;
        private final JavaScriptReplyProxy replyProxy;

        BridgeResult(
            WebView expectedView,
            WebView actualView,
            String message,
            String sourceOrigin,
            boolean mainFrame,
            JavaScriptReplyProxy replyProxy
        ) {
            this.expectedView = expectedView;
            this.actualView = actualView;
            this.message = message;
            this.sourceOrigin = sourceOrigin;
            this.mainFrame = mainFrame;
            this.replyProxy = replyProxy;
        }
    }
}
