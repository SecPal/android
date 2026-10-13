/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

// Structural evidence for ADR-026 application, signing, and runtime ownership.
describe("Work application boundary", () => {
  it("builds three exact independent application identities", () => {
    expect(read("android/settings.gradle")).toContain("include ':work'");
    for (const [module, identity] of [
      ["app", "app.secpal"],
      ["work", "io.secpal"],
      ["dpc", "io.secpal.dpc"],
    ]) {
      const gradle = read(`android/${module}/build.gradle`);
      expect(gradle).toContain("apply plugin: 'com.android.application'");
      expect(gradle).toContain(`applicationId "${identity}"`);
    }
  });

  it("isolates Work signing and forbids production signing pending qualification", () => {
    const gradle = read("android/work/build.gradle");
    for (const input of [
      "KEYSTORE_PATH",
      "KEYSTORE_PASSWORD",
      "KEY_ALIAS",
      "KEY_PASSWORD",
    ]) {
      expect(gradle).toContain(`SECPAL_WORK_${input}`);
    }
    expect(gradle).not.toMatch(/SECPAL_(?:ANDROID|DPC)_KEY/);
    expect(gradle).toContain("work-debug.keystore");
    expect(gradle).toContain("verifyWorkSigningAuthority");
    expect(gradle).toContain("Production Work signing is disabled");
    expect(gradle).not.toContain("signingConfig signingConfigs.debug");
  });

  it("reuses the authenticated consumer without exposing a business runtime or DPC components", () => {
    const gradle = read("android/work/build.gradle");
    expect(gradle).toContain("../consumer/java");
    expect(gradle).toContain("../management/java");
    expect(gradle).not.toMatch(/capacitor|project\(':app'\)|project\(':dpc'\)/);
    const manifest = read("android/work/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest.match(/android:exported="true"/g)).toHaveLength(1);
    expect(manifest).not.toMatch(
      /<service|<receiver|<provider|<activity-alias|INTERNET|sharedUserId|BIND_DEVICE_ADMIN|HOME|BROWSABLE/
    );
    const activity = read(
      "android/work/src/main/java/app/secpal/WorkActivity.java"
    );
    expect(activity).toContain("work_endpoint_authority_unavailable");
    expect(activity).not.toMatch(
      /WebView|BridgeActivity|DevicePolicyManager|startLockTask|SharedPreferences|Intent\(|login|token/i
    );
    const consumer = read(
      "android/consumer/java/app/secpal/EnterprisePolicyState.java"
    );
    expect(consumer).toContain("ManagementPackageIdentity.matches");
    expect(consumer).toContain("acquireUnstableContentProviderClient");
    expect(consumer).not.toMatch(
      /DpcPolicyEnforcer|setLockTaskPackages|business_authorized|approved_work/i
    );
  });
});
