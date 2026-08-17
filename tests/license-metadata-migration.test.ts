/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const obsoleteLicenseReference = ["LicenseRef", "SecPal", "Attribution"].join(
  "-"
);
const obsoleteLicenseExpression = [
  "AGPL-3.0-or-later",
  obsoleteLicenseReference,
].join(" AND ");
const plainAgplSpdxHeader =
  ["SPDX", "License-Identifier"].join("-") + ": AGPL-3.0-or-later";
const historicalLicenseReferenceLines = [
  [
    "CHANGELOG.md:",
    "- Added `",
    obsoleteLicenseReference,
    "` for SecPal-owned AGPL-covered code, fastlane assets, and related metadata, linked the repo docs to the new AGPL section 7(b)/(c) terms, and tightened the Android discovery/about legal footer so it exposes the SecPal attribution terms alongside the existing `Powered by SecPal` notice.",
  ].join(""),
  [
    "docs/THIRD_PARTY_LICENSE_AUDIT.md:",
    "`",
    obsoleteLicenseReference,
    "`.",
  ].join(""),
  [
    "docs/THIRD_PARTY_LICENSE_AUDIT.md:",
    "`",
    obsoleteLicenseReference,
    "` is used only with the existing SecPal-owned",
  ].join(""),
].sort();

function gitGrepLines(pattern: string): string[] {
  return execFileSync("git", ["grep", "-n", "-F", "--", pattern], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^([^:]+):\d+:/, "$1:"));
}

describe("licensing metadata migration", () => {
  it("limits obsolete addendum references to explicit historical lines", () => {
    const obsoleteReferenceLines = gitGrepLines(obsoleteLicenseReference);

    expect(obsoleteReferenceLines.sort()).toEqual(
      historicalLicenseReferenceLines
    );
    expect(
      existsSync(
        resolve(
          repoRoot,
          "LICENSES",
          `${["LicenseRef", "SecPal", "Attribution"].join("-")}.txt`
        )
      )
    ).toBe(false);
  });

  it("declares plain AGPL for SecPal package and generated metadata", () => {
    const packageMetadata = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    ) as { license: string };
    expect(packageMetadata.license).toBe("AGPL-3.0-or-later");

    for (const path of [
      "android/app/aapt-ignore-assets.json",
      "android/app/src/main/web-assets-fallback.json",
    ]) {
      expect(readFileSync(resolve(repoRoot, path), "utf8")).toContain(
        plainAgplSpdxHeader
      );
    }
  });

  it("generates web-asset metadata with plain AGPL", () => {
    const assetRoot = mkdtempSync(join(tmpdir(), "secpal-license-metadata-"));

    try {
      writeFileSync(join(assetRoot, "index.html"), "<!doctype html>\n");
      execFileSync(
        process.execPath,
        ["scripts/generate-android-web-asset-inventory.mjs", assetRoot],
        { cwd: repoRoot, encoding: "utf8" }
      );

      const inventory = readFileSync(
        join(assetRoot, "secpal-web-assets.json"),
        "utf8"
      );
      expect(inventory).toContain(plainAgplSpdxHeader);
      expect(inventory).not.toContain(obsoleteLicenseExpression);
    } finally {
      rmSync(assetRoot, { recursive: true, force: true });
    }
  });
});
