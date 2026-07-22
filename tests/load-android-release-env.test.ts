/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

  it("migrates a legacy baseline in memory and removes the legacy version name", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "secpal-android-release-env-loader-")
    );
    const releaseEnvPath = join(tempRoot, "android-release.env");
    const originalContent = [
      'SECPAL_ANDROID_VERSION_CODE="261932119"',
      'SECPAL_ANDROID_VERSION_NAME="0.0.1"',
      "",
    ].join("\n");

    try {
      writeFileSync(releaseEnvPath, originalContent);
      chmodSync(releaseEnvPath, 0o600);

      const result = spawnSync(
        "bash",
        [
          releaseEnvLoaderPath,
          "bash",
          "-lc",
          'printf "%s|%s|%s" "${SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE:-}" "${SECPAL_ANDROID_VERSION_CODE-unset}" "${SECPAL_ANDROID_VERSION_NAME-unset}"',
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            SECPAL_ANDROID_RELEASE_ENV_FILE: releaseEnvPath,
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("261932119|unset|unset");
      expect(result.stderr).toContain(
        "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE"
      );
      expect(result.stderr).toContain("SECPAL_ANDROID_VERSION_NAME");
      expect(readFileSync(releaseEnvPath, "utf8")).toBe(originalContent);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps the persisted baseline separate from a caller-provided build code", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "secpal-android-release-env-loader-")
    );
    const releaseEnvPath = join(tempRoot, "android-release.env");

    try {
      writeFileSync(
        releaseEnvPath,
        'SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE="2026072204"\n'
      );
      chmodSync(releaseEnvPath, 0o600);

      const result = spawnSync(
        "bash",
        [
          releaseEnvLoaderPath,
          "bash",
          "-lc",
          'printf "%s|%s" "$SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE" "$SECPAL_ANDROID_VERSION_CODE"',
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            SECPAL_ANDROID_RELEASE_ENV_FILE: releaseEnvPath,
            SECPAL_ANDROID_VERSION_CODE: "2026072208",
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("2026072204|2026072208");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
