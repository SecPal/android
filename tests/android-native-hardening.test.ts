/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

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

  it("defines the Cordova access allowlist in Capacitor source config", async () => {
    const { default: config } = await import("../capacitor.config");

    expect(config.cordova?.accessOrigins).toEqual([
      "https://api.secpal.dev",
      "https://app.secpal.dev",
    ]);
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
    expect(proguardRules).toContain("app.secpal.app.SecPalNativeAuthPlugin");
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
    const networkSecurityConfig = readFileSync(
      networkSecurityConfigPath,
      "utf8"
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
    expect(networkSecurityConfig).toContain(
      "3BJmezOWc04OlOrJ501K2t07GXxrHS5qQC7T7OnnO7k="
    );
    expect(networkSecurityConfig).toContain(
      "iFvwVyJSxnQdyaUvUERIf+8qk7gRze3612JMwoO3zdU="
    );
  });

  it("documents the ImageMagick prerequisite for brand asset sync", () => {
    const readme = readRepoFile("README.md");

    expect(readme).toContain("ImageMagick");
    expect(readme).toContain("npm run brand:sync");
    expect(readme).toContain("magick");
  });
});
