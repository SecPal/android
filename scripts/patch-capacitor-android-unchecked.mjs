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

const replyAfterDispatchFailClosedMessageHandler = `        if (bridge.getConfig().isUsingLegacyBridge()) {
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
                javaScriptReplyProxy = replyProxy;
                postMessage(message.getData());
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

const upstreamCorePluginRegistration = `        this.registerPlugin(com.getcapacitor.plugin.CapacitorCookies.class);
        this.registerPlugin(com.getcapacitor.plugin.WebView.class);
        this.registerPlugin(com.getcapacitor.plugin.CapacitorHttp.class);
        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);`;
const retainedSystemBarsRegistration =
  "        this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);";
const hardenedCorePluginRegistration = `        // SecPal: retain SystemBars for native lifecycle behavior only.
${retainedSystemBarsRegistration}`;
const forbiddenCorePluginClasses = [
  "CapacitorCookies",
  "WebView",
  "CapacitorHttp",
];
const upstreamSystemBarsDispatch = `    public void callPluginMethod(String pluginId, final String methodName, final PluginCall call) {
        try {
            final PluginHandle plugin = this.getPlugin(pluginId);`;
const hardenedSystemBarsDispatch = `    public void callPluginMethod(String pluginId, final String methodName, final PluginCall call) {
        if ("SystemBars".equals(pluginId)) {
            Logger.error("unable to find plugin : " + pluginId);
            call.errorCallback("unable to find plugin : " + pluginId);
            return;
        }

        try {
            final PluginHandle plugin = this.getPlugin(pluginId);`;
const upstreamPluginExport = `        for (PluginHandle plugin : plugins) {
            lines.add(`;
const hardenedPluginExport = `        for (PluginHandle plugin : plugins) {
            if (plugin.getId().equals("SystemBars")) {
                continue;
            }

            lines.add(`;
const systemBarsPluginMethods = ["hide", "setAnimation", "setStyle", "show"];
const pluginDispatchEntryPointPattern = /\bvoid\s+callPluginMethod\s*\(/g;
const javaAnnotationPattern = String.raw`@[A-Za-z_$][A-Za-z0-9_$.]*(?:\s*\([^\r\n)]*\))?`;
const pluginExportLoopPattern = new RegExp(
  String.raw`\bfor\s*\(\s*(?:(?:${javaAnnotationPattern}|final)\s+)*(?:com\.getcapacitor\.)?PluginHandle\s+[A-Za-z_$][A-Za-z0-9_$]*\s*:`,
  "g"
);
const systemBarsRegistrationPattern =
  /\bregisterPlugin\s*\(\s*(?:com\.getcapacitor\.plugin\.)?SystemBars\s*\.\s*class\b/g;
const anyPluginMethodAnnotationPattern =
  /@(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*PluginMethod\b/;

function stripJavaComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function removeJavascriptInterfaceAnnotations(source) {
  return source
    .replace("import android.webkit.JavascriptInterface;\n", "")
    .replace(/^[ \t]*@JavascriptInterface[ \t]*\r?\n/gm, "");
}

function containsForbiddenCorePluginClass(source) {
  const sourceWithoutComments = stripJavaComments(source);

  return forbiddenCorePluginClasses.some((className) =>
    new RegExp(`\\b${className}\\s*\\.\\s*class\\b`).test(sourceWithoutComments)
  );
}

function hasPreviousHardenedCorePluginRegistration(source) {
  return (
    source.includes(retainedSystemBarsRegistration) &&
    countMatches(source, systemBarsRegistrationPattern) === 1 &&
    source.includes(failClosedMessageHandlerConstruction) &&
    source.includes(hardenedSystemBarsDispatch)
  );
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
  } else if (source.includes(replyAfterDispatchFailClosedMessageHandler)) {
    patchedSource = source.replace(
      replyAfterDispatchFailClosedMessageHandler,
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

export function patchCapacitorCorePluginRegistrationSource(source) {
  let patchedSource;

  if (source.includes(upstreamCorePluginRegistration)) {
    patchedSource = source.replace(
      upstreamCorePluginRegistration,
      hardenedCorePluginRegistration
    );
  } else if (containsForbiddenCorePluginClass(source)) {
    throw new Error("Forbidden Capacitor core plugin registration remains");
  } else if (source.includes(hardenedCorePluginRegistration)) {
    patchedSource = source;
  } else if (hasPreviousHardenedCorePluginRegistration(source)) {
    patchedSource = source.replace(
      retainedSystemBarsRegistration,
      hardenedCorePluginRegistration
    );
  } else {
    throw new Error(
      "Expected Capacitor core plugin registration pattern was not found"
    );
  }

  if (containsForbiddenCorePluginClass(patchedSource)) {
    throw new Error("Forbidden Capacitor core plugin registration remains");
  }

  return patchedSource;
}

export function patchCapacitorSystemBarsDispatchSource(source) {
  if (countMatches(source, pluginDispatchEntryPointPattern) > 1) {
    throw new Error(
      "Expected exactly one Capacitor plugin dispatch entry point"
    );
  }

  if (source.includes(hardenedSystemBarsDispatch)) {
    return source;
  }
  if (!source.includes(upstreamSystemBarsDispatch)) {
    throw new Error(
      "Expected Capacitor SystemBars bridge dispatch pattern was not found"
    );
  }

  return source.replace(upstreamSystemBarsDispatch, hardenedSystemBarsDispatch);
}

export function patchCapacitorPluginExportSource(source) {
  if (countMatches(source, pluginExportLoopPattern) > 1) {
    throw new Error("Expected exactly one Capacitor plugin export loop");
  }

  if (source.includes(hardenedPluginExport)) {
    return source;
  }
  if (!source.includes(upstreamPluginExport)) {
    throw new Error(
      "Expected Capacitor SystemBars plugin export pattern was not found"
    );
  }

  return source.replace(upstreamPluginExport, hardenedPluginExport);
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

export function patchSystemBarsCallableSurfaceSource(source) {
  const pluginMethodPattern =
    /^[ \t]*@PluginMethod(?:\([^)]*\))?[ \t]*\r?\n[ \t]*public void ([A-Za-z0-9_]+)\(/gm;
  const annotatedMethods = Array.from(
    source.matchAll(pluginMethodPattern),
    (match) => match[1]
  ).sort();
  const hasExpectedPublicMethods = systemBarsPluginMethods.every((method) =>
    source.includes(`public void ${method}(`)
  );

  if (annotatedMethods.length === 0) {
    if (
      hasExpectedPublicMethods &&
      !source.includes("import com.getcapacitor.PluginMethod;") &&
      !anyPluginMethodAnnotationPattern.test(source)
    ) {
      return source;
    }

    throw new Error(
      "Expected Capacitor SystemBars plugin methods were not found"
    );
  }

  if (
    annotatedMethods.length !== systemBarsPluginMethods.length ||
    annotatedMethods.some(
      (method, index) => method !== systemBarsPluginMethods[index]
    )
  ) {
    throw new Error(
      "Expected Capacitor SystemBars plugin methods were not found"
    );
  }

  const patchedSource = source
    .replace("import com.getcapacitor.PluginMethod;\n", "")
    .replace(pluginMethodPattern, (match) =>
      match.replace(/^[ \t]*@PluginMethod(?:\([^)]*\))?[ \t]*\r?\n/, "")
    );

  if (anyPluginMethodAnnotationPattern.test(patchedSource)) {
    throw new Error(
      "Expected Capacitor SystemBars plugin methods were not found"
    );
  }

  return patchedSource;
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
      patch: (source) =>
        patchCapacitorCorePluginRegistrationSource(
          patchCapacitorSystemBarsDispatchSource(
            patchCapacitorBridgeCleanupSource(source)
          )
        ),
    },
    {
      sourcePath:
        "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSExport.java",
      patch: patchCapacitorPluginExportSource,
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
      patch: (source) => {
        const patchedSource = patchCapacitorLegacyInterfaceSource(
          source,
          interfaceName
        );

        return interfaceName === "CapacitorSystemBarsAndroidInterface"
          ? patchSystemBarsCallableSurfaceSource(patchedSource)
          : patchedSource;
      },
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
