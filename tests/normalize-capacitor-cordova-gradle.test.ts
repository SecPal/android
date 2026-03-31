/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

async function loadNormalizerModule(): Promise<{
  normalizeCapacitorCordovaGradle: (buildGradleContent: string) => string;
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
});
