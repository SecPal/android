/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// SHA-256 base64-encoded SubjectPublicKeyInfo (SPKI) hashes used for
// api.secpal.dev certificate pinning (primary and backup pins).
const API_CERT_PRIMARY_PIN = "3BJmezOWc04OlOrJ501K2t07GXxrHS5qQC7T7OnnO7k=";
const API_CERT_BACKUP_PIN = "iFvwVyJSxnQdyaUvUERIf+8qk7gRze3612JMwoO3zdU=";

const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

const VENDOR_SPECIFIC_PATTERN = /Samsung|samsung|com\.sec\./;

describe("Android native hardening", () => {
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
    expect(mainActivity).toMatch(
      /private void scheduleProvisioningBootstrapSync\(\) \{\s+if \(!secureBridgeStarted\) \{\s+return;/
    );
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

  it("pins a patched xmldom version for Capacitor CLI tooling", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      overrides?: Record<string, unknown>;
    };
    const packageLock = JSON.parse(readRepoFile("package-lock.json")) as {
      packages?: Record<string, { version?: string }>;
    };

    expect(packageJson.overrides?.["@xmldom/xmldom"]).toBe("0.8.13");
    expect(packageLock.packages?.["node_modules/@xmldom/xmldom"]?.version).toBe(
      "0.8.13"
    );
  });

  it("pins a patched postcss version for the Vite toolchain", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      overrides?: Record<string, unknown>;
    };
    const packageLock = JSON.parse(readRepoFile("package-lock.json")) as {
      packages?: Record<string, { version?: string }>;
    };

    expect(packageJson.overrides?.postcss).toBe("8.5.10");
    expect(packageLock.packages?.["node_modules/postcss"]?.version).toBe(
      "8.5.10"
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

    expect(variablesGradle).toMatch(
      /androidxCredentialsVersion\s*=\s*'1\.6\.0'/
    );
    expect(buildGradle).not.toMatch(
      /implementation\s+["']androidx\.credentials:credentials-play-services-auth/
    );
    expect(buildGradle).not.toMatch(
      /implementation\s+["']com\.google\.android\.gms:play-services-fido/
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

  it("locks file sharing to dedicated subdirectories and disables cleartext traffic", () => {
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
    const networkSecurityConfigPath = resolve(
      repoRoot,
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "network_security_config.xml"
    );

    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain(
      'android:networkSecurityConfig="@xml/network_security_config"'
    );
    expect(filePaths).not.toContain('path="."');
    expect(filePaths).toContain('name="shared_files" path="shared/"');
    expect(filePaths).toContain('name="shared_cache" path="shared/"');
    expect(existsSync(networkSecurityConfigPath)).toBe(true);

    const networkSecurityConfig = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml",
      "network_security_config.xml"
    );

    expect(networkSecurityConfig).toContain(
      '<base-config cleartextTrafficPermitted="false" />'
    );
    expect(networkSecurityConfig).toContain(
      '<domain includeSubdomains="false">api.secpal.dev</domain>'
    );
    expect(networkSecurityConfig).toContain(API_CERT_PRIMARY_PIN);
    expect(networkSecurityConfig).toContain(API_CERT_BACKUP_PIN);
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

  it("keeps provisioning bootstrap on the canonical API origin", () => {
    const stringsXml = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml"
    );
    const coordinator = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "secpal",
      "ProvisioningBootstrapCoordinator.java"
    );

    expect(stringsXml).toContain(
      '<string name="api_base_url">https://runtime-bootstrap-required.secpal.dev</string>'
    );
    expect(stringsXml).toContain(
      '<string name="provisioning_bootstrap_api_base_url">https://api.secpal.dev</string>'
    );
    expect(coordinator).toContain(
      "R.string.provisioning_bootstrap_api_base_url"
    );
    expect(coordinator).not.toContain("R.string.api_base_url");
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

    expect(manifest).toContain("SamsungHardKeyReceiver");
    expect(manifest).toMatch(
      /<receiver\b[^>]*android:name="\.SamsungHardKeyReceiver"[^>]*android:exported="true"/
    );
    expect(manifest).toContain(
      "com.samsung.android.knox.intent.action.HARD_KEY_PRESS"
    );
    expect(manifest).toContain(
      "com.samsung.android.knox.intent.action.HARD_KEY_REPORT"
    );
    expect(manifest).toContain(
      "Knox hard-key broadcasts come from outside the app UID"
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
    const fastfile = readRepoFile("fastlane", "Fastfile");
    const releaseEnvLoader = readRepoFile(
      "scripts",
      "load-android-release-env.sh"
    );
    const gemfilePath = resolve(repoRoot, "Gemfile");
    const appfilePath = resolve(repoRoot, "fastlane", "Appfile");
    const fastfilePath = resolve(repoRoot, "fastlane", "Fastfile");

    expect(existsSync(gemfilePath)).toBe(true);
    expect(existsSync(appfilePath)).toBe(true);
    expect(existsSync(fastfilePath)).toBe(true);
    expect(packageJson.scripts["fastlane:install"]).toContain("bundle install");
    expect(packageJson.scripts["native:assemble:store-listing"]).toContain(
      "./gradlew assembleStoreListing"
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
    expect(readme).toContain("Fastlane");
    expect(readme).toContain("npm run fastlane:android:build:signed-aab");
    expect(readme).toContain("npm run fastlane:android:deploy:internal");
    expect(readme).toContain("npm run fastlane:android:deploy:direct-apk");
    expect(readme).toContain("apk.secpal.app");
    expect(readme).toContain("SECPAL_ANDROID_DIRECT_SSH_HOST");
    expect(readme).toContain("SECPAL_ANDROID_DIRECT_CHANNEL");
    expect(readme).toContain("https://apk.secpal.app/android/beta/latest.json");
    expect(readme).toContain(
      "https://apk.secpal.app/android/stable/latest.json"
    );
    expect(readme).toContain("SECPAL_ANDROID_PLAY_JSON_KEY_PATH");
    expect(distributionDoc).toContain("Fastlane");
    expect(distributionDoc).toContain("SECPAL_ANDROID_PLAY_JSON_KEY_PATH");
    expect(distributionDoc).toContain("internal testing track");
    expect(distributionDoc).toContain("apk.secpal.app");
    expect(distributionDoc).toContain("SECPAL_ANDROID_DIRECT_SSH_HOST");
    expect(distributionDoc).toContain("SECPAL_ANDROID_DIRECT_CHANNEL");
    expect(distributionDoc).toContain(
      "https://apk.secpal.app/android/beta/latest.json"
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
    expect(fastfile).toContain("release_available: false");
    expect(fastfile).toContain("published_at: Time.now.utc.iso8601");
    expect(fastfile).toContain("next_deploy_version_code");
    expect(fastfile).toContain("configured_release_version_code");
    expect(fastfile).toContain("SECPAL_ANDROID_DEPLOY_VERSION_CODE");
    expect(fastfile).toContain("google_play_track_version_codes");
    expect(fastfile).toContain("PLAY_VERSION_CODE_TRACKS");
    expect(fastfile).toContain("Time.now.utc.strftime");
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

    expect(policyController).toContain("KIOSK_LOCK_TASK_FEATURES");
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
    expect(policyController).toContain("UserManager.DISALLOW_INSTALL_APPS");
    expect(readme).not.toContain("com.android.settings");
  });
});
