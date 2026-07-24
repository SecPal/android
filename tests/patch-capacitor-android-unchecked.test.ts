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
  patchCapacitorCorePluginRegistrationSource,
  patchCapacitorPluginExportSource,
  patchCapacitorSystemBarsDispatchSource,
  patchCapacitorLegacyInterfaceSource,
  patchCapacitorMessageHandlerSource,
  patchCapacitorAndroidSource,
  patchCapacitorAndroidSources,
  patchSystemBarsCallableSurfaceSource,
} from "../scripts/patch-capacitor-android-unchecked.mjs";

const pluginPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Plugin.java";
const bridgeWebChromeClientPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java";
const messageHandlerPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java";
const bridgePath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java";
const failClosedMessageHandlerConstruction = `        try {
            this.msgHandler = new MessageHandler(this, webView, pluginManager);
        } catch (RuntimeException exception) {
            handlerThread.quitSafely();
            throw exception;
        }`;
const hardenedSystemBarsDispatch = `    public void callPluginMethod(String pluginId, final String methodName, final PluginCall call) {
        if ("SystemBars".equals(pluginId)) {
            Logger.error("unable to find plugin : " + pluginId);
            call.errorCallback("unable to find plugin : " + pluginId);
            return;
        }

        try {
            final PluginHandle plugin = this.getPlugin(pluginId);`;
const retainedPluginPaths = [
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/CapacitorCookies.java",
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/CapacitorHttp.java",
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java",
];
const systemBarsPath = retainedPluginPaths[2];
const upstreamCorePluginRegistration = `        this.registerPlugin(com.getcapacitor.plugin.CapacitorCookies.class);
        this.registerPlugin(com.getcapacitor.plugin.WebView.class);
        this.registerPlugin(com.getcapacitor.plugin.CapacitorHttp.class);
        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);`;

const corePluginRegistrationPattern = (pluginId: string) =>
  new RegExp(
    `\\bregisterPlugin\\s*\\(\\s*(?:com\\.getcapacitor\\.plugin\\.)?${pluginId}\\s*\\.\\s*class\\b`
  );
