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

describe("Android OSS licenses", () => {
  it("generates release notices without adding Android WebView presentation", () => {
    const rootBuildGradle = readRepoFile("android", "build.gradle");
    const appBuildGradle = readRepoFile("android", "app", "build.gradle");
    const manifest = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "AndroidManifest.xml"
    );
    const bootstrap = readRepoFile("scripts", "inject-native-auth-bridge.mjs");
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const verification = readRepoFile(
      "scripts",
      "verify-android-oss-licenses.sh"
    );

    expect(rootBuildGradle).toContain("com.android.tools.build:gradle:8.9.1");
    expect(rootBuildGradle).toContain(
      "com.google.android.gms:oss-licenses-plugin:0.13.0"
    );
    expect(appBuildGradle).toContain(
      "apply plugin: 'com.google.android.gms.oss-licenses-plugin'"
    );
    expect(appBuildGradle).toContain(
      "com.google.android.gms:play-services-oss-licenses:17.5.1"
    );
    expect(manifest).toContain(
      "com.google.android.gms.oss.licenses.v2.OssLicensesMenuActivity"
    );
    expect(manifest).toContain('tools:replace="android:theme"');
    expect(manifest).not.toContain(
      "com.google.android.gms.oss.licenses.v2.OssLicensesActivity"
    );
    expect(manifest).toContain(
      'android:name="com.google.android.gms.oss.licenses.OssLicensesMenuActivity"'
    );
    expect(manifest).toContain('tools:node="remove"');
    expect(manifest).toContain(
      'android:name="com.google.android.gms.oss.licenses.OssLicensesActivity"'
    );
    const variablesGradle = readRepoFile("android", "variables.gradle");
    expect(variablesGradle).toContain("compileSdkVersion = 36");
    expect(variablesGradle).toContain("minSdkVersion = 24");
    expect(manifest).toContain('android:exported="false"');
    expect(bootstrap).not.toContain("secpal-about-oss-licenses");
    expect(bootstrap).not.toContain("Open-source licenses");
    expect(packageJson.scripts["native:verify:oss-licenses"]).toContain(
      "with-android-env.sh bash ./scripts/verify-android-oss-licenses.sh"
    );
    expect(verification).toContain("releaseRuntimeClasspath");
    expect(verification).toContain("third_party_license_metadata");
    expect(verification).toContain("third_party_licenses");
    expect(verification).toContain("app-release.apk");
    expect(verification).toContain("app-release-unsigned.apk");
    expect(verification).not.toContain("sort -V");
    expect(verification).not.toMatch(/\|\s*grep\s+-Fq/);
  });
});
