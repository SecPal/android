/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  patchCapacitorBridgeCleanupSource,
  patchCapacitorLegacyInterfaceSource,
  patchCapacitorMessageHandlerSource,
  patchCapacitorAndroidSource,
  patchCapacitorAndroidSources,
} from "../scripts/patch-capacitor-android-unchecked.mjs";

const pluginPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Plugin.java";
const bridgeWebChromeClientPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java";
const messageHandlerPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java";
const bridgePath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java";
const retainedPluginPaths = [
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/CapacitorCookies.java",
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/CapacitorHttp.java",
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java",
];
const systemBarsPath = retainedPluginPaths[2];

function writeFixture(repoRoot: string, path: string, source: string) {
  const absolutePath = join(repoRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

describe("patchCapacitorAndroidSource", () => {
  it("reproduces and removes Capacitor's insecure message-handler fallback", () => {
    const source = `
import android.webkit.JavascriptInterface;

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && !bridge.getConfig().isUsingLegacyBridge()) {
            WebViewCompat.WebMessageListener capListener = (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (isMainFrame) {
                    postMessage(message.getData());
                    javaScriptReplyProxy = replyProxy;
                } else {
                    Logger.warn("Plugin execution is allowed in Main Frame only");
                }
            };
            try {
                WebViewCompat.addWebMessageListener(webView, "androidBridge", bridge.getAllowedOriginRules(), capListener);
            } catch (Exception ex) {
                webView.addJavascriptInterface(this, "androidBridge");
            }
        } else {
            webView.addJavascriptInterface(this, "androidBridge");
        }

@JavascriptInterface
public void postMessage(String jsonStr) {}
`;

    expect(source).toContain(
      'webView.addJavascriptInterface(this, "androidBridge")'
    );

    const patched = patchCapacitorMessageHandlerSource(source);

    expect(patched).not.toContain("addJavascriptInterface");
    expect(patched).not.toContain("@JavascriptInterface");
    expect(patched).toContain(
      "WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)"
    );
    expect(patched).toContain("bridge.getConfig().isUsingLegacyBridge()");
    expect(patched).toContain("bridge.getAllowedOriginRules()");
    expect(patched).toContain("if (isMainFrame)");
    expect(patched).toContain(
      'throw new IllegalStateException("Origin-aware WebView bridge is unavailable")'
    );
    expect(patched).toContain(
      'throw new IllegalStateException("Origin-aware WebView bridge installation failed", ex)'
    );
  });

  it("removes direct legacy interfaces from retained Capacitor plugins", () => {
    const source = `
import android.webkit.JavascriptInterface;

public void load() {
    this.bridge.getWebView().addJavascriptInterface(this, "CapacitorHttpAndroidInterface");
    super.load();
}

@JavascriptInterface
public boolean isEnabled() {
    return false;
}
`;

    const patched = patchCapacitorLegacyInterfaceSource(
      source,
      "CapacitorHttpAndroidInterface"
    );

    expect(patched).not.toContain("addJavascriptInterface");
    expect(patched).not.toContain("@JavascriptInterface");
    expect(patched).not.toContain("import android.webkit.JavascriptInterface;");
    expect(patched).toContain("public boolean isEnabled()");
  });

  it("preserves SystemBars DOM readiness without a JavaScript interface", () => {
    const source = `
import android.webkit.JavascriptInterface;

public void load() {
    this.bridge.getWebView().addJavascriptInterface(this, "CapacitorSystemBarsAndroidInterface");
    super.load();
}

this.getBridge().addWebViewListener(
    new WebViewListener() {
        @Override
        public void onPageCommitVisible(WebView view, String url) {
            super.onPageCommitVisible(view, url);
            getBridge().getWebView().requestApplyInsets();
        }
    }
);

@JavascriptInterface
public void onDOMReady() {}
`;

    const patched = patchCapacitorLegacyInterfaceSource(
      source,
      "CapacitorSystemBarsAndroidInterface"
    );

    expect(patched).not.toContain("addJavascriptInterface");
    expect(patched).not.toContain("@JavascriptInterface");
    expect(patched).toContain("public void onPageLoaded(WebView webView)");
    expect(patched).toContain("onDOMReady();");
  });

  it("fails closed when Capacitor's security-sensitive sources drift", () => {
    expect(() =>
      patchCapacitorMessageHandlerSource("unrecognized message handler")
    ).toThrow(
      "Expected Capacitor WebView message-handler source pattern was not found"
    );
    expect(() =>
      patchCapacitorLegacyInterfaceSource(
        "unrecognized HTTP plugin",
        "CapacitorHttpAndroidInterface"
      )
    ).toThrow(
      "Expected Capacitor legacy interface source pattern was not found for CapacitorHttpAndroidInterface"
    );
  });

  it("stops Capacitor's plugin thread when secure listener construction aborts", () => {
    const source =
      "        this.msgHandler = new MessageHandler(this, webView, pluginManager);";
    const patched = patchCapacitorBridgeCleanupSource(source);

    expect(patched).toContain("catch (RuntimeException exception)");
    expect(patched).toContain("handlerThread.quitSafely()");
    expect(patched).toContain("throw exception");
  });

  it("keeps the installed Capacitor bridge origin-aware and main-frame-only", () => {
    const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const messageHandler = readFileSync(
      join(repoRoot, messageHandlerPath),
      "utf8"
    );
    const bridge = readFileSync(join(repoRoot, bridgePath), "utf8");

    expect(messageHandler).toContain(
      "WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)"
    );
    expect(messageHandler).toContain("bridge.getAllowedOriginRules()");
    expect(messageHandler).toContain("if (isMainFrame)");
    expect(messageHandler).toContain(
      'throw new IllegalStateException("Origin-aware WebView bridge installation failed", ex)'
    );
    expect(messageHandler).not.toContain("addJavascriptInterface");
    expect(bridge).toContain("handlerThread.quitSafely()");

    for (const pluginPath of retainedPluginPaths) {
      const pluginSource = readFileSync(join(repoRoot, pluginPath), "utf8");

      expect(pluginSource).not.toContain("addJavascriptInterface");
      expect(pluginSource).not.toContain("@JavascriptInterface");
    }

    const systemBarsSource = readFileSync(
      join(repoRoot, systemBarsPath),
      "utf8"
    );
    expect(systemBarsSource).toContain(
      "public void onPageLoaded(WebView webView)"
    );
    expect(systemBarsSource).toContain("onDOMReady();");
  });

  it("parameterizes the raw Capacitor generics that emit unchecked warnings", () => {
    const source = [
      "CopyOnWriteArrayList<PluginCall> listenersCopy = new CopyOnWriteArrayList(listeners);",
      "private ActivityResultLauncher permissionLauncher;",
      "private ActivityResultLauncher activityLauncher;",
      "permissionLauncher.launch(permissions);",
      "activityLauncher.launch(intent);",
    ].join("\n");

    expect(patchCapacitorAndroidSource(source)).toBe(
      [
        "CopyOnWriteArrayList<PluginCall> listenersCopy = new CopyOnWriteArrayList<>(listeners);",
        "private ActivityResultLauncher<String[]> permissionLauncher;",
        "private ActivityResultLauncher<Intent> activityLauncher;",
        "permissionLauncher.launch(permissions);",
        "activityLauncher.launch(intent);",
      ].join("\n")
    );
  });

  it("fails closed when a supported Capacitor source no longer matches", () => {
    expect(() => patchCapacitorAndroidSource("unrecognized source")).toThrow(
      "Expected Capacitor unchecked Java source pattern was not found"
    );
  });

  it("fails closed when only part of the expected source matches", () => {
    expect(() =>
      patchCapacitorAndroidSource(
        "private ActivityResultLauncher permissionLauncher;"
      )
    ).toThrow("Expected Capacitor unchecked Java source pattern was not found");
  });

  it("validates every Capacitor source before writing any patched file", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "secpal-capacitor-patch-"));
    const pluginSource = "new CopyOnWriteArrayList(listeners)";

    try {
      writeFixture(repoRoot, pluginPath, pluginSource);
      writeFixture(repoRoot, bridgeWebChromeClientPath, "upstream drift");

      expect(() => patchCapacitorAndroidSources(repoRoot)).toThrow(
        "Expected Capacitor unchecked Java source pattern was not found"
      );
      expect(readFileSync(join(repoRoot, pluginPath), "utf8")).toBe(
        pluginSource
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
