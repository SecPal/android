#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ANDROID_GRADLE_PLUGIN_CLASSPATH =
  "classpath 'com.android.tools.build:gradle:8.9.1'";
const SPDX_LICENSE_IDENTIFIER_LABEL = ["SPDX", "License-Identifier"].join("-");
const BUILD_GRADLE_LICENSE_IDENTIFIER = [
  `${SPDX_LICENSE_IDENTIFIER_LABEL}:`,
  "AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution",
].join(" ");
const BUILD_GRADLE_LICENSE = [
  "SPDX-FileCopyrightText: 2026 SecPal Contributors",
  BUILD_GRADLE_LICENSE_IDENTIFIER,
  "",
].join("\n");

const GENERATED_REPOSITORIES_BLOCK = [
  "repositories {",
  "    google()",
  "    mavenCentral()",
  "    flatDir{",
  "        dirs 'src/main/libs', 'libs'",
  "    }",
  "}",
  "",
].join("\n");

export function normalizeCapacitorCordovaGradle(buildGradleContent) {
  const normalizedContent = buildGradleContent
    .replace(GENERATED_REPOSITORIES_BLOCK, "")
    .replace(
      /classpath 'com\.android\.tools\.build:gradle:[^']+'/g,
      ANDROID_GRADLE_PLUGIN_CLASSPATH
    )
    .replace(/\n{3,}dependencies \{/g, "\n\ndependencies {");

  return normalizedContent.endsWith("\n")
    ? normalizedContent
    : `${normalizedContent}\n`;
}

function writeFileWhenChanged(path, content) {
  if (!existsSync(path) || readFileSync(path, "utf8") !== content) {
    writeFileSync(path, content, "utf8");
  }
}

function normalizeFinalNewline(path) {
  const content = readFileSync(path, "utf8");
  writeFileWhenChanged(path, content.endsWith("\n") ? content : `${content}\n`);
}

export function normalizeCapacitorCordovaGradleFile(buildGradlePath) {
  const currentContent = readFileSync(buildGradlePath, "utf8");
  const normalizedContent = normalizeCapacitorCordovaGradle(currentContent);

  if (normalizedContent !== currentContent) {
    writeFileSync(buildGradlePath, normalizedContent, "utf8");
  }
}

export function normalizeCapacitorCordovaArtifacts(buildGradlePath) {
  const pluginRoot = dirname(buildGradlePath);

  normalizeCapacitorCordovaGradleFile(buildGradlePath);
  normalizeFinalNewline(join(pluginRoot, "cordova.variables.gradle"));
  normalizeFinalNewline(join(pluginRoot, "src", "main", "AndroidManifest.xml"));
  writeFileWhenChanged(join(pluginRoot, "src", "main", "res", ".gitkeep"), "");
  writeFileWhenChanged(
    join(pluginRoot, "build.gradle.license"),
    BUILD_GRADLE_LICENSE
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const buildGradlePath = process.argv[2];

  if (!buildGradlePath) {
    console.error(
      "Usage: node scripts/normalize-capacitor-cordova-gradle.mjs <build-gradle-path>"
    );
    process.exit(1);
  }

  normalizeCapacitorCordovaArtifacts(buildGradlePath);
}
