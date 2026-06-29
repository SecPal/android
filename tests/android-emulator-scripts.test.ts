/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

describe("Android emulator scripts", () => {
  it("uses the standard Android AVD home when no repo-local override exists", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-emulator-script-"));
    const fakeBinRoot = join(tempRoot, "bin");
    const standardAvdRoot = join(tempRoot, ".android", "avd");

    try {
      mkdirSync(fakeBinRoot, { recursive: true });
      mkdirSync(standardAvdRoot, { recursive: true });
      writeFileSync(join(standardAvdRoot, "TestAvd.ini"), "");
      writeExecutable(
        join(fakeBinRoot, "adb"),
        "#!/usr/bin/env bash\nexit 0\n"
      );
      writeExecutable(
        join(fakeBinRoot, "emulator"),
        "#!/usr/bin/env bash\nsleep 1\n"
      );

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: tempRoot,
        PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
      };
      delete env.ANDROID_AVD_HOME;
      delete env.ANDROID_EMULATOR_HOME;

      const result = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "start-android-emulator.sh"),
          "TestAvd",
          "5570",
        ],
        {
          cwd: repoRoot,
          env,
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("serial=emulator-5570");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
