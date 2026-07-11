/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

function annotationBlockFor(path: string): string {
  const reuseConfig = readFileSync(resolve(repoRoot, "REUSE.toml"), "utf8");
  const annotationBlock = reuseConfig
    .split("[[annotations]]")
    .find((block) => block.includes(`path = "${path}"`));

  if (!annotationBlock) {
    throw new Error(`Missing REUSE annotation for ${path}`);
  }

  return annotationBlock;
}

describe("third-party license provenance", () => {
  it("keeps GitHub's CC0 template and SecPal changes distinct", () => {
    const sidecarPath = resolve(repoRoot, "android/.gitignore.license");
    expect(existsSync(sidecarPath)).toBe(true);
    expect(readFileSync(sidecarPath, "utf8")).toContain(
      "SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution"
    );

    const annotationBlock = annotationBlockFor("android/.gitignore");
    expect(annotationBlock).toMatch(/precedence\s*=\s*"aggregate"/);
    expect(annotationBlock).toMatch(
      /SPDX-FileCopyrightText\s*=\s*"GitHub contributors"/
    );
    expect(annotationBlock).toMatch(/SPDX-License-Identifier\s*=\s*"CC0-1\.0"/);
  });

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

    const annotationBlock = annotationBlockFor(
      "android/capacitor-cordova-android-plugins/build.gradle"
    );
    expect(annotationBlock).toMatch(/precedence\s*=\s*"aggregate"/);
    expect(annotationBlock).toMatch(
      /SPDX-FileCopyrightText\s*=\s*"2017-present Drifty Co\."/
    );
    expect(annotationBlock).toMatch(/SPDX-License-Identifier\s*=\s*"MIT"/);
  });

  it("pins the audit tool and uses version-agnostic Gradle licensing evidence", () => {
    const audit = readFileSync(
      resolve(repoRoot, "docs/THIRD_PARTY_LICENSE_AUDIT.md"),
      "utf8"
    );

    expect(audit).toContain("license-checker-rseidelsohn@5.0.1");
    expect(audit).toContain(
      "https://docs.gradle.org/current/userguide/licenses.html"
    );
  });
});
