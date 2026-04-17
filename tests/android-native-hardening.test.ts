/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

  it("pins a patched xmldom version for Capacitor CLI tooling", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      overrides?: Record<string, unknown>;
    };
    const packageLock = JSON.parse(readRepoFile("package-lock.json")) as {
      packages?: Record<string, { version?: string }>;
    };

    expect(packageJson.overrides?.["@xmldom/xmldom"]).toBe("0.8.12");
    expect(packageLock.packages?.["node_modules/@xmldom/xmldom"]?.version).toBe(
      "0.8.12"
    );
  });

  it("defines the Cordova access allowlist in Capacitor source config", async () => {
    const configModule = await import("../capacitor.config");
    expect(configModule).toBeDefined();
    expect(configModule.default).toBeDefined();

    const config = configModule.default as {
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
  });

  it("surfaces an error when a config module import fails", async () => {
    await expect(import("../capacitor.config.__missing__")).rejects.toThrowError();
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
    const networkSecurityConfig = readRepoFile(
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
    expect(networkSecurityConfig).toContain(
      '<base-config cleartextTrafficPermitted="false" />'
    );
    expect(networkSecurityConfig).toContain(
      '<domain includeSubdomains="false">api.secpal.dev</domain>'
    );
    expect(networkSecurityConfig).toContain(API_CERT_PRIMARY_PIN);
    expect(networkSecurityConfig).toContain(API_CERT_BACKUP_PIN);
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
    expect(readme).toContain("SecPalEnterpriseBridge");
    expect(readme).toContain("openGestureNavigationSettings");
    expect(readme).toContain("SECPAL_ANDROID_SAMSUNG_APP_KEY_PTT_DATA");
    expect(readme).toContain("SECPAL_ANDROID_SAMSUNG_APP_KEY_SOS_DATA");
  });

  it("exposes app-controlled gesture-navigation settings through the enterprise bridge", () => {
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

    expect(plugin).toContain("openGestureNavigationSettings");
    expect(plugin).toContain("gestureNavigationEnabled");
    expect(plugin).toContain("gestureNavigationSettingsAvailable");
    expect(navigationController).toContain(
      "applyProvisioningGestureNavigationIfRequested"
    );
    expect(navigationController).toContain(
      "maybeCompleteProvisioningGestureNavigation"
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
    expect(injector).toContain("openGestureNavigationSettings");
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
