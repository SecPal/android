#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const replacements = [
  [
    "new CopyOnWriteArrayList(listeners)",
    "new CopyOnWriteArrayList<>(listeners)",
  ],
  [
    "private ActivityResultLauncher permissionLauncher;",
    "private ActivityResultLauncher<String[]> permissionLauncher;",
  ],
  [
    "private ActivityResultLauncher activityLauncher;",
    "private ActivityResultLauncher<Intent> activityLauncher;",
  ],
];

const insecureMessageHandler = `        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && !bridge.getConfig().isUsingLegacyBridge()) {
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
        }`;

const previousFailClosedMessageHandler = `        if (bridge.getConfig().isUsingLegacyBridge()) {
            throw new IllegalStateException("Origin-aware WebView bridge is unavailable");
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            throw new IllegalStateException("Origin-aware WebView bridge is unavailable");
        }

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
            throw new IllegalStateException("Origin-aware WebView bridge installation failed", ex);
        }`;

const failClosedMessageHandler = `        if (bridge.getConfig().isUsingLegacyBridge()) {
            throw new IllegalStateException("Origin-aware WebView bridge is unavailable");
        }
        final boolean webMessageListenerSupported;
        try {
            webMessageListenerSupported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
        } catch (RuntimeException exception) {
            throw new IllegalStateException("Origin-aware WebView bridge is unavailable", exception);
        }
        if (!webMessageListenerSupported) {
            throw new IllegalStateException("Origin-aware WebView bridge is unavailable");
        }

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
            throw new IllegalStateException("Origin-aware WebView bridge installation failed", ex);
        }`;

const messageHandlerConstruction =
  "        this.msgHandler = new MessageHandler(this, webView, pluginManager);";
const failClosedMessageHandlerConstruction = `        try {
            this.msgHandler = new MessageHandler(this, webView, pluginManager);
        } catch (RuntimeException exception) {
            handlerThread.quitSafely();
            throw exception;
        }`;

function removeJavascriptInterfaceAnnotations(source) {
  return source
    .replace("import android.webkit.JavascriptInterface;\n", "")
    .replace(/^[ \t]*@JavascriptInterface[ \t]*\r?\n/gm, "");
}

export function patchCapacitorMessageHandlerSource(source) {
  let patchedSource;

  if (source.includes(insecureMessageHandler)) {
    patchedSource = source.replace(
      insecureMessageHandler,
      failClosedMessageHandler
    );
  } else if (source.includes(previousFailClosedMessageHandler)) {
    patchedSource = source.replace(
      previousFailClosedMessageHandler,
      failClosedMessageHandler
    );
  } else if (source.includes(failClosedMessageHandler)) {
    patchedSource = source;
  } else {
    throw new Error(
      "Expected Capacitor WebView message-handler source pattern was not found"
    );
  }

  return removeJavascriptInterfaceAnnotations(patchedSource);
}

export function patchCapacitorBridgeCleanupSource(source) {
  if (source.includes(failClosedMessageHandlerConstruction)) {
    return source;
  }
  if (!source.includes(messageHandlerConstruction)) {
    throw new Error(
      "Expected Capacitor bridge message-handler construction pattern was not found"
    );
  }

  return source.replace(
    messageHandlerConstruction,
    failClosedMessageHandlerConstruction
  );
}

export function patchCapacitorLegacyInterfaceSource(source, interfaceName) {
  const expectedClassNames = {
    CapacitorCookiesAndroidInterface: "CapacitorCookies",
    CapacitorHttpAndroidInterface: "CapacitorHttp",
    CapacitorSystemBarsAndroidInterface: "SystemBars",
  };
  const expectedClassName = expectedClassNames[interfaceName];
  const registration = source
    .split("\n")
    .find(
      (line) =>
        line.includes("addJavascriptInterface(this") &&
        line.includes(`"${interfaceName}"`)
    );

  let patchedSource;

  if (registration) {
    patchedSource = removeJavascriptInterfaceAnnotations(
      source.replace(`${registration}\n`, "")
    );
  } else if (
    !source.includes(interfaceName) &&
    !source.includes("@JavascriptInterface") &&
    expectedClassName &&
    source.includes(`class ${expectedClassName}`)
  ) {
    patchedSource = source;
  } else {
    throw new Error(
      `Expected Capacitor legacy interface source pattern was not found for ${interfaceName}`
    );
  }

  if (interfaceName !== "CapacitorSystemBarsAndroidInterface") {
    return patchedSource;
  }

  return patchSystemBarsDomReadySource(patchedSource);
}

function patchSystemBarsDomReadySource(source) {
  if (
    source.includes("public void onPageLoaded(WebView webView)") &&
    source.includes("onDOMReady();")
  ) {
    return source;
  }

  const pageCommitCallback =
    /^(\s*)@Override\n\1public void onPageCommitVisible\(WebView view, String url\) \{\n\1    super\.onPageCommitVisible\(view, url\);\n\1    getBridge\(\)\.getWebView\(\)\.requestApplyInsets\(\);\n\1\}$/m;
  const match = source.match(pageCommitCallback);

  if (!match) {
    throw new Error(
      "Expected Capacitor SystemBars page-listener source pattern was not found"
    );
  }

  const indent = match[1];
  const nativeDomReadyCallback = `${match[0]}

${indent}@Override
${indent}public void onPageLoaded(WebView webView) {
${indent}    super.onPageLoaded(webView);
${indent}    onDOMReady();
${indent}}`;

  return source.replace(pageCommitCallback, nativeDomReadyCallback);
}

export function patchCapacitorAndroidSource(
  source,
  expectedReplacements = replacements
) {
  let patchedSource = source;

  for (const [unpatched, patched] of expectedReplacements) {
    if (patchedSource.includes(unpatched)) {
      patchedSource = patchedSource.replaceAll(unpatched, patched);
    } else if (patchedSource.includes(patched)) {
      continue;
    } else {
      throw new Error(
        "Expected Capacitor unchecked Java source pattern was not found"
      );
    }
  }

  return patchedSource;
}

export function patchCapacitorAndroidSources(repoRoot) {
  const sourceFiles = [
    {
      sourcePath:
        "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Plugin.java",
      patch: (source) =>
        patchCapacitorAndroidSource(source, replacements.slice(0, 1)),
    },
    {
      sourcePath:
        "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java",
      patch: (source) =>
        patchCapacitorAndroidSource(source, replacements.slice(1)),
    },
    {
      sourcePath:
        "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java",
      patch: patchCapacitorBridgeCleanupSource,
    },
    {
      sourcePath:
        "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java",
      patch: patchCapacitorMessageHandlerSource,
    },
    ...[
      ["CapacitorCookies.java", "CapacitorCookiesAndroidInterface"],
      ["CapacitorHttp.java", "CapacitorHttpAndroidInterface"],
      ["SystemBars.java", "CapacitorSystemBarsAndroidInterface"],
    ].map(([fileName, interfaceName]) => ({
      sourcePath: `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/${fileName}`,
      patch: (source) =>
        patchCapacitorLegacyInterfaceSource(source, interfaceName),
    })),
  ];

  const patchedFiles = sourceFiles.map(({ sourcePath, patch }) => {
    const absolutePath = resolve(repoRoot, sourcePath);
    const source = readFileSync(absolutePath, "utf8");
    const patchedSource = patch(source);

    return { absolutePath, source, patchedSource };
  });

  for (const { absolutePath, source, patchedSource } of patchedFiles) {
    if (patchedSource !== source) {
      writeFileSync(absolutePath, patchedSource, "utf8");
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  patchCapacitorAndroidSources(repoRoot);
}
