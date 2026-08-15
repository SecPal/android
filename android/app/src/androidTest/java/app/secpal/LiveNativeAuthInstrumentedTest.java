/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.widget.Button;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.PluginHandle;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LiveNativeAuthInstrumentedTest {
    private static final long TIMEOUT_SECONDS = 30L;

    @Test
    public void liveRuntimeLoginKeepsPushIdentityBehindNativeBoundary() throws Exception {
        String email = InstrumentationRegistry.getArguments().getString("secpalTestEmail", "");
        String password = InstrumentationRegistry
            .getArguments()
            .getString("secpalTestPassword", "");
        String runtimeUrl = InstrumentationRegistry
            .getArguments()
            .getString("secpalRuntimeUrl", "https://api.secpal.dev");
        Assume.assumeTrue(!email.isEmpty() && !password.isEmpty());
        Assume.assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER));

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            assertEquals(
                "\"discovery-ready\"",
                awaitJavascriptResult(
                    scenario,
                    "document.getElementById('secpal-instance-discovery-url') " +
                    "? 'discovery-ready' : null"
                )
            );
            assertEquals(
                "\"validation-started\"",
                awaitJavascriptResult(
                    scenario,
                    buildSetControlAndClickScript(
                        "secpal-instance-discovery-url",
                        runtimeUrl,
                        "secpal-instance-discovery-validate",
                        "validation-started"
                    )
                )
            );
            assertEquals(
                "\"runtime-ready\"",
                awaitJavascriptResult(
                    scenario,
                    "(function () {" +
                    "var error = document.getElementById('secpal-instance-discovery-error');" +
                    "if (error && error.innerText.trim()) { return 'runtime-error'; }" +
                    "var confirm = document.getElementById('secpal-instance-discovery-confirm');" +
                    "return confirm && !confirm.disabled ? 'runtime-ready' : null;" +
                    "})()"
                )
            );
            assertEquals(
                "\"confirmation-started\"",
                awaitJavascriptResult(
                    scenario,
                    "(function () {" +
                    "var confirm = document.getElementById('secpal-instance-discovery-confirm');" +
                    "if (!confirm || confirm.disabled) { return null; }" +
                    "confirm.click();" +
                    "return 'confirmation-started';" +
                    "})()"
                )
            );
            clickNativeContinue(scenario);

            assertEquals(
                "\"login-ready\"",
                awaitJavascriptResult(
                    scenario,
                    "document.getElementById('email') && document.getElementById('password') " +
                    "? 'login-ready' : null"
                )
            );
            assertEquals(
                "\"login-started\"",
                awaitJavascriptResult(scenario, buildSubmitLoginScript(email, password))
            );
            String loginResult = awaitJavascriptResult(
                scenario,
                "(function () {" +
                "var error = document.getElementById('login-error');" +
                "if (error && error.innerText.trim()) { return 'login-error'; }" +
                "return window.__SecPalNativeAuthState && " +
                "window.__SecPalNativeAuthState.active === true ? 'login-complete' : null;" +
                "})()"
            );
            boolean loginCompleted = "\"login-complete\"".equals(loginResult);
            assertEquals("\"login-complete\"", loginResult);
            try {
                assertEquals(
                    "\"push:registered,true,true,none\"",
                    awaitAbstractPushStatus(scenario, "registered")
                );

                assertEquals(
                    "\"logout-started\"",
                    awaitJavascriptResult(
                        scenario,
                        startLogoutScript()
                    )
                );
                assertEquals(
                    "\"logout-complete\"",
                    awaitJavascriptResult(scenario, "window.__secpalLiveLogout")
                );
                loginCompleted = false;
                assertEquals(
                    "\"push:awaiting_auth,true,true,none\"",
                    awaitAbstractPushStatus(scenario, "awaiting_auth")
                );
            } finally {
                if (loginCompleted) {
                    bestEffortLogout(scenario);
                }
            }
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private static String startLogoutScript() {
        return "(function () {" +
            "window.__secpalLiveLogout = null;" +
            "Promise.resolve(window.SecPalNativeAuthBridge.logout())" +
            ".then(function () { window.__secpalLiveLogout = 'logout-complete'; })" +
            ".catch(function () { window.__secpalLiveLogout = 'logout-error'; });" +
            "return 'logout-started';" +
            "})()";
    }

    private static void bestEffortLogout(
        ActivityScenario<MainActivity> scenario
    ) {
        try {
            awaitJavascriptResult(scenario, startLogoutScript());
            awaitJavascriptResult(scenario, "window.__secpalLiveLogout");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException | AssertionError ignored) {
            // Preserve the original test failure while attempting session cleanup.
        }
    }

    private static String buildSetControlAndClickScript(
        String controlId,
        String value,
        String buttonId,
        String result
    ) {
        return "(function () {" +
            "var control = document.getElementById(" + JSONObject.quote(controlId) + ");" +
            "var button = document.getElementById(" + JSONObject.quote(buttonId) + ");" +
            "if (!control || !button) { return null; }" +
            "var setter = Object.getOwnPropertyDescriptor(" +
            "window.HTMLInputElement.prototype, 'value').set;" +
            "setter.call(control, " + JSONObject.quote(value) + ");" +
            "control.dispatchEvent(new Event('input', { bubbles: true }));" +
            "control.dispatchEvent(new Event('change', { bubbles: true }));" +
            "if (button.disabled) { return null; }" +
            "button.click();" +
            "return " + JSONObject.quote(result) + ";" +
            "})()";
    }

    private static void clickNativeContinue(
        ActivityScenario<MainActivity> scenario
    ) throws InterruptedException {
        AtomicBoolean clicked = new AtomicBoolean(false);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS);
        while (!clicked.get() && System.nanoTime() < deadline) {
            scenario.onActivity(activity -> {
                PluginHandle handle = activity.getBridge().getPlugin("SecPalNativeAuth");
                if (handle == null
                    || !(handle.getInstance() instanceof SecPalNativeAuthPlugin)) {
                    return;
                }
                AlertDialog dialog = ((SecPalNativeAuthPlugin) handle.getInstance())
                    .getActiveRuntimeConfirmationDialog();
                Button button = dialog == null
                    ? null
                    : dialog.getButton(DialogInterface.BUTTON_POSITIVE);
                if (button != null
                    && button.isShown()
                    && "Continue".contentEquals(button.getText())) {
                    button.performClick();
                    clicked.set(true);
                }
            });
            if (!clicked.get()) {
                Thread.sleep(100L);
            }
        }
        assertTrue("Native runtime confirmation was not available", clicked.get());
    }

    private static String buildSubmitLoginScript(String email, String password) {
        return "(function () {" +
            "var email = document.getElementById('email');" +
            "var password = document.getElementById('password');" +
            "if (!email || !password) { return null; }" +
            "var setter = Object.getOwnPropertyDescriptor(" +
            "window.HTMLInputElement.prototype, 'value').set;" +
            "setter.call(email, " + JSONObject.quote(email) + ");" +
            "email.dispatchEvent(new Event('input', { bubbles: true }));" +
            "email.dispatchEvent(new Event('change', { bubbles: true }));" +
            "setter.call(password, " + JSONObject.quote(password) + ");" +
            "password.dispatchEvent(new Event('input', { bubbles: true }));" +
            "password.dispatchEvent(new Event('change', { bubbles: true }));" +
            "var form = email.closest('form');" +
            "var submit = form && form.querySelector('button[type=submit]');" +
            "if (!form || !submit || submit.disabled) { return null; }" +
            "form.requestSubmit(submit);" +
            "return 'login-started';" +
            "})()";
    }

    private static String awaitAbstractPushStatus(
        ActivityScenario<MainActivity> scenario,
        String expectedState
    ) throws Exception {
        assertEquals(
            "\"push-read-started\"",
            awaitJavascriptResult(
                scenario,
                "(function () {" +
                "window.__secpalLivePush = null;" +
                "var readPushStatus = function () {" +
                "Promise.resolve(window.SecPalNativeAuthBridge" +
                ".getAndroidPushRegistrationState()).then(function (status) {" +
                "if (status.state !== " + JSONObject.quote(expectedState) + " &&" +
                "status.state !== 'retry_pending' &&" +
                "status.state !== 'reconfiguration_required' &&" +
                "status.state !== 'disabled') {" +
                "setTimeout(readPushStatus, 250);" +
                "return;" +
                "}" +
                "var fieldsClean = Object.keys(status).every(function (key) {" +
                "return !/(token|installation|timestamp|payload|apiOrigin|metadataRevision)/i" +
                ".test(key);" +
                "});" +
                "window.__secpalLivePush = 'push:' + status.state + ',' +" +
                "status.configured + ',' + fieldsClean + ',' +" +
                "(status.failureCode || 'none');" +
                "})" +
                ".catch(function () { window.__secpalLivePush = 'push-error'; });" +
                "};" +
                "readPushStatus();" +
                "return 'push-read-started';" +
                "})()"
            )
        );
        return awaitJavascriptResult(scenario, "window.__secpalLivePush");
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
}
