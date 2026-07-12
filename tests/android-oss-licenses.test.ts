/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

const graphicsPathVerifier = resolve(
  repoRoot,
  "scripts",
  "verify-androidx-graphics-path.sh"
);

const createNativeLibraryArchive = (
  root: string,
  libraries: ReadonlyArray<readonly [abi: string, bytes: number]>
) => {
  const archiveRoot = join(root, "archive");
  for (const [abi, bytes] of libraries) {
    const libraryDirectory = join(archiveRoot, "lib", abi);
    mkdirSync(libraryDirectory, { recursive: true });
    const libraryPath = join(libraryDirectory, "libandroidx.graphics.path.so");
    writeFileSync(libraryPath, "");
    truncateSync(libraryPath, bytes);
  }

  const archivePath = join(root, "release.zip");
  const zipResult = spawnSync("zip", ["-q", "-r", archivePath, "."], {
    cwd: archiveRoot,
    encoding: "utf8",
  });
  expect(zipResult.status, zipResult.stderr).toBe(0);
  return archivePath;
};

const expectedLibraries = [
  ["arm64-v8a", 10_096],
  ["armeabi-v7a", 7_252],
  ["x86", 9_284],
  ["x86_64", 10_760],
] as const;

describe("Android OSS licenses", () => {
  it("generates release notices without adding Android WebView presentation", () => {
    const rootBuildGradle = readRepoFile("android", "build.gradle");
    const cordovaPluginsBuildGradle = readRepoFile(
      "android",
      "capacitor-cordova-android-plugins",
      "build.gradle"
    );
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
    const graphicsPathVerification = readRepoFile(
      "scripts",
      "verify-androidx-graphics-path.sh"
    );

    expect(rootBuildGradle).toContain("com.android.tools.build:gradle:8.9.1");
    expect(cordovaPluginsBuildGradle).toContain(
      "com.android.tools.build:gradle:8.9.1"
    );
    expect(cordovaPluginsBuildGradle).not.toContain(
      "com.android.tools.build:gradle:8.13.0"
    );
    expect(rootBuildGradle).toContain(
      "com.google.android.gms:oss-licenses-plugin:0.13.0"
    );
    expect(appBuildGradle).toContain(
      "apply plugin: 'com.google.android.gms.oss-licenses-plugin'"
    );
    expect(appBuildGradle).toContain(
      "com.google.android.gms:play-services-oss-licenses:17.5.1"
    );
    expect(appBuildGradle).toContain("preStrippedAndroidxGraphicsPath");
    expect(appBuildGradle).toContain(
      "keepDebugSymbols += [preStrippedAndroidxGraphicsPath]"
    );
    expect(manifest).toContain(
      "com.google.android.gms.oss.licenses.v2.OssLicensesMenuActivity"
    );
    expect(manifest).toMatch(
      /<activity\s+android:name="com\.google\.android\.gms\.oss\.licenses\.v2\.OssLicensesMenuActivity"\s+android:exported="false"\s+android:theme="@style\/AppTheme"\s+tools:replace="android:theme"\s*\/>/
    );
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
    expect(verification).toContain("verify-androidx-graphics-path.sh");
    expect(
      verification.match(/verify-androidx-graphics-path\.sh/g)
    ).toHaveLength(2);
    expect(graphicsPathVerification).toContain("max_bytes=40000");
    expect(graphicsPathVerification).toContain("libandroidx.graphics.path.so");
    expect(verification).not.toContain("sort -V");
    expect(verification).not.toMatch(/\|\s*grep\s+-Fq/);
  });

  it("validates the AndroidX graphics-path ABI set and payload budget", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "androidx-graphics-path-"));

    try {
      const validArchive = createNativeLibraryArchive(
        join(tempRoot, "valid"),
        expectedLibraries
      );
      const validResult = spawnSync(
        "bash",
        [graphicsPathVerifier, validArchive, "test artifact"],
        { encoding: "utf8" }
      );
      expect(validResult.status, validResult.stderr).toBe(0);

      const missingAbiArchive = createNativeLibraryArchive(
        join(tempRoot, "missing-abi"),
        expectedLibraries.slice(0, -1)
      );
      const missingAbiResult = spawnSync(
        "bash",
        [graphicsPathVerifier, missingAbiArchive, "test artifact"],
        { encoding: "utf8" }
      );
      expect(missingAbiResult.status).not.toBe(0);
      expect(missingAbiResult.stderr).toContain(
        "Expected one AndroidX graphics-path library for each supported ABI"
      );

      const unexpectedAbiArchive = createNativeLibraryArchive(
        join(tempRoot, "unexpected-abi"),
        expectedLibraries.map(([abi, bytes], index) =>
          index === expectedLibraries.length - 1
            ? (["riscv64", bytes] as const)
            : ([abi, bytes] as const)
        )
      );
      const unexpectedAbiResult = spawnSync(
        "bash",
        [graphicsPathVerifier, unexpectedAbiArchive, "test artifact"],
        { encoding: "utf8" }
      );
      expect(unexpectedAbiResult.status).not.toBe(0);
      expect(unexpectedAbiResult.stderr).toContain(
        "Expected one AndroidX graphics-path library for each supported ABI"
      );

      const oversizedArchive = createNativeLibraryArchive(
        join(tempRoot, "oversized"),
        expectedLibraries.map(([abi]) => [abi, 10_001] as const)
      );
      const oversizedResult = spawnSync(
        "bash",
        [graphicsPathVerifier, oversizedArchive, "test artifact"],
        { encoding: "utf8" }
      );
      expect(oversizedResult.status).not.toBe(0);
      expect(oversizedResult.stderr).toContain(
        "exceeds the 40000-byte release budget"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
