/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The verifier intentionally remains Node-executable JavaScript.
import { assertCleanAndroidWebAssets } from "../scripts/verify-android-web-assets-clean.mjs";

function git(repositoryRoot: string, ...arguments_: string[]) {
  execFileSync("git", arguments_, {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
}

describe("checked-in Android web assets", () => {
  it("rejects tracked changes and untracked generated chunks", () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "android-web-assets-clean-")
    );
    const publicRoot = join(
      repositoryRoot,
      "android",
      "app",
      "src",
      "main",
      "assets",
      "public"
    );
    const fallbackInventory = join(
      repositoryRoot,
      "android",
      "app",
      "src",
      "main",
      "web-assets-fallback.json"
    );

    try {
      mkdirSync(join(publicRoot, "assets"), { recursive: true });
      writeFileSync(join(publicRoot, "index.html"), "reviewed\n");
      writeFileSync(fallbackInventory, "{}\n");
      git(repositoryRoot, "init", "--initial-branch=main");
      git(repositoryRoot, "config", "user.email", "test@secpal.dev");
      git(repositoryRoot, "config", "user.name", "SecPal Test");
      git(repositoryRoot, "add", ".");
      git(
        repositoryRoot,
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "fixture"
      );

      expect(() => assertCleanAndroidWebAssets(repositoryRoot)).not.toThrow();

      writeFileSync(join(publicRoot, "index.html"), "changed\n");
      expect(() => assertCleanAndroidWebAssets(repositoryRoot)).toThrow(
        /index\.html/
      );

      writeFileSync(join(publicRoot, "index.html"), "reviewed\n");
      writeFileSync(join(publicRoot, "assets", "new-chunk.js"), "chunk\n");
      expect(() => assertCleanAndroidWebAssets(repositoryRoot)).toThrow(
        /new-chunk\.js/
      );
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});
