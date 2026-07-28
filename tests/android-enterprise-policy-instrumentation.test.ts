/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

describe("Android enterprise policy instrumentation contract", () => {
  it("proves managed install restrictions through the platform device-owner API", () => {
    const instrumentedTest = readRepoFile(
      "android",
      "app",
      "src",
      "androidTest",
      "java",
      "app",
      "secpal",
      "EnterprisePolicyInstrumentedTest.java"
    );
    const workflow = readRepoFile(
      ".github",
      "workflows",
      "android-enterprise-policy.yml"
    );
    const proguardRules = readRepoFile(
      "android",
      "app",
      "ct-regression-proguard-rules.pro"
    );
    const devicePolicyWaitScript = readRepoFile(
      "scripts",
      "wait-for-device-policy-account-scan.sh"
    );
    const devicePolicyWaitCommand =
      "bash ./scripts/wait-for-device-policy-account-scan.sh emulator-5570 60";

    expect(instrumentedTest).toContain("isDeviceOwnerApp");
    expect(instrumentedTest).toContain(
      "EnterprisePolicyController.setKioskUserRestrictions"
    );
    expect(instrumentedTest).toContain("UserManager.DISALLOW_INSTALL_APPS");
    expect(instrumentedTest).toContain("assertTrue");
    expect(instrumentedTest).toContain("assertFalse");

    expect(workflow).toContain(":app:assembleCtRegressionAndroidTest");
    expect(workflow).toContain(
      'image="system-images;android-35;default;x86_64"'
    );
    expect(workflow).not.toContain(
      "system-images;android-35;google_apis;x86_64"
    );
    expect(workflow).toContain("app-ctRegression.apk");
    expect(workflow).toContain("app-ctRegression-androidTest.apk");
    expect(workflow.match(/adb -s emulator-5570 install -t -r/g)).toHaveLength(
      2
    );
    expect(workflow).toContain(devicePolicyWaitCommand);
    expect(workflow.indexOf(devicePolicyWaitCommand)).toBeLessThan(
      workflow.indexOf("dpm set-device-owner")
    );
    expect(workflow).toContain("dpm set-device-owner");
    expect(workflow).toContain("app.secpal.EnterprisePolicyInstrumentedTest");
    expect(workflow).toContain("dpm remove-active-admin");
    expect(devicePolicyWaitScript).toContain(
      "Finished calculating hasIncompatibleAccountsTask"
    );
    expect(devicePolicyWaitScript).toContain("dumpsys account");
    expect(proguardRules).toContain(
      "-keep class app.secpal.EnterprisePolicyController"
    );
    expect(proguardRules).toContain(
      "static void setKioskUserRestrictions(android.app.admin.DevicePolicyManager, android.content.ComponentName, boolean, boolean);"
    );
  });
});
