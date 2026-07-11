/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

describe("third-party license provenance", () => {
  it("assigns unchanged Capacitor templates to one REUSE annotation", () => {
    const reuseConfig = readFileSync(resolve(repoRoot, "REUSE.toml"), "utf8");
    const unchangedTemplatePaths = [
      "android/gradle.properties",
      "android/settings.gradle",
      "android/app/.gitignore",
    ];

    for (const templatePath of unchangedTemplatePaths) {
      const quotedPath = `"${templatePath}"`;
      expect(reuseConfig.split(quotedPath)).toHaveLength(2);
    }
  });

  it("keeps SecPal's Cordova Gradle normalization under AGPL terms", () => {
    const sidecarPath = resolve(
      repoRoot,
      "android/capacitor-cordova-android-plugins/build.gradle.license"
    );

    expect(existsSync(sidecarPath)).toBe(true);

    const sidecar = readFileSync(sidecarPath, "utf8");
    expect(sidecar).toContain(
      "SPDX-FileCopyrightText: 2026 SecPal Contributors"
    );
    expect(sidecar).toContain(
      "SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution"
    );

    const reuseConfig = readFileSync(resolve(repoRoot, "REUSE.toml"), "utf8");
    expect(reuseConfig).toContain(
      'path = "android/capacitor-cordova-android-plugins/build.gradle"\nprecedence = "aggregate"\nSPDX-FileCopyrightText = "2017-present Drifty Co."\nSPDX-License-Identifier = "MIT"'
    );
  });
});
