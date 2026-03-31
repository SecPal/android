#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal
// SPDX-License-Identifier: MIT

import { readFileSync, writeFileSync } from "node:fs";

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
        .replace(/\n{3,}dependencies \{/g, "\n\ndependencies {");

    return normalizedContent.endsWith("\n")
        ? normalizedContent
        : `${normalizedContent}\n`;
}

export function normalizeCapacitorCordovaGradleFile(buildGradlePath) {
    const currentContent = readFileSync(buildGradlePath, "utf8");
    const normalizedContent = normalizeCapacitorCordovaGradle(currentContent);

    if (normalizedContent !== currentContent) {
        writeFileSync(buildGradlePath, normalizedContent, "utf8");
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const buildGradlePath = process.argv[2];

    if (!buildGradlePath) {
        console.error(
            "Usage: node scripts/normalize-capacitor-cordova-gradle.mjs <build-gradle-path>"
        );
        process.exit(1);
    }

    normalizeCapacitorCordovaGradleFile(buildGradlePath);
}