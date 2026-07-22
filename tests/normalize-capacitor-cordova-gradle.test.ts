/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadNormalizerModule(): Promise<{
  normalizeCapacitorCordovaGradle: (buildGradleContent: string) => string;
  normalizeCapacitorCordovaArtifacts: (buildGradlePath: string) => void;
}> {
  // @ts-expect-error The normalizer intentionally remains a Node-executable .mjs helper and is exercised directly here.
  return import("../scripts/normalize-capacitor-cordova-gradle.mjs");
}

describe("Capacitor Cordova Gradle normalization", () => {
  it("removes the generated flatDir repositories block", async () => {
    const { normalizeCapacitorCordovaGradle } = await loadNormalizerModule();
    const generatedGradle = [
      "ext {",
      "    androidxAppCompatVersion = project.hasProperty('androidxAppCompatVersion') ? rootProject.ext.androidxAppCompatVersion : '1.7.1'",
      "}",
      "",
      "repositories {",
      "    google()",
      "    mavenCentral()",
      "    flatDir{",
      "        dirs 'src/main/libs', 'libs'",
      "    }",
      "}",
      "",
      "dependencies {",
      "    implementation fileTree(dir: 'src/main/libs', include: ['*.jar'])",
      "}",
      "",
    ].join("\n");

    const normalizedGradle = normalizeCapacitorCordovaGradle(generatedGradle);

    expect(normalizedGradle).not.toContain("flatDir{");
    expect(normalizedGradle).not.toContain("repositories {");
    expect(normalizedGradle).not.toContain("\n\n\ndependencies {");
    expect(normalizedGradle).toContain("dependencies {");
    expect(normalizedGradle.endsWith("\n")).toBe(true);
  });

  it("is idempotent when the generated repositories block is already absent", async () => {
    const { normalizeCapacitorCordovaGradle } = await loadNormalizerModule();
    const normalizedGradle = [
      "ext {",
      "    androidxAppCompatVersion = project.hasProperty('androidxAppCompatVersion') ? rootProject.ext.androidxAppCompatVersion : '1.7.1'",
      "}",
      "",
      "dependencies {",
      "    implementation fileTree(dir: 'src/main/libs', include: ['*.jar'])",
      "}",
      "",
    ].join("\n");

    expect(normalizeCapacitorCordovaGradle(normalizedGradle)).toBe(
      normalizedGradle
    );
  });

  it("restores every tracked Cordova artifact replaced by Capacitor sync", async () => {
    const { normalizeCapacitorCordovaArtifacts } = await loadNormalizerModule();
    const temporaryRoot = mkdtempSync(join(tmpdir(), "secpal-cordova-"));
    const pluginRoot = join(temporaryRoot, "capacitor-cordova-android-plugins");
    const resourcesRoot = join(pluginRoot, "src", "main", "res");

    try {
      mkdirSync(resourcesRoot, { recursive: true });
      writeFileSync(
        join(pluginRoot, "build.gradle"),
        "classpath 'com.android.tools.build:gradle:8.13.0'"
      );
      writeFileSync(join(pluginRoot, "cordova.variables.gradle"), "ext {} ");
      writeFileSync(
        join(pluginRoot, "src", "main", "AndroidManifest.xml"),
        "<manifest></manifest>"
      );
      writeFileSync(join(resourcesRoot, ".gitkeep"), "\n");

      normalizeCapacitorCordovaArtifacts(join(pluginRoot, "build.gradle"));

      expect(readFileSync(join(pluginRoot, "build.gradle"), "utf8")).toContain(
        "com.android.tools.build:gradle:8.9.1"
      );
      expect(
        readFileSync(join(pluginRoot, "cordova.variables.gradle"), "utf8")
      ).toBe("ext {} \n");
      expect(
        readFileSync(
          join(pluginRoot, "src", "main", "AndroidManifest.xml"),
          "utf8"
        )
      ).toBe("<manifest></manifest>\n");
      expect(readFileSync(join(resourcesRoot, ".gitkeep"), "utf8")).toBe("");
      expect(
        readFileSync(join(pluginRoot, "build.gradle.license"), "utf8")
      ).toBe(
        "SPDX-FileCopyrightText: 2026 SecPal Contributors\n" +
          [
            `${["SPDX", "License-Identifier"].join("-")}:`,
            "AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution\n",
          ].join(" ")
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("preserves other repositories blocks that do not match the generated flatDir block", async () => {
    const { normalizeCapacitorCordovaGradle } = await loadNormalizerModule();
    const gradleWithBothBlocks = [
      "ext {",
      "    androidxAppCompatVersion = '1.7.1'",
      "}",
      "",
      "repositories {",
      "    google()",
      "    mavenCentral()",
      "    flatDir{",
      "        dirs 'src/main/libs', 'libs'",
      "    }",
      "}",
      "",
      "buildscript {",
      "    repositories {",
      "        mavenCentral()",
      "    }",
      "}",
      "",
      "dependencies {",
      "    implementation fileTree(dir: 'src/main/libs', include: ['*.jar'])",
      "}",
      "",
    ].join("\n");

    const result = normalizeCapacitorCordovaGradle(gradleWithBothBlocks);

    expect(result).not.toContain("flatDir{");
    expect(result).toContain("buildscript {");
    expect(result).toContain("    repositories {");
    expect(result).toContain("        mavenCentral()");
    expect(result).toContain("dependencies {");
    expect(result.endsWith("\n")).toBe(true);
  });
});
