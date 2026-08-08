/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

const readInstalledDependencyFile = (...segments: string[]) => {
  const dependencyPath = resolve(repoRoot, "node_modules", ...segments);

  if (!existsSync(dependencyPath)) {
    throw new Error(
      `Missing installed dependency source: ${dependencyPath}. Run npm ci before running the native hardening tests.`
    );
  }

  return readFileSync(dependencyPath, "utf8");
};

const VENDOR_SPECIFIC_PATTERN = /Samsung|samsung|com\.sec\./;
const corePluginRegistrationPattern = (pluginId: string) =>
  new RegExp(
    `\\bregisterPlugin\\s*\\(\\s*(?:com\\.getcapacitor\\.plugin\\.)?${pluginId}\\s*\\.\\s*class\\b`
  );
const PLUGIN_METHOD_ANNOTATION_PATTERN =
  /@(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*PluginMethod\b/;

describe("Android native hardening", () => {
  it("reports a targeted error when an installed dependency source is unavailable", () => {
    const missingSegments = [
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "Missing.java",
    ];

    expect(() => readInstalledDependencyFile(...missingSegments)).toThrowError(
      `Missing installed dependency source: ${resolve(
        repoRoot,
        "node_modules",
        ...missingSegments
      )}. Run npm ci before running the native hardening tests.`
    );
  });

  it("runs the Cordova config normalizer after Capacitor sync and add", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["native:normalize:cordova-config"]).toContain(
      "normalize-cordova-config.mjs"
    );
    expect(packageJson.scripts["cap:sync"]).toContain(
      "native:normalize:cordova-config"
    );
    expect(packageJson.scripts["cap:add:android"]).toContain(
      "native:normalize:cordova-config"
    );
  });

  it("keeps only Android resources with proven runtime or build-time callers", () => {
    const resourcesRoot = resolve(
      repoRoot,
      "android",
      "app",
      "src",
      "main",
      "res"
    );
    const obsoleteResourcePaths = [
      "layout/activity_main.xml",
      "drawable/ic_launcher_background.xml",
      "drawable/ic_launcher_foreground.xml",
      "drawable/splash.png",
      "drawable-land-hdpi/splash.png",
      "drawable-land-mdpi/splash.png",
      "drawable-land-xhdpi/splash.png",
      "drawable-land-xxhdpi/splash.png",
      "drawable-land-xxxhdpi/splash.png",
      "drawable-port-hdpi/splash.png",
      "drawable-port-mdpi/splash.png",
      "drawable-port-xhdpi/splash.png",
      "drawable-port-xxhdpi/splash.png",
      "drawable-port-xxxhdpi/splash.png",
    ];

    for (const resourcePath of obsoleteResourcePaths) {
      expect(existsSync(resolve(resourcesRoot, resourcePath))).toBe(false);
    }

    const capacitorBridgeActivity = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "BridgeActivity.java"
    );
    expect(capacitorBridgeActivity).toContain(
      "R.layout.capacitor_bridge_layout_main"
    );
    expect(capacitorBridgeActivity).not.toContain("R.layout.activity_main");

    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    const adaptiveLauncher = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "mipmap-anydpi-v26",
      "ic_launcher.xml"
    );
    const launchTheme = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "styles.xml"
    );
    const splashBackground = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "drawable",
      "splash_screen_background.xml"
    );
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(adaptiveLauncher).toContain(
      'android:drawable="@mipmap/ic_launcher_foreground"'
    );
    expect(adaptiveLauncher).toContain(
      'android:drawable="@color/ic_launcher_background"'
    );
    expect(launchTheme).toContain(
      '<item name="android:background">@drawable/splash_screen_background</item>'
    );
    expect(splashBackground).toContain(
      'android:src="@drawable/secpal_splash_icon"'
    );

    expect(
      existsSync(
        resolve(
          repoRoot,
          "android",
          "app",
          "src",
          "debug",
          "res",
          "values",
          "strings.xml"
        )
      )
    ).toBe(false);

    const stringsXml = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml"
    );
    expect(stringsXml).not.toContain('name="package_name"');
    expect(stringsXml).not.toContain('name="custom_url_scheme"');
    expect(stringsXml).toContain(
      '<string name="api_base_url">https://runtime-bootstrap-required.secpal.dev</string>'
    );
    expect(readRepoFile("scripts", "build-frontend-web.sh")).toContain(
      'name="api_base_url"'
    );
    expect(readRepoFile("scripts", "inject-native-auth-bridge.mjs")).toContain(
      'name="api_base_url"'
    );

    const resourceKeepContract = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "raw",
      "keep.xml"
    );
    expect(resourceKeepContract).toContain(
      'tools:keep="@xml/config,@string/api_base_url"'
    );
    expect(resourceKeepContract).not.toContain("tools:discard");
    expect(resourceKeepContract).not.toContain("@*");
  });

  it("patches Capacitor's unchecked Java generics after installation and sync", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["native:patch:capacitor-android"]).toContain(
      "patch-capacitor-android-unchecked.mjs"
    );
    expect(packageJson.scripts.postinstall).toContain(
      "native:patch:capacitor-android"
    );
    expect(packageJson.scripts["cap:sync"]).toContain(
      "native:patch:capacitor-android"
    );
    expect(packageJson.scripts["cap:add:android"]).toContain(
      "native:patch:capacitor-android"
    );
  });

  it("keeps unused Capacitor core plugins outside the WebView bridge", () => {
    const bridge = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "Bridge.java"
    );
    const systemBars = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "plugin",
      "SystemBars.java"
    );
    const jsExport = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "JSExport.java"
    );
    const webViewLocalServer = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "WebViewLocalServer.java"
    );
    const bridgeIsolationTest = readRepoFile(
      "android",
      "app",
      "src",
      "androidTest",
      "java",
      "app",
      "secpal",
      "WebViewBridgeIsolationInstrumentedTest.java"
    );
    const bridgeIsolationTestActivity = readRepoFile(
      "android",
      "app",
      "src",
      "debug",
      "java",
      "app",
      "secpal",
      "BridgeIsolationTestActivity.java"
    );
    const debugManifest = readRepoFile(
      "android",
      "app",
      "src",
      "debug",
      "AndroidManifest.xml"
    );
    const mainActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "MainActivity.java"
    );
    const bridgeIsolationPage = readRepoFile(
      "android",
      "app",
      "src",
      "debug",
      "assets",
      "public",
      "bridge-isolation-test.html"
    );
    const architecture = readRepoFile("docs", "ANDROID_AUTH_ARCHITECTURE.md");

    expect(bridge).not.toMatch(
      corePluginRegistrationPattern("CapacitorCookies")
    );
    expect(bridge).not.toMatch(corePluginRegistrationPattern("CapacitorHttp"));
    expect(bridge).not.toMatch(corePluginRegistrationPattern("WebView"));
    expect(bridge).toContain(
      "this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);"
    );
    expect(bridge).toContain(
      "SecPal: retain SystemBars for native lifecycle behavior only."
    );
    expect(systemBars).not.toMatch(PLUGIN_METHOD_ANNOTATION_PATTERN);
    expect(bridge).toContain('if ("SystemBars".equals(pluginId))');
    expect(jsExport).toContain('if (plugin.getId().equals("SystemBars"))');
    expect(webViewLocalServer).not.toContain(
      "handleCapacitorHttpRequest(request)"
    );
    expect(webViewLocalServer).toContain(
      "Blocked direct Capacitor native HTTP interceptor request"
    );
    expect(systemBars).toContain("public void setStyle(final PluginCall call)");
    expect(systemBars).toContain("public void show(final PluginCall call)");
    expect(systemBars).toContain("public void hide(final PluginCall call)");
    expect(bridgeIsolationTest).toContain(
      "allBridgeIsolationGuaranteesHoldInSingleWebViewSession"
    );
    expect(bridgeIsolationTest.match(/@Test/g)).toHaveLength(1);
    expect(bridgeIsolationTest).toContain(
      "assertUnusedCorePluginsAreAbsentFromTheNativeRegistry"
    );
    expect(bridgeIsolationTest).toContain(
      "assertPackagedWebViewCannotInvokeForbiddenCorePlugins"
    );
    expect(bridgeIsolationTest).toContain(
      "assertPackagedFrontendCannotExposeForbiddenNativePlugins"
    );
    expect(bridgeIsolationTest).toContain(
      "assertNativeHttpInterceptorIsBlocked"
    );
    expect(bridgeIsolationTest).toContain("assertEquals(403");
    expect(bridgeIsolationTest).toContain("root.hasChildNodes()");
    expect(bridgeIsolationTest).not.toContain("moveToState(");
    expect(bridgeIsolationTest).toContain(
      "BridgeIsolationTestActivity.resetInvocations()"
    );
    expect(bridgeIsolationTest).not.toContain("registerPluginInstance(");
    expect(bridgeIsolationTest).toContain(
      'assertTrue(invocations.contains("barrier"))'
    );
    expect(bridgeIsolationTest).toContain(
      'assertFalse(invocations.contains("child"))'
    );
    expect(bridgeIsolationTest).toContain(
      "Child frame unexpectedly received a native plugin reply"
    );
    expect(bridgeIsolationTest).toContain("waitForIdleSync()");
    expect(bridgeIsolationTestActivity).toContain(
      "createSecureBridge(CountingEnterprisePlugin.class)"
    );
    expect(bridgeIsolationTestActivity).toContain(
      '@CapacitorPlugin(name = "SecPalEnterprise")'
    );
    expect(mainActivity).toContain(
      "createSecureBridge(SecPalEnterprisePlugin.class)"
    );
    expect(debugManifest).toMatch(
      /android:name="\.BridgeIsolationTestActivity"\s+android:exported="false"/
    );
    expect(bridgeIsolationPage).toContain("isPluginAvailable");
    expect(bridgeIsolationPage).toContain("child-reply");
    expect(bridgeIsolationPage).toMatch(
      /window\.androidBridge\.onmessage = \(\) => \{\s+secpalTestResult\.postMessage\('child-reply'\);\s+\};/
    );
    expect(bridgeIsolationPage).not.toContain("forbiddenProxiesAbsent");
    expect(architecture).toContain(
      '`Capacitor.isPluginAvailable("SystemBars")` returns'
    );
    expect(architecture).toContain("web-only JavaScript proxies");
    expect(architecture).toContain(
      "`/_capacitor_http_interceptor_` route is also rejected"
    );
    expect(architecture).not.toContain(
      "It is omitted from generated\nplugin headers and `Capacitor.Plugins`"
    );
  });

  it("proves the upstream registrations expose direct JavaScript dispatch", () => {
    const bridge = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "Bridge.java"
    );
    const jsExport = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "JSExport.java"
    );
    const pluginHandle = readInstalledDependencyFile(
      "@capacitor",
      "android",
      "capacitor",
      "src",
      "main",
      "java",
      "com",
      "getcapacitor",
      "PluginHandle.java"
    );
    const patchScript = readRepoFile(
      "scripts",
      "patch-capacitor-android-unchecked.mjs"
    );
    const corePluginSources = [
      ["CapacitorCookies.java", "setCookie"],
      ["CapacitorHttp.java", "request"],
      ["WebView.java", "setServerBasePath"],
    ] as const;

    expect(jsExport).toContain(
      "Collection<PluginMethodHandle> methods = plugin.getMethods()"
    );
    expect(jsExport).toContain("w.Capacitor.nativePromise('");
    expect(pluginHandle).toContain(
      "methodReflect.getAnnotation(PluginMethod.class)"
    );
    expect(bridge).toContain("plugin.invoke(methodName, call)");

    for (const [fileName, methodName] of corePluginSources) {
      const className = fileName.replace(".java", "");
      const source = readInstalledDependencyFile(
        "@capacitor",
        "android",
        "capacitor",
        "src",
        "main",
        "java",
        "com",
        "getcapacitor",
        "plugin",
        fileName
      );

      expect(patchScript).toContain(
        `this.registerPlugin(com.getcapacitor.plugin.${className}.class);`
      );
      expect(source).toMatch(
        new RegExp(
          `@PluginMethod(?:\\([^)]*\\))?\\s+public void ${methodName}\\(`
        )
      );
    }

    expect(patchScript).toContain(
      "this.registerPlugin(com.getcapacitor.plugin.SystemBars.class);"
    );
    expect(patchScript).toContain(
      'const systemBarsPluginMethods = ["hide", "setAnimation", "setStyle", "show"]'
    );
  });

  it("fails closed to a packaged local screen when the origin-aware bridge is unavailable", () => {
    const mainActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "MainActivity.java"
    );
    const compatibilityActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "WebViewCompatibilityActivity.java"
    );
    const bridgeSupport = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "SecureWebViewBridgeSupport.java"
    );
    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    const bridgeIsolationTest = readRepoFile(
      "android",
      "app",
      "src",
      "androidTest",
      "java",
      "app",
      "secpal",
      "WebViewBridgeIsolationInstrumentedTest.java"
    );

    expect(mainActivity).toContain("WEB_MESSAGE_LISTENER");
    expect(mainActivity).toContain("WebViewCompat.getCurrentWebViewPackage");
    expect(bridgeSupport).toContain("MINIMUM_WEBVIEW_MAJOR_VERSION = 83");
    expect(mainActivity).toContain("openWebViewCompatibilityScreen()");
    expect(mainActivity).toContain("destroyUntrustedWebViews");
    const compatibilityMethodIndex = mainActivity.indexOf(
      "private void openWebViewCompatibilityScreen()"
    );
    const destroyWebViewsIndex = mainActivity.indexOf(
      "destroyUntrustedWebViews(findViewById(android.R.id.content))",
      compatibilityMethodIndex
    );
    const startCompatibilityActivityIndex = mainActivity.indexOf(
      "startActivity(new Intent(this, WebViewCompatibilityActivity.class))",
      compatibilityMethodIndex
    );
    expect(destroyWebViewsIndex).toBeGreaterThan(compatibilityMethodIndex);
    expect(startCompatibilityActivityIndex).toBeGreaterThan(
      destroyWebViewsIndex
    );
    expect(mainActivity).toContain("parentGroup.removeView(webView)");
    expect(
      mainActivity.indexOf("parentGroup.removeView(webView)")
    ).toBeLessThan(mainActivity.indexOf("webView.destroy()"));
    expect(mainActivity).toContain("if (!secureBridgeStarted)");
    expect(mainActivity).toContain(
      "if (!secureBridgeLoadAttempted && !compatibilityScreenOpened)"
    );
    expect(mainActivity).toMatch(
      /super\.onCreate\(savedInstanceState\);\s+if \(!secureBridgeStarted\) \{[\s\S]*?openWebViewCompatibilityScreen\(\);[\s\S]*?return;/
    );
    expect(mainActivity).not.toContain("scheduleProvisioningBootstrapSync");
    expect(
      mainActivity.indexOf("SecureWebViewBridgeSupport.isAvailable")
    ).toBeLessThan(
      mainActivity.indexOf("registerPlugin(SecPalNativeAuthPlugin.class)")
    );
    expect(compatibilityActivity).toContain(
      "setContentView(R.layout.activity_webview_compatibility)"
    );
    expect(compatibilityActivity).not.toContain("new WebView");
    expect(compatibilityActivity).not.toContain("WebViewAssetLoader");
    expect(compatibilityActivity).not.toContain("addJavascriptInterface");
    expect(manifest).toContain('android:name=".WebViewCompatibilityActivity"');
    expect(bridgeIsolationTest).toContain("sourceOrigin.toString(),");
    expect(bridgeIsolationTest).toContain("isMainFrame,");
    expect(bridgeIsolationTest).toContain("replyProxy != null");
    expect(bridgeIsolationTest).not.toContain(
      "private final JavaScriptReplyProxy"
    );
    expect(bridgeIsolationTest).toContain(
      "WebViewCompat.removeWebMessageListener("
    );
    expect(bridgeIsolationTest).toContain('webView.loadUrl("about:blank")');
    expect(bridgeIsolationTest).toContain("webView.postVisualStateCallback(");
    expect(
      existsSync(
        resolve(
          repoRoot,
          "android",
          "app",
          "src",
          "main",
          "res",
          "layout",
          "activity_webview_compatibility.xml"
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        resolve(
          repoRoot,
          "android",
          "app",
          "src",
          "main",
          "assets",
          "secure-webview-update.html"
        )
      )
    ).toBe(false);
  });

  it("keeps xmldom exactly pinned and aligned for Capacitor CLI tooling", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      devDependencies?: Record<string, unknown>;
      overrides?: Record<string, unknown>;
    };
    const packageLock = JSON.parse(readRepoFile("package-lock.json")) as {
      packages?: Record<
        string,
        {
          devDependencies?: Record<string, unknown>;
          version?: string;
        }
      >;
    };
    const declaredVersion = packageJson.devDependencies?.["@xmldom/xmldom"];

    expect(declaredVersion).toMatch(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
    );
    expect(packageJson.overrides?.["@xmldom/xmldom"]).toBe(declaredVersion);
    expect(
      packageLock.packages?.[""]?.devDependencies?.["@xmldom/xmldom"]
    ).toBe(declaredVersion);
    expect(packageLock.packages?.["node_modules/@xmldom/xmldom"]?.version).toBe(
      declaredVersion
    );
  });

  it("defines the Cordova access allowlist in Capacitor source config", async () => {
    let configModule: { default?: unknown };
    try {
      configModule = await import("../capacitor.config");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to import ../capacitor.config for Cordova access allowlist test: ${message}`,
        { cause: error }
      );
    }

    expect(configModule).toBeDefined();
    expect(configModule.default).toBeDefined();

    const config = configModule.default as {
      android?: { minWebViewVersion?: number };
      cordova?: { accessOrigins?: string[] };
    };

    expect(config).toBeTypeOf("object");
    expect(config.cordova).toBeDefined();
    expect(config.cordova?.accessOrigins).toBeDefined();
    expect(Array.isArray(config.cordova?.accessOrigins)).toBe(true);
    expect(config.cordova?.accessOrigins).toEqual([
      "https://api.secpal.dev",
      "https://app.secpal.dev",
    ]);
    expect(config.android?.minWebViewVersion).toBe(83);
  });

  it("hardens release builds with R8, resource shrinking, and keep rules", () => {
    const buildGradle = readRepoFile("android", "app", "build.gradle");
    const proguardRules = readRepoFile("android", "app", "proguard-rules.pro");

    expect(buildGradle).toMatch(/release\s*\{[\s\S]*minifyEnabled true/);
    expect(buildGradle).toMatch(/release\s*\{[\s\S]*shrinkResources true/);
    expect(buildGradle).toContain(
      "getDefaultProguardFile('proguard-android-optimize.txt')"
    );
    expect(proguardRules).toContain(
      "@com.getcapacitor.annotation.CapacitorPlugin"
    );
    expect(proguardRules).toContain(
      "@com.getcapacitor.PluginMethod <methods>;"
    );
    expect(proguardRules).toContain("app.secpal.SecPalNativeAuthPlugin");
  });

  it("tracks native warning triage in the Android build configuration", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const buildGradle = readRepoFile("android", "app", "build.gradle");

    expect(packageJson.scripts["native:compile:debug:deprecations"]).toContain(
      "./gradlew :app:compileDebugJavaWithJavac"
    );
    expect(packageJson.scripts["native:compile:debug:deprecations"]).toContain(
      "-PsecpalJavaDeprecationLint=true"
    );
    expect(buildGradle).toContain("packaging {");
    expect(buildGradle).toContain("jniLibs {");
    expect(buildGradle).toContain("keepDebugSymbols");
    expect(buildGradle).toContain("libdatastore_shared_counter.so");
  });

  it("does not package the vulnerable Google Play services FIDO backend", () => {
    const variablesGradle = readRepoFile("android", "variables.gradle");
    const buildGradle = readRepoFile("android", "app", "build.gradle");
    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );

    expect(variablesGradle).toMatch(
      /androidxCredentialsVersion\s*=\s*'1\.6\.0'/
    );
    expect(buildGradle).not.toMatch(
      /implementation\s+["']androidx\.credentials:credentials-play-services-auth/
    );
    expect(buildGradle).not.toMatch(
      /implementation\s+["']com\.google\.android\.gms:play-services-fido/
    );
    expect(manifest).toMatch(
      /<!-- Passkeys require Android 14\+; the Play services provider is intentionally excluded\. -->\s*<application\b/
    );
    expect(manifest).toMatch(
      /<application\b[^>]*\btools:ignore="CredentialDependency"/
    );
    expect(buildGradle).toContain("verifyReleasePasskeyDependencies");
    expect(buildGradle).toContain("releaseRuntimeClasspath");
    expect(buildGradle).toMatch(
      /tasks\.matching[\s\S]*preReleaseBuild[\s\S]*dependsOn[\s\S]*verifyReleasePasskeyDependencies/
    );
  });

  it("does not keep deprecated pre-Marshmallow network compatibility code when minSdk is 24", () => {
    const variablesGradle = readRepoFile("android", "variables.gradle");
    const authArchitecture = readRepoFile(
      "docs",
      "ANDROID_AUTH_ARCHITECTURE.md"
    );
    const networkState = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "NetworkState.java"
    );

    expect(variablesGradle).toMatch(/minSdkVersion\s*=\s*24/);
    expect(authArchitecture).toContain("Android API 24 through 33");
    expect(authArchitecture).toContain("On API 24 through 33");
    expect(authArchitecture).not.toContain("Android API 23 through 33");
    expect(authArchitecture).not.toContain("On API 23 through 33");
    expect(networkState).not.toContain('SuppressWarnings("deprecation")');
    expect(networkState).not.toContain("NetworkInfo");
    expect(networkState).not.toContain("getActiveNetworkInfo");
  });

  it("locks file sharing and defines the canonical release transport policy", () => {
    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    const filePaths = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "file_paths.xml"
    );
    const mainNetworkSecurityConfigPath = resolve(
      repoRoot,
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "network_security_config.xml"
    );
    const api36NetworkSecurityConfigPath = resolve(
      repoRoot,
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml-v36",
      "network_security_config.xml"
    );
    const api37NetworkSecurityConfigPath = resolve(
      repoRoot,
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml-v37",
      "network_security_config.xml"
    );
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const qualityWorkflow = readRepoFile(".github", "workflows", "quality.yml");
    const appBuildGradle = readRepoFile("android", "app", "build.gradle");
    const verificationWrapper = readRepoFile(
      "scripts",
      "verify-android-network-security.sh"
    );

    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain(
      'android:networkSecurityConfig="@xml/network_security_config"'
    );
    expect(filePaths).not.toContain('path="."');
    expect(filePaths).toContain('name="shared_files" path="shared/"');
    expect(filePaths).toContain('name="shared_cache" path="shared/"');
    expect(existsSync(mainNetworkSecurityConfigPath)).toBe(true);
    expect(existsSync(api36NetworkSecurityConfigPath)).toBe(true);
    expect(existsSync(api37NetworkSecurityConfigPath)).toBe(true);

    const networkSecurityConfig = readFileSync(
      mainNetworkSecurityConfigPath,
      "utf8"
    );
    const api36NetworkSecurityConfig = readFileSync(
      api36NetworkSecurityConfigPath,
      "utf8"
    );
    const api37NetworkSecurityConfig = readFileSync(
      api37NetworkSecurityConfigPath,
      "utf8"
    );
    expect(networkSecurityConfig).toContain(
      '<base-config cleartextTrafficPermitted="false"'
    );
    expect(networkSecurityConfig).not.toMatch(
      /cleartextTrafficPermitted\s*=\s*["']true["']/
    );
    expect(networkSecurityConfig).not.toMatch(/<pin-set(?:\s|\/?>)/);
    expect(networkSecurityConfig).not.toMatch(/<pin(?:\s|\/?>)/);
    expect(networkSecurityConfig).not.toMatch(/[A-Za-z0-9+/]{43}=/);
    expect(networkSecurityConfig).not.toMatch(
      /overridePins\s*=\s*["']true["']/
    );
    expect(networkSecurityConfig).not.toContain("<debug-overrides");
    expect(networkSecurityConfig).not.toContain("<certificateTransparency");
    expect(api36NetworkSecurityConfig).toContain(
      '<certificateTransparency enabled="true"'
    );
    expect(api36NetworkSecurityConfig).not.toContain("<domain-config");
    expect(api37NetworkSecurityConfig).toContain(">localhost</domain>");
    expect(api37NetworkSecurityConfig).not.toMatch(
      /cleartextTrafficPermitted\s*=\s*["']true["']/
    );
    expect(
      api36NetworkSecurityConfig.match(/<certificateTransparency/g)
    ).toHaveLength(1);

    for (const config of [
      networkSecurityConfig,
      api36NetworkSecurityConfig,
      api37NetworkSecurityConfig,
    ]) {
      expect(config).not.toContain("<debug-overrides");
      expect(config).not.toMatch(/<pin-set(?:\s|\/?>)/);
      expect(config).not.toMatch(/<pin(?:\s|\/?>)/);

      const certificateTags = config.matchAll(/<certificates\b([^>]*)>/g);
      for (const [, attributes] of certificateTags) {
        const certificateSources = Array.from(
          attributes.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/g),
          (match) => match[1]
        );

        expect(certificateSources).toEqual(["system"]);
      }
    }

    expect(packageJson.scripts["native:verify:network-security"]).toContain(
      "verify-android-network-security.sh"
    );
    expect(verificationWrapper).toContain(
      ":app:generateReleaseNetworkSecurityVerificationInputs"
    );
    expect(verificationWrapper).toContain("--rerun-tasks");
    expect(qualityWorkflow).toContain("npm run native:verify:network-security");
    expect(appBuildGradle).toContain(
      'tasks.register("generateReleaseNetworkSecurityVerificationInputs")'
    );
    expect(appBuildGradle).toMatch(
      /tasks\.register\("generateReleaseNetworkSecurityVerificationInputs"\)\s*\{[\s\S]*dependsOn\(\s*"processReleaseResources",\s*"processReleaseManifestForPackage"\s*\)/
    );
    expect(appBuildGradle).toMatch(/ctRegression\s*\{/);
    expect(appBuildGradle).toMatch(/initWith\s+release/);
    expect(appBuildGradle).toMatch(/applicationIdSuffix\s+"\.ctregression"/);
    expect(appBuildGradle).toMatch(/signingConfig\s+signingConfigs\.debug/);
    expect(appBuildGradle).toMatch(/testBuildType\s+["']ctRegression["']/);
    expect(appBuildGradle).toContain("verifyCtRegressionSecurityDependencies");
    expect(appBuildGradle).toContain("ctRegressionRuntimeClasspath");
  });

  it("declares digital asset links in the app manifest for app.secpal.dev", () => {
    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    const stringsXml = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml"
    );

    expect(manifest).toContain('android:name="asset_statements"');
    expect(manifest).toContain('android:resource="@string/asset_statements"');
    expect(stringsXml).toContain('<string name="asset_statements"');
    expect(stringsXml).toContain(
      "https://app.secpal.dev/.well-known/assetlinks.json"
    );
  });

  it("removes retired enrollment bootstrap state without changing runtime bootstrap", () => {
    const stringsXml = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml"
    );
    expect(stringsXml).toContain(
      '<string name="api_base_url">https://runtime-bootstrap-required.secpal.dev</string>'
    );
    expect(stringsXml).not.toContain("provisioning_bootstrap_api_base_url");

    const nativeAuthClient = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "NativeAuthHttpClient.java"
    );
    const tokenStorage = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "KeystoreTokenStorage.java"
    );
    const enterprisePlugin = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "SecPalEnterprisePlugin.java"
    );
    const deviceAdminReceiver = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "SecPalDeviceAdminReceiver.java"
    );

    expect(nativeAuthClient).not.toContain("/v1/android/bootstrap/exchange");
    expect(nativeAuthClient).not.toContain("toJavaMap");
    expect(nativeAuthClient).not.toContain("toJavaValue");
    expect(nativeAuthClient).not.toContain("mapValue");
    expect(tokenStorage).not.toContain("keyPrefix");
    expect(enterprisePlugin).not.toContain("distributionState");
    expect(deviceAdminReceiver).not.toContain("ProvisioningBootstrap");
  });

  it("uses only the canonical bootstrap schema for Android push registration", () => {
    const bridgeScript = readRepoFile(
      "scripts",
      "inject-native-auth-bridge.mjs"
    );

    expect(bridgeScript).toContain("const currentBootstrapSchemaVersion = 4;");
    expect(
      bridgeScript.match(/const currentBootstrapSchemaVersion = 4;/g)
    ).toHaveLength(1);
    expect(bridgeScript).not.toMatch(/schema_version:\s*[0-3]\b/);
  });

  it("requires frontend source for packaging while allowing standalone verification", () => {
    const appBuildGradle = readRepoFile("android", "app", "build.gradle");
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const qualityWorkflow = readRepoFile(".github", "workflows", "quality.yml");
    const frontendBuildScript = readRepoFile(
      "scripts",
      "build-frontend-web.sh"
    );
    const playStoreReleaseTests = readRepoFile(
      "tests",
      "play-store-release-automation.test.ts"
    );
    const androidGitignore = readRepoFile("android", ".gitignore");
    const gitAttributes = readRepoFile(".gitattributes");
    const aaptIgnoreAssetsPolicy = JSON.parse(
      readRepoFile("android", "app", "aapt-ignore-assets.json")
    ) as { ignore_assets_pattern: string };
    const fallbackInventory = JSON.parse(
      readRepoFile("android", "app", "src", "main", "web-assets-fallback.json")
    ) as { files: Array<{ path: string; sha256: string }> };

    expect(appBuildGradle).toContain(
      'tasks.register("prepareAndroidRuntimeSchemaAsset", Exec)'
    );
    expect(appBuildGradle).toContain(
      'tasks.register("verifyAndroidRuntimeSchemaAsset", Exec)'
    );
    expect(appBuildGradle).toContain(
      'tasks.register("generateDebugAndroidWebAssetInventory", Exec)'
    );
    expect(appBuildGradle).toContain(
      '"--overlay", debugAndroidWebAssets.absolutePath'
    );
    expect(appBuildGradle).toContain(
      '"--output", debugAndroidWebAssetInventory.absolutePath'
    );
    expect(appBuildGradle).toMatch(
      /normalizedTaskName\.contains\("debug"\)[\s\S]*normalizedTaskName\.contains\("ctregression"\)[\s\S]*normalizedTaskName\.contains\("asset"\)[\s\S]*normalizedTaskName\.contains\("lint"\)[\s\S]*dependsOn\(debugAndroidWebAssetInventoryTask\)/
    );
    expect(appBuildGradle).not.toContain("def runtimeSchemaInjector");
    expect(appBuildGradle).toContain(
      "scripts/verify-android-runtime-schema.mjs"
    );
    expect(appBuildGradle).toContain(
      "def generatedAndroidWebAssets = new File(projectDir, 'src/main/assets/public')"
    );
    expect(appBuildGradle).toContain(
      "def fallbackAndroidWebAssetInventory = new File(projectDir, 'src/main/web-assets-fallback.json')"
    );
    expect(appBuildGradle).toContain("scripts/android-web-asset-inventory.mjs");
    expect(appBuildGradle).toContain("scripts/literal-zip-archive.mjs");
    expect(aaptIgnoreAssetsPolicy.ignore_assets_pattern).toBe(
      "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
    );
    expect(appBuildGradle).toContain(
      "def androidAssetIgnorePolicyFile = new File(projectDir, 'aapt-ignore-assets.json')"
    );
    expect(appBuildGradle).toContain(
      "ignoreAssetsPattern androidAssetIgnorePattern"
    );
    expect(appBuildGradle).not.toContain(
      "ignoreAssetsPattern '!.svn:!.git:!.ds_store"
    );
    expect(gitAttributes).toContain(
      "android/app/src/main/assets/public/index.html text eol=lf"
    );
    expect(gitAttributes).toContain(
      "android/app/src/main/assets/public/secpal-native-auth-bridge.*.js text eol=lf"
    );
    expect(appBuildGradle).toContain("inputs.dir(generatedAndroidWebAssets)");
    expect(appBuildGradle).toContain("generatedAndroidWebAssets.absolutePath");
    expect(appBuildGradle).toContain(
      "fallbackAndroidWebAssetInventory.absolutePath"
    );
    expect(frontendBuildScript).not.toContain(
      "scripts/generate-android-web-asset-inventory.mjs"
    );
    expect(packageJson.scripts["native:inventory:web-assets"]).toBe(
      "node ./scripts/generate-android-web-asset-inventory.mjs ./android/app/src/main/assets/public"
    );
    for (const scriptName of [
      "cap:copy",
      "cap:sync",
      "cap:add:android",
    ] as const) {
      const script = packageJson.scripts[scriptName];
      const capacitorCopyIndex = script.indexOf(
        `npx cap ${scriptName === "cap:add:android" ? "add" : scriptName.slice(4)}`
      );
      const inventoryIndex = script.indexOf(
        "npm run native:inventory:web-assets"
      );
      expect(capacitorCopyIndex).toBeGreaterThanOrEqual(0);
      expect(inventoryIndex).toBeGreaterThan(capacitorCopyIndex);
    }
    expect(androidGitignore).not.toContain(
      "!app/src/main/assets/public/secpal-web-assets.json"
    );
    expect(androidGitignore).toContain(
      "!app/src/main/assets/public/secpal-native-auth-bridge.*.js"
    );
    expect(androidGitignore).toContain(
      "app/src/debug/assets/public/secpal-web-assets.json"
    );
    expect(fallbackInventory.files.map(({ path }) => path)).toEqual([
      "index.html",
      expect.stringMatching(/^secpal-native-auth-bridge\.[0-9a-f]{64}\.js$/u),
    ]);
    for (const { path, sha256 } of fallbackInventory.files) {
      expect(
        createHash("sha256")
          .update(
            readFileSync(
              resolve(
                repoRoot,
                "android",
                "app",
                "src",
                "main",
                "assets",
                "public",
                path
              )
            )
          )
          .digest("hex")
      ).toBe(sha256);
    }
    expect(playStoreReleaseTests).toContain(
      "writeAndroidWebAssetInventory(assetRoot);"
    );
    const zipFixtureSource = playStoreReleaseTests.match(
      /function createZipFixture\([\s\S]*?\n}\n\nfunction buildAndroidRuntimeIndexHtml/
    )?.[0];
    expect(zipFixtureSource).toBeDefined();
    expect(zipFixtureSource).not.toContain(
      "generate-android-web-asset-inventory.mjs"
    );
    expect(appBuildGradle).toContain(
      "def configuredFrontendRepositoryPath = (System.getenv('SECPAL_ANDROID_FRONTEND_DIR') ?: '').trim()"
    );
    expect(appBuildGradle).toContain(
      "new File(androidRepositoryRoot, configuredFrontendRepositoryPath).canonicalFile"
    );
    expect(appBuildGradle).toContain(
      ": new File(androidRepositoryRoot.parentFile, 'frontend')"
    );
    expect(appBuildGradle).not.toContain("gradle.startParameter.taskNames");
    expect(appBuildGradle).toContain(
      'tasks.register("requireFrontendSourceForAndroidPackaging")'
    );
    expect(appBuildGradle).toContain(
      "androidComponents.onVariants(androidComponents.selector().all()) { variant ->"
    );
    expect(appBuildGradle).toContain('if (variant.name != "ctRegression")');
    expect(appBuildGradle).not.toContain("android.applicationVariants");
    expect(appBuildGradle).toContain(
      '"package${variantTaskSuffix}UniversalApk"'
    );
    expect(appBuildGradle).toContain('"sign${variantTaskSuffix}Bundle"');
    expect(appBuildGradle).toContain(
      "tasks.matching { it.name == packagingTaskName }"
    );
    expect(appBuildGradle).toContain("gradle.taskGraph.hasTask(taskPath)");
    expect(appBuildGradle).toContain(
      'onlyIf("packaging is scheduled without frontend source")'
    );
    expect(appBuildGradle).toContain(
      "Android packaging requires the SecPal frontend source"
    );
    expect(appBuildGradle).toMatch(
      /tasks\.register\("verifyAndroidRuntimeSchemaAsset", Exec\)\s*\{[\s\S]*dependsOn\("prepareAndroidRuntimeSchemaAsset"\)/
    );
    expect(appBuildGradle).toMatch(
      /tasks\.register\("prepareAndroidRuntimeSchemaAsset", Exec\)\s*\{[\s\S]*workingDir androidRepositoryRoot[\s\S]*commandLine\(\s*"npm",\s*"run",\s*"cap:copy"\s*\)/
    );
    expect(appBuildGradle).toMatch(
      /tasks\.matching\s*\{\s*it\.name == "preBuild"\s*\}[\s\S]*dependsOn\("verifyAndroidRuntimeSchemaAsset"\)/
    );
    expect(appBuildGradle).toMatch(
      /tasks\.register\("prepareAndroidRuntimeSchemaAsset", Exec\)\s*\{[\s\S]*?onlyIf\("frontend source is present"\)\s*\{\s*frontendRepositoryRoot\.isDirectory\(\)\s*\}/
    );
    expect(appBuildGradle).toMatch(
      /tasks\.matching\s*\{\s*it\.name == "preBuild"\s*\}[\s\S]*dependsOn\(frontendPackagingGuard\)/
    );
    expect(packageJson.scripts["native:verify:packaging-guard"]).toBe(
      "bash ./scripts/with-android-env.sh bash ./scripts/verify-android-packaging-guard.sh"
    );
    expect(qualityWorkflow).toContain(
      "run: npm run native:verify:packaging-guard"
    );
  });

  it("keeps complete WebView artifact verification off native-only ctRegression packages", () => {
    const packagingGuardScript = readRepoFile(
      "scripts",
      "verify-android-packaging-guard.sh"
    );

    expect(packagingGuardScript).toContain(":app:assembleCtRegression");
    expect(packagingGuardScript).toMatch(
      /:app:assembleRelease[\s\S]*:app:bundleRelease[\s\S]*:app:packageReleaseBundle[\s\S]*:app:packageReleaseUniversalApk[\s\S]*:app:signReleaseBundle/
    );
    expect(packagingGuardScript).not.toContain("app-ctRegression.apk");
    expect(packagingGuardScript).not.toContain(
      "verify-android-runtime-schema.mjs"
    );
  });

  it("documents the schema-4-only runtime contract without rollout gates", () => {
    const runtimeContract = readRepoFile(
      "docs",
      "ANDROID_RUNTIME_BOOTSTRAP_CONTRACT.md"
    );
    expect(runtimeContract).toContain("requires strict integer schema `4`");
    expect(runtimeContract).toContain(
      "Stable and Beta artifacts must embed the canonical schema-4 bridge"
    );
    expect(runtimeContract).toMatch(
      /must not\s+remain available as an Android release/
    );
    expect(runtimeContract).not.toMatch(/schemas?(?: versions?)? `3`/i);
    expect(runtimeContract).not.toMatch(
      /Schema 4 Rollout|rollout window|support floor|first compatible Android release/i
    );
    expect(runtimeContract).not.toMatch(/\bfallback\b/i);
    expect(
      [
        runtimeContract,
        readRepoFile("docs/ANDROID_RELEASE_DISTRIBUTION.md"),
        readRepoFile("scripts/inject-native-auth-bridge.mjs"),
        readRepoFile(
          "android/app/src/main/java/app/secpal/SecPalNativeAuthPlugin.java"
        ),
      ].join("\n")
    ).not.toMatch(
      /minimumSupportedAppVersion|minimumSupportedAppBuild|minimum_supported_app_version|minimum_supported_app_build/
    );
  });

  it("blocks screenshots for SecPal activities and managed device modes", () => {
    const mainActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "MainActivity.java"
    );
    const dedicatedHomeActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "DedicatedDeviceHomeActivity.java"
    );
    const policyController = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "EnterprisePolicyController.java"
    );
    const buildGradle = readRepoFile("android", "app", "build.gradle");

    expect(mainActivity).toContain("FLAG_SECURE");
    expect(mainActivity).toContain("setWebAuthenticationSupport");
    expect(mainActivity).toContain("WEB_AUTHENTICATION_SUPPORT_FOR_APP");
    expect(mainActivity).toContain("WEB_AUTHENTICATION");
    expect(dedicatedHomeActivity).toContain("FLAG_SECURE");
    expect(policyController).toContain("setScreenCaptureDisabled");
    expect(policyController).toContain("shouldDisableScreenCapture");
    expect(buildGradle).toContain(
      'implementation "androidx.webkit:webkit:$androidxWebkitVersion"'
    );
    expect(mainActivity).toContain("WebView.setWebContentsDebuggingEnabled");
    expect(mainActivity).toContain("BuildConfig.DEBUG");
    expect(mainActivity).not.toContain(
      "BuildConfig.SCREENSHOT_PROTECTION_ENABLED"
    );
    expect(dedicatedHomeActivity).not.toContain(
      "BuildConfig.SCREENSHOT_PROTECTION_ENABLED"
    );
    expect(policyController).not.toContain(
      "BuildConfig.SCREENSHOT_PROTECTION_ENABLED"
    );
    expect(buildGradle).not.toContain(
      "SECPAL_ANDROID_ENABLE_SCREENSHOT_PROTECTION"
    );
    expect(buildGradle).not.toContain(
      "SECPAL_ANDROID_ENABLE_WEBVIEW_DEBUGGING"
    );
    expect(buildGradle).not.toContain("SCREENSHOT_PROTECTION_ENABLED");
    expect(buildGradle).not.toContain("WEBVIEW_DEBUGGING_ENABLED");
    expect(mainActivity).not.toContain("BuildConfig.WEBVIEW_DEBUGGING_ENABLED");
  });

  it("uses a WebKit lint contract that accepts the Web Authentication feature guard", () => {
    const mainActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "MainActivity.java"
    );
    const variablesGradle = readRepoFile("android", "variables.gradle");
    const webkitVersion = variablesGradle.match(
      /androidxWebkitVersion\s*=\s*'(\d+)\.(\d+)\.(\d+)'/
    );

    expect(webkitVersion).not.toBeNull();

    const [major, minor] = webkitVersion!.slice(1, 3).map(Number);

    // WebKit 1.12.1 omitted WEB_AUTHENTICATION from isFeatureSupported's external StringDef.
    expect(major > 1 || (major === 1 && minor >= 13)).toBe(true);
    expect(mainActivity).toMatch(
      /if\s*\(\s*WebViewFeature\.isFeatureSupported\(\s*WebViewFeature\.WEB_AUTHENTICATION\s*\)\s*\)\s*\{\s*WebSettingsCompat\.setWebAuthenticationSupport\(/
    );
    expect(mainActivity).toMatch(
      /WebSettingsCompat\.WEB_AUTHENTICATION_SUPPORT_FOR_APP\s*\)\s*;\s*\}\s*else\s*\{\s*Log\.w\(\s*LOG_TAG,\s*"Android WebView does not support Web Authentication"\s*\)/
    );
  });

  it("declares a device-admin receiver for dedicated-device provisioning", () => {
    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    const deviceAdminXml = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "secpal_device_admin.xml"
    );

    expect(manifest).toContain("SecPalDeviceAdminReceiver");
    expect(manifest).toContain("DedicatedDeviceHomeActivity");
    expect(manifest).toContain("android.intent.category.LAUNCHER");
    expect(manifest).toContain("android.settings.SETTINGS");
    expect(manifest).toContain("android.settings.WIFI_SETTINGS");
    expect(manifest).toContain("android.permission.BIND_DEVICE_ADMIN");
    expect(manifest).toContain(
      "android.app.action.PROFILE_PROVISIONING_COMPLETE"
    );
    expect(deviceAdminXml).toContain("<device-admin");
    expect(deviceAdminXml).toContain("<force-lock />");
  });

  it("declares Samsung Knox hardware-button receiver and launch aliases", () => {
    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    const receiver = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "SamsungHardKeyReceiver.java"
    );

    expect(manifest).toContain("SamsungHardKeyReceiver");
    expect(manifest).toMatch(
      /<receiver\b(?=[^>]*android:name="\.SamsungHardKeyReceiver")(?=[^>]*android:exported="true")(?=[^>]*android:permission="com\.samsung\.android\.knox\.permission\.KNOX_CUSTOM_SETTING")[^>]*>/
    );
    expect(manifest).not.toMatch(
      /<receiver\b(?=[^>]*android:name="\.SamsungHardKeyReceiver")[^>]*tools:ignore="ExportedReceiver"/
    );
    expect(receiver).not.toContain("getSentFromUid");
    expect(receiver).not.toContain("getPackagesForUid");
    expect(manifest).toContain(
      "com.samsung.android.knox.intent.action.HARD_KEY_PRESS"
    );
    expect(manifest).toContain(
      "com.samsung.android.knox.intent.action.HARD_KEY_REPORT"
    );
    expect(manifest).toContain(
      "Samsung's managed-key contract requires the platform-signature-protected"
    );
    expect(manifest).toMatch(
      /<meta-data\b[^>]*android:name="com\.samsung\.android\.knox\.intent\.action\.HARD_KEY_PRESS"[^>]*android:value="true"[^>]*\/?>/
    );
    expect(manifest).toContain('android:name="app_key_ptt_data"');
    expect(manifest).toContain('android:name="app_key_sos_data"');
    expect(manifest).toContain("SamsungEmergencyShortPressAlias");
    expect(manifest).toContain("SamsungEmergencyLongPressAlias");
  });

  it("wires Samsung partner app-key manifest placeholders through the Android build", () => {
    const buildGradle = readRepoFile("android", "app", "build.gradle");

    expect(buildGradle).toContain("SECPAL_ANDROID_SAMSUNG_APP_KEY_PTT_DATA");
    expect(buildGradle).toContain("SECPAL_ANDROID_SAMSUNG_APP_KEY_SOS_DATA");
    expect(buildGradle).toContain("manifestPlaceholders");
    expect(buildGradle).toContain("secpalSamsungAppKeyPttData");
    expect(buildGradle).toContain("secpalSamsungAppKeySosData");
  });

  it("marks debug builds as test-only so adb can remove test device owners", () => {
    const debugManifest = readRepoFile(
      "android",
      "app",
      "src",
      "debug",
      "AndroidManifest.xml"
    );

    expect(debugManifest).toContain('android:testOnly="true"');
  });

  it("restricts debug enterprise-policy broadcasts to the adb shell", () => {
    const debugManifest = readRepoFile(
      "android",
      "app",
      "src",
      "debug",
      "AndroidManifest.xml"
    );

    expect(debugManifest).toMatch(
      /<receiver\b(?=[^>]*android:name="\.DebugEnterprisePolicyReceiver")(?=[^>]*android:exported="true")(?=[^>]*android:permission="android\.permission\.DUMP")[^>]*>/
    );
    expect(debugManifest).toContain(
      "Only the adb shell caller needs this debug-only receiver"
    );
    expect(debugManifest).toContain("DEBUG_SET_ENTERPRISE_POLICY");
    expect(debugManifest).toContain("DEBUG_CLEAR_ENTERPRISE_POLICY");
  });

  it("clears the dedicated-device gesture preference when debug policy is reset", () => {
    const policyController = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "EnterprisePolicyController.java"
    );

    expect(policyController).toContain(
      'editor.remove("prefer_gesture_navigation")'
    );
  });

  it("documents the ImageMagick prerequisite for brand asset sync", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain("ImageMagick");
    expect(readme).toContain("npm run brand:sync");
    expect(readme).toContain("magick");
  });

  it("documents dedicated-device provisioning behavior in the README", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain("same `SecPal` app");
    expect(readme).toContain("secpal_kiosk_mode_enabled");
    expect(readme).toContain("secpal_lock_task_enabled");
    expect(readme).toContain("secpal_allow_phone");
    expect(readme).toContain("secpal_allow_sms");
    expect(readme).toContain("secpal_prefer_gesture_navigation");
    expect(readme).toContain("debug build");
    expect(readme).toContain("remove-active-admin");
    expect(readme).toContain("native provisioning flow");
    expect(readme).not.toContain("openGestureNavigationSettings");
    expect(readme).toContain("SECPAL_ANDROID_SAMSUNG_APP_KEY_PTT_DATA");
    expect(readme).toContain("SECPAL_ANDROID_SAMSUNG_APP_KEY_SOS_DATA");
  });

  it("keeps Android fastlane release automation on the local signing flow", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const readme = readRepoFile("README.md");
    const distributionDoc = readRepoFile(
      "docs",
      "ANDROID_RELEASE_DISTRIBUTION.md"
    );
    const schema3WithdrawalEvidence = readRepoFile(
      "docs",
      "release-evidence",
      "2026-07-24-schema-3-artifact-withdrawal.md"
    );
    const fastfile = readRepoFile("fastlane", "Fastfile");
    const releaseEnvLoader = readRepoFile(
      "scripts",
      "load-android-release-env.sh"
    );
    const gemfile = readRepoFile("Gemfile");
    const releaseRubyTest = readRepoFile(
      "fastlane",
      "test",
      "secpal_android_release_test.rb"
    );
    const gemfilePath = resolve(repoRoot, "Gemfile");
    const appfilePath = resolve(repoRoot, "fastlane", "Appfile");
    const fastfilePath = resolve(repoRoot, "fastlane", "Fastfile");

    expect(existsSync(gemfilePath)).toBe(true);
    expect(existsSync(appfilePath)).toBe(true);
    expect(existsSync(fastfilePath)).toBe(true);
    expect(gemfile.match(/^\s*gem "minitest", "~> 6\.0"\s*$/gm)).toHaveLength(
      1
    );
    expect(
      gemfile.match(/^\s*gem "minitest-mock", "~> 5\.27"\s*$/gm)
    ).toHaveLength(1);
    expect(releaseRubyTest).toContain('require "minitest/mock"');
    expect(
      packageJson.scripts["test:ruby"]
        .split(" && ")
        .every((command) => command.startsWith("bundle exec ruby "))
    ).toBe(true);
    expect(packageJson.scripts["fastlane:install"]).toContain("bundle install");
    expect(packageJson.scripts["native:assemble:release:signed"]).toContain(
      "require-android-build-version-code.rb"
    );
    expect(packageJson.scripts["native:bundle:release:signed"]).toContain(
      "require-android-build-version-code.rb"
    );
    expect(packageJson.scripts["native:assemble:store-listing"]).toContain(
      "./gradlew assembleStoreListing"
    );
    expect(packageJson.scripts["native:assemble:release:signed"]).toContain(
      "verify-android-runtime-schema.mjs"
    );
    expect(packageJson.scripts["native:bundle:release:signed"]).toContain(
      "verify-android-runtime-schema.mjs"
    );
    expect(packageJson.scripts["fastlane:android:build:signed-aab"]).toContain(
      "bundle exec fastlane android build_signed_aab"
    );
    expect(packageJson.scripts["fastlane:android:build:signed-apk"]).toContain(
      "bundle exec fastlane android build_signed_apk"
    );
    expect(packageJson.scripts["fastlane:android:deploy:internal"]).toContain(
      "bundle exec fastlane android deploy_internal"
    );
    expect(packageJson.scripts["fastlane:android:deploy:direct-apk"]).toContain(
      "bundle exec fastlane android deploy_direct_apk"
    );
    expect(
      packageJson.scripts["fastlane:android:deploy:direct-apk:beta"]
    ).toContain("SECPAL_ANDROID_DIRECT_CHANNEL=beta");
    expect(packageJson.scripts["fastlane:android:deploy:beta-apk"]).toContain(
      "bundle exec fastlane android deploy_direct_apk_beta"
    );
    expect(
      packageJson.scripts["fastlane:android:withdraw:direct-apks"]
    ).toBeUndefined();
    expect(readme).toContain("Fastlane");
    expect(readme).toContain("npm run fastlane:android:build:signed-aab");
    expect(readme).toContain("npm run fastlane:android:deploy:internal");
    expect(readme).toContain("npm run fastlane:android:deploy:direct-apk");
    expect(readme).toContain("apk.secpal.app");
    expect(readme).toContain("SECPAL_ANDROID_DIRECT_SSH_HOST");
    expect(readme).toContain("SECPAL_ANDROID_DIRECT_CHANNEL");
    expect(readme).not.toContain(
      "npm run fastlane:android:withdraw:direct-apks"
    );
    expect(readme).not.toContain("SECPAL_ANDROID_WITHDRAW_VERSIONS");
    expect(readme).not.toContain("atomically marks Stable");
    expect(readme).toContain("https://apk.secpal.app/android/beta/latest.json");
    expect(readme).toContain(
      "https://apk.secpal.app/android/stable/latest.json"
    );
    expect(readme).toContain("SECPAL_ANDROID_PLAY_JSON_KEY_PATH");
    expect(readme).toContain(
      "signed APK and AAB embed the canonical schema-4 Android bridge"
    );
    expect(distributionDoc).toContain("Fastlane");
    expect(distributionDoc).toContain("SECPAL_ANDROID_PLAY_JSON_KEY_PATH");
    expect(distributionDoc).toContain("internal testing track");
    expect(distributionDoc).toContain("apk.secpal.app");
    expect(distributionDoc).toContain("SECPAL_ANDROID_DIRECT_SSH_HOST");
    expect(distributionDoc).toContain("SECPAL_ANDROID_DIRECT_CHANNEL");
    expect(distributionDoc).not.toContain(
      "fastlane android withdraw_direct_apks"
    );
    expect(distributionDoc).not.toContain(
      "SECPAL_ANDROID_DIRECT_WITHDRAWAL_ROOT"
    );
    expect(distributionDoc).not.toContain("atomically changes the Stable");
    expect(schema3WithdrawalEvidence).toContain("0.0.1-261932118");
    expect(schema3WithdrawalEvidence).toContain("0.0.1-261932119");
    expect(schema3WithdrawalEvidence).toContain("HTTP `404`");
    expect(schema3WithdrawalEvidence).toContain(
      "No recoverable schema-3 artifact remains on the server"
    );
    expect(distributionDoc).toContain(
      "https://apk.secpal.app/android/beta/latest.json"
    );
    expect(distributionDoc).toContain(
      "signed APK and AAB embed the canonical schema-4 Android bridge"
    );
    expect(fastfile).toContain('File.expand_path("..", __dir__)');
    expect(fastfile).toContain("deploy_direct_apk");
    expect(fastfile).toContain("deploy_direct_apk_beta");
    expect(fastfile).toContain("SECPAL_ANDROID_DIRECT_SSH_HOST");
    expect(fastfile).toContain("SECPAL_ANDROID_DIRECT_CHANNEL");
    expect(fastfile).toContain("APK_DIRECT_CHANNELS = %w[stable beta].freeze");
    expect(fastfile).toContain('APK_UPDATE_CHANNEL = "stable"');
    expect(fastfile).toContain("stable_direct_channel?");
    expect(fastfile).toContain("direct_channel_root_url");
    expect(fastfile).toContain("Unsupported direct APK channel");
    expect(fastfile).toContain("scp");
    expect(fastfile).toContain("Digest::SHA256.file");
    expect(fastfile).toContain('APK_UPDATE_CHANNEL = "stable"');
    expect(fastfile).toContain("app_signing_certificate_sha256");
    expect(fastfile).toContain("signing_key_shared_with_google_play");
    expect(fastfile).toContain("versioned_checksum_url");
    expect(fastfile).not.toContain("release_available: false");
    expect(fastfile).toContain("def verify_android_runtime_schema_artifact!");
    expect(fastfile).toContain(
      "verify_android_runtime_schema_artifact!(signed_apk_path)"
    );
    expect(fastfile).toContain(
      "verify_android_runtime_schema_artifact!(signed_aab_path)"
    );
    expect(fastfile).toContain("published_at: Time.now.utc.iso8601");
    expect(fastfile).toContain("select_publish_version_code!");
    expect(fastfile).toContain("configured_last_published_version_code");
    expect(fastfile).toContain("SECPAL_ANDROID_DEPLOY_VERSION_CODE");
    expect(fastfile).toContain("google_play_track_version_codes");
    expect(fastfile).toContain("PLAY_VERSION_CODE_TRACKS");
    expect(fastfile).toContain("SecPalAndroidVersioning.next_version_code");
    expect(fastfile).toContain("with_android_publish_lock");
    expect(fastfile).toContain('ENV["SECPAL_ANDROID_VERSION_CODE"]');
    expect(fastfile).toContain("load-android-release-env.sh");
    expect(releaseEnvLoader).toContain('$(dirname "${BASH_SOURCE[0]}")');
    expect(releaseEnvLoader).toContain('overrides+=("$key=${!key}")');
    expect(releaseEnvLoader).toContain('exec env "${overrides[@]}"');
    expect(releaseEnvLoader).toContain("with-android-env.sh");
  });

  it("keeps a dedicated store-listing build path separate from hardened release builds", () => {
    const buildGradle = readRepoFile("android", "app", "build.gradle");
    const mainActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "MainActivity.java"
    );
    const dedicatedHomeActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "DedicatedDeviceHomeActivity.java"
    );

    expect(buildGradle).toContain("storeListing");
    expect(buildGradle).toContain(
      'buildConfigField "boolean", "ALLOW_SCREENSHOTS", "true"'
    );
    expect(buildGradle).toContain('applicationIdSuffix ".storelisting"');
    expect(mainActivity).toContain("BuildConfig.ALLOW_SCREENSHOTS");
    expect(dedicatedHomeActivity).toContain("BuildConfig.ALLOW_SCREENSHOTS");
  });

  it("does not expose lock-task exit settings through the WebView enterprise bridge", () => {
    const changelog = readRepoFile("CHANGELOG.md");
    const plugin = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "SecPalEnterprisePlugin.java"
    );
    const navigationController = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "SystemNavigationController.java"
    );
    const injector = readRepoFile("scripts", "inject-native-auth-bridge.mjs");

    expect(changelog).not.toContain(
      "SecPalEnterprisePlugin` and the injected `SecPalEnterpriseBridge` can now open the device's official navigation-mode settings screen from SecPal itself"
    );
    expect(plugin).not.toContain("openGestureNavigationSettings");
    expect(plugin).toContain("gestureNavigationEnabled");
    expect(plugin).toContain("gestureNavigationSettingsAvailable");
    expect(navigationController).toContain(
      "applyProvisioningGestureNavigationIfRequested"
    );
    expect(navigationController).toContain(
      "maybeCompleteProvisioningGestureNavigation"
    );
    expect(navigationController).toContain("managedState.isDeviceOwner()");
    expect(navigationController).toContain(
      "managedState.isPreferGestureNavigation()"
    );
    expect(navigationController).toContain(
      "EnterprisePolicyController.temporarilyExitLockTask(activity)"
    );
    expect(navigationController).toContain(
      "EnterprisePolicyController.maybeEnterLockTask(activity)"
    );
    expect(navigationController).toContain("setSecureSetting(");
    expect(navigationController).toContain("setGlobalSetting(");
    expect(navigationController).toContain(
      "com.samsung.settings.NAVIGATION_BAR_SETTING"
    );
    expect(navigationController).toContain(
      "com.android.settings.GESTURE_NAVIGATION_SETTINGS"
    );
    expect(injector).toContain("SecPalEnterpriseBridge");
    expect(injector).not.toContain("openGestureNavigationSettings");
  });

  it("keeps the enterprise launcher implementation vendor-neutral", () => {
    const policyController = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "EnterprisePolicyController.java"
    );
    const managedState = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "EnterpriseManagedState.java"
    );
    const dedicatedHomeActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "DedicatedDeviceHomeActivity.java"
    );

    expect(policyController).not.toMatch(VENDOR_SPECIFIC_PATTERN);
    expect(managedState).not.toMatch(VENDOR_SPECIFIC_PATTERN);
    expect(dedicatedHomeActivity).not.toMatch(VENDOR_SPECIFIC_PATTERN);
  });

  it("only shows Phone and SMS tiles when Android can resolve real handlers", () => {
    const policyController = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "EnterprisePolicyController.java"
    );
    const managedState = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "EnterpriseManagedState.java"
    );
    const dedicatedHomeActivity = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "DedicatedDeviceHomeActivity.java"
    );

    expect(managedState).toContain("queryIntentActivities(intent, 0)");
    expect(policyController).toContain("resolveLaunchableIntent");
    expect(policyController).toContain("resolveFirstComponent");
    expect(policyController).toContain("applied_policy_signature");
    expect(policyController).toContain("buildAppliedPolicySignature");
    expect(policyController).toContain("managed_hidden_packages");
    expect(policyController).toContain("restoreManagedHiddenPackages");
    expect(policyController).toContain("excludedPackages");
    expect(policyController).toContain(
      "managedState.resolveDialerPackage(context)"
    );
    expect(policyController).toContain(
      "managedState.resolveSmsPackage(context)"
    );
    expect(managedState).toContain("ContactsContract.AUTHORITY");
    expect(managedState).toContain("ACTION_INSERT_OR_EDIT");
    expect(managedState).toContain("resolveContactSupportPackages");
    expect(dedicatedHomeActivity).toContain(
      "managedState.isAllowPhone() && dialerPackage != null"
    );
    expect(dedicatedHomeActivity).toContain(
      "managedState.isAllowSms() && smsPackage != null"
    );
  });

  it("locks down status-bar shortcuts and system configuration in kiosk mode", () => {
    const policyController = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "EnterprisePolicyController.java"
    );
    const readme = readRepoFile("README.md");

    expect(policyController).toContain("@RequiresApi(Build.VERSION_CODES.P)");
    expect(policyController).toContain(
      "setLockTaskFeaturesIfSupported(devicePolicyManager, adminComponent, true)"
    );
    expect(policyController).toContain(
      "DevicePolicyManager.LOCK_TASK_FEATURE_HOME"
    );
    expect(policyController).toContain("UserManager.DISALLOW_CONFIG_DATE_TIME");
    expect(policyController).toContain(
      "setStatusBarDisabled(adminComponent, true)"
    );
    expect(policyController).toContain(
      "setKioskUserRestrictions(devicePolicyManager, adminComponent, true)"
    );
    expect(policyController).toContain("KIOSK_REDIRECTED_SETTINGS_ACTIONS");
    expect(policyController).toContain("android.settings.SETTINGS");
    expect(policyController).toContain(
      "android.settings.APPLICATION_DEVELOPMENT_SETTINGS"
    );
    expect(policyController).toContain("android.settings.WIFI_SETTINGS");
    expect(policyController).toContain("UserManager.DISALLOW_CONFIG_WIFI");
    expect(policyController).toContain("UserManager.DISALLOW_CONFIG_BLUETOOTH");
    expect(policyController).toContain(
      "UserManager.DISALLOW_CONFIG_MOBILE_NETWORKS"
    );
    expect(policyController).toContain(
      "private static final int DEVICE_OWNER_POLICY_REVISION = 2"
    );
    expect(policyController).toMatch(
      /setKioskUserRestrictions\(\s*devicePolicyManager,\s*adminComponent,\s*enabled,\s*BuildConfig\.DEBUG\s*\)/
    );
    expect(policyController).toContain("if (debugBuild)");
    expect(policyController).toContain(
      "resolveKioskUserRestrictions(debugBuild)"
    );
    expect(policyController).toContain(
      "restrictions.remove(UserManager.DISALLOW_INSTALL_APPS)"
    );
    expect(policyController).toMatch(
      /clearUserRestriction\(\s*adminComponent,\s*UserManager\.DISALLOW_INSTALL_APPS\s*\)/
    );
    expect(policyController).toContain("UserManager.DISALLOW_INSTALL_APPS");
    expect(policyController).toContain("UserManager.DISALLOW_UNINSTALL_APPS");
    expect(readme).not.toContain("com.android.settings");
  });
});
