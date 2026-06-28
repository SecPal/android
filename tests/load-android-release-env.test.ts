/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const releaseEnvLoaderPath = resolve(
  repoRoot,
  "scripts",
  "load-android-release-env.sh"
);

describe("Android release env loader", () => {
  it("keeps a shell-provided direct channel override ahead of the local env file", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "secpal-android-release-env-loader-")
    );
    const releaseEnvPath = join(tempRoot, "android-release.env");

    try {
      writeFileSync(releaseEnvPath, 'SECPAL_ANDROID_DIRECT_CHANNEL="stable"\n');
      chmodSync(releaseEnvPath, 0o600);

      const result = spawnSync(
        "bash",
        [
          releaseEnvLoaderPath,
          "bash",
          "-lc",
          'printf "%s" "${SECPAL_ANDROID_DIRECT_CHANNEL:-}"',
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            SECPAL_ANDROID_RELEASE_ENV_FILE: releaseEnvPath,
            SECPAL_ANDROID_DIRECT_CHANNEL: "beta",
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("beta");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