const PLUGIN_METHOD_ANNOTATION_PATTERN =
  /@(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*PluginMethod\b/;

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
    expect(patched).toContain("final boolean webMessageListenerSupported;");
    expect(patched).toContain("catch (RuntimeException exception)");
    expect(patched).toContain(
      'throw new IllegalStateException("Origin-aware WebView bridge is unavailable", exception)'
    );
    expect(patched.indexOf("javaScriptReplyProxy = replyProxy;")).toBeLessThan(
      patched.indexOf("postMessage(message.getData());")
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

  it("removes unused core plugins at Capacitor's native registration boundary", () => {
    const source = `
    private void registerAllPlugins() {
${upstreamCorePluginRegistration}

        for (Class<? extends Plugin> pluginClass : this.initialPlugins) {
            this.registerPlugin(pluginClass);
        }
    }
`;

    expect(source).toContain("CapacitorCookies.class");
    expect(source).toContain("WebView.class");
    expect(source).toContain("CapacitorHttp.class");

    const patched = patchCapacitorCorePluginRegistrationSource(source);

    expect(patched).not.toContain("CapacitorCookies.class");
    expect(patched).not.toContain("WebView.class");
    expect(patched).not.toContain("CapacitorHttp.class");
    expect(patched).toContain(
      "this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);"
    );
    expect(patched).toContain(
      "SecPal: retain SystemBars for native lifecycle behavior only."
    );
    expect(patchCapacitorCorePluginRegistrationSource(patched)).toBe(patched);
  });

  it("rejects formatting drift that leaves forbidden core plugins registered", () => {
    const driftedRegistrations = [
      "this.registerPlugin( com.getcapacitor.plugin.CapacitorCookies.class);",
      "registerPlugin(com.getcapacitor.plugin.WebView.class);",
      "this.registerPlugin(com.getcapacitor.plugin.CapacitorHttp . class);",
    ];

    for (const registration of driftedRegistrations) {
      const source = `
    private void registerAllPlugins() {
        ${registration}
        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);
    }
`;

      expect(() => patchCapacitorCorePluginRegistrationSource(source)).toThrow(
        "Forbidden Capacitor core plugin registration remains"
      );
    }
  });

  it("rejects an ambiguous markerless core registration state", () => {
    const source = `
    private void registerAllPlugins() {
        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);
    }
`;

    expect(() => patchCapacitorCorePluginRegistrationSource(source)).toThrow(
      "Expected Capacitor core plugin registration pattern was not found"
    );
  });

  it("upgrades the exact previously hardened core registration state", () => {
    const source = `
${failClosedMessageHandlerConstruction}

${hardenedSystemBarsDispatch}

    private void registerAllPlugins() {
        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);
    }
`;

    const patched = patchCapacitorCorePluginRegistrationSource(source);

    expect(patched).toContain(
      "SecPal: retain SystemBars for native lifecycle behavior only."
    );
    expect(patchCapacitorCorePluginRegistrationSource(patched)).toBe(patched);
  });

  it("rejects incomplete or duplicated previous hardening markers", () => {
    const retainedRegistration = `
    private void registerAllPlugins() {
        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);
    }
`;
    const ambiguousSources = [
      `${failClosedMessageHandlerConstruction}\n${retainedRegistration}`,
      `${hardenedSystemBarsDispatch}\n${retainedRegistration}`,
      `${failClosedMessageHandlerConstruction}\n${hardenedSystemBarsDispatch}\n${retainedRegistration}\nthis.registerPlugin(SystemBars.class);`,
    ];

    for (const source of ambiguousSources) {
      expect(() => patchCapacitorCorePluginRegistrationSource(source)).toThrow(
        "Expected Capacitor core plugin registration pattern was not found"
      );
    }
  });

  it("fails closed when a forbidden core registration is reformatted", () => {
    const source = `
    private void registerAllPlugins() {
        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);
        this.registerPlugin(
            com.getcapacitor.plugin.CapacitorHttp.class
        );
    }
`;

    expect(() => patchCapacitorCorePluginRegistrationSource(source)).toThrow(
      "Forbidden Capacitor core plugin registration remains"
    );
  });

  it("retains SystemBars lifecycle behavior without exporting plugin methods", () => {
    const source = `
import com.getcapacitor.PluginMethod;

@PluginMethod
public void setStyle(final PluginCall call) {}

@PluginMethod
public void show(final PluginCall call) {}

@PluginMethod
public void hide(final PluginCall call) {}

@PluginMethod
public void setAnimation(final PluginCall call) {}
`;

    const patched = patchSystemBarsCallableSurfaceSource(source);

    expect(patched).not.toContain("import com.getcapacitor.PluginMethod;");
    expect(patched).not.toContain("@PluginMethod");
    expect(patched).toContain("public void setStyle(final PluginCall call)");
    expect(patched).toContain("public void show(final PluginCall call)");
    expect(patched).toContain("public void hide(final PluginCall call)");
    expect(patched).toContain(
      "public void setAnimation(final PluginCall call)"
    );
  });

  it("rejects fully qualified SystemBars plugin method annotations", () => {
    const source = `
@com.getcapacitor.PluginMethod
public void setStyle(final PluginCall call) {}

@com.getcapacitor.PluginMethod
public void show(final PluginCall call) {}

@com.getcapacitor.PluginMethod
public void hide(final PluginCall call) {}

@com.getcapacitor.PluginMethod
public void setAnimation(final PluginCall call) {}
`;

    expect(() => patchSystemBarsCallableSurfaceSource(source)).toThrow(
      "Expected Capacitor SystemBars plugin methods were not found"
    );
  });

  it("keeps SystemBars out of generated plugin headers and proxies", () => {
    const source = `
        for (PluginHandle plugin : plugins) {
            lines.add(
`;

    const patched = patchCapacitorPluginExportSource(source);

    expect(patched).toContain('if (plugin.getId().equals("SystemBars"))');
    expect(patched).toContain("continue;");
  });

  it("rejects additional unfiltered plugin export loops", () => {
    const additionalLoops = [
      "for (PluginHandle plugin : additionalPlugins)",
      "for (final PluginHandle plugin : additionalPlugins)",
      "for (@NonNull final com.getcapacitor.PluginHandle plugin : additionalPlugins)",
    ];

    for (const additionalLoop of additionalLoops) {
      const source = `
        for (PluginHandle plugin : plugins) {
            if (plugin.getId().equals("SystemBars")) {
                continue;
            }

            lines.add(

        ${additionalLoop} {
            lines.add(
`;

      expect(() => patchCapacitorPluginExportSource(source)).toThrow(
        "Expected exactly one Capacitor plugin export loop"
      );
    }
  });

  it("rejects raw SystemBars dispatch before resolving its plugin handle", () => {
    const source = `
    public void callPluginMethod(String pluginId, final String methodName, final PluginCall call) {
        try {
            final PluginHandle plugin = this.getPlugin(pluginId);
`;

    const patched = patchCapacitorSystemBarsDispatchSource(source);

    expect(patched.indexOf('if ("SystemBars".equals(pluginId))')).toBeLessThan(
      patched.indexOf("this.getPlugin(pluginId)")
    );
    expect(patched).toContain(
      'call.errorCallback("unable to find plugin : " + pluginId);'
    );
  });

  it("rejects additional unguarded plugin dispatch entry points", () => {
    const additionalDeclarations = [
      "public static void callPluginMethod(String pluginId, final PluginCall call)",
      "public final void callPluginMethod(String pluginId, final PluginCall call)",
      "protected synchronized final void callPluginMethod(String pluginId, final PluginCall call)",
      "void callPluginMethod(String pluginId, final PluginCall call)",
    ];

    for (const additionalDeclaration of additionalDeclarations) {
      const source = `
    public void callPluginMethod(String pluginId, final String methodName, final PluginCall call) {
        if ("SystemBars".equals(pluginId)) {
            Logger.error("unable to find plugin : " + pluginId);
            call.errorCallback("unable to find plugin : " + pluginId);
            return;
        }

        try {
            final PluginHandle plugin = this.getPlugin(pluginId);

    ${additionalDeclaration} {
        final PluginHandle plugin = this.getPlugin(pluginId);
`;

      expect(() => patchCapacitorSystemBarsDispatchSource(source)).toThrow(
        "Expected exactly one Capacitor plugin dispatch entry point"
      );
    }
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
    expect(() =>
      patchCapacitorCorePluginRegistrationSource(
        "unrecognized core plugin registration"
      )
    ).toThrow(
      "Expected Capacitor core plugin registration pattern was not found"
    );
    expect(() =>
      patchSystemBarsCallableSurfaceSource(
        "unrecognized SystemBars callable surface"
      )
    ).toThrow("Expected Capacitor SystemBars plugin methods were not found");
    expect(() =>
      patchCapacitorPluginExportSource("unrecognized plugin export")
    ).toThrow(
      "Expected Capacitor SystemBars plugin export pattern was not found"
    );
    expect(() =>
      patchCapacitorSystemBarsDispatchSource("unrecognized bridge dispatch")
    ).toThrow(
      "Expected Capacitor SystemBars bridge dispatch pattern was not found"
    );
  });

  it("stops Capacitor's plugin thread when secure listener construction aborts", () => {
    const source =
      "        this.msgHandler = new MessageHandler(this, webView, pluginManager);";
    const patched = patchCapacitorBridgeCleanupSource(source);

    expect(patched).toBe(failClosedMessageHandlerConstruction);
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
    expect(bridge).toContain(failClosedMessageHandlerConstruction);
    expect(bridge).not.toMatch(
      corePluginRegistrationPattern("CapacitorCookies")
    );
    expect(bridge).not.toMatch(corePluginRegistrationPattern("WebView"));
    expect(bridge).not.toMatch(corePluginRegistrationPattern("CapacitorHttp"));
    expect(bridge).toContain(
      "this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);"
    );
    expect(bridge).toContain(
      "SecPal: retain SystemBars for native lifecycle behavior only."
    );

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
    expect(systemBarsSource).not.toMatch(PLUGIN_METHOD_ANNOTATION_PATTERN);
    expect(systemBarsSource).not.toContain(
      "import com.getcapacitor.PluginMethod;"
    );
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
