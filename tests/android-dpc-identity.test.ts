/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

describe("separate DPC application authority", () => {
  it("materializes a second application without moving Work runtime", () => {
    expect(read("android/settings.gradle")).toContain("include ':dpc'");
    const dpc = read("android/dpc/build.gradle");
    expect(dpc).toContain("apply plugin: 'com.android.application'");
    expect(dpc).toContain('applicationId "io.secpal.dpc"');
    expect(read("android/app/build.gradle")).toContain(
      'applicationId "app.secpal"'
    );
    const work = read("android/app/src/main/AndroidManifest.xml");
    const manifest = read("android/dpc/src/main/AndroidManifest.xml");
    expect(work).not.toMatch(
      /DpcPolicyApplication|SecPalDeviceAdminReceiver|SamsungHardKeyReceiver/
    );
    expect(manifest).toMatch(/DpcPolicyApplication/);
    expect(manifest).toMatch(/android.permission.BIND_DEVICE_ADMIN/);
    expect(manifest).toMatch(/android.app.action.DEVICE_ADMIN_SERVICE/);
    expect(manifest).not.toMatch(/MainActivity|WebView|INTERNET/);
    expect(
      existsSync("android/app/src/main/java/app/secpal/DpcPolicyEnforcer.java")
    ).toBe(false);
    expect(
      read("android/dpc/src/main/java/app/secpal/DpcPolicyEnforcer.java")
    ).toContain("setLockTaskPackages");
  });

  it("uses independent credentials and an authenticated read-only state boundary", () => {
    const dpc = read("android/dpc/build.gradle");
    expect(dpc).toContain("SECPAL_DPC_KEYSTORE_PATH");
    expect(dpc).not.toContain("SECPAL_ANDROID_KEYSTORE");
    expect(dpc).toContain("dpc-debug.keystore");
    expect(dpc).toContain("verifyDpcSigningAuthority");
    const provider = read(
      "android/dpc/src/main/java/app/secpal/DpcManagementProvider.java"
    );
    expect(provider).toContain("Binder.getCallingUid()");
    expect(provider).toContain("ManagementPackageIdentity");
    expect(provider).not.toContain("DpcPolicyEnforcer");
    const consumer = read(
      "android/consumer/java/app/secpal/EnterprisePolicyState.java"
    );
    expect(consumer).toContain("ManagementPackageIdentity");
    expect(consumer).toContain("acquireUnstableContentProviderClient");
    expect(consumer).not.toMatch(
      /fromPreferences|fromBundle|setApplicationRestrictions|DpcPolicyEnforcer/
    );
  });
});
