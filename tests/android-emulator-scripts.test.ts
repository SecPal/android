/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
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
      delete env.ANDROID_SDK_ROOT;
      delete env.ANDROID_HOME;

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

  it("rejects unsafe emulator launch inputs before shelling out", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-emulator-script-"));
    const fakeBinRoot = join(tempRoot, "bin");
    const standardAvdRoot = join(tempRoot, ".android", "avd");
    const injectionPath = join(tempRoot, "gpu-injection-ran");

    try {
      mkdirSync(fakeBinRoot, { recursive: true });
      mkdirSync(standardAvdRoot, { recursive: true });
      writeFileSync(join(standardAvdRoot, "TestAvd.ini"), "");
      writeFileSync(join(standardAvdRoot, "Unsafe Name.ini"), "");
      writeExecutable(
        join(fakeBinRoot, "adb"),
        "#!/usr/bin/env bash\nexit 0\n"
      );
      writeExecutable(
        join(fakeBinRoot, "emulator"),
        "#!/usr/bin/env bash\nexit 0\n"
      );

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: tempRoot,
        PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
        SECPAL_ANDROID_EMULATOR_GPU_MODE: `host; touch "${injectionPath}"`,
      };
      delete env.ANDROID_SDK_ROOT;
      delete env.ANDROID_HOME;

      const gpuModeResult = spawnSync(
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

      expect(gpuModeResult.status).toBe(64);
      expect(gpuModeResult.stderr).toContain("Unsupported GPU mode");
      expect(existsSync(injectionPath)).toBe(false);

      const avdNameResult = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "start-android-emulator.sh"),
          "Unsafe Name",
          "5570",
        ],
        {
          cwd: repoRoot,
          env: {
            ...env,
            SECPAL_ANDROID_EMULATOR_GPU_MODE: "host",
          },
          encoding: "utf8",
        }
      );

      expect(avdNameResult.status).toBe(64);
      expect(avdNameResult.stderr).toContain(
        "AVD name contains unsafe characters"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes Android device serials to adb without shell interpolation", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-emulator-script-"));
    const fakeBinRoot = join(tempRoot, "bin");
    const adbLogPath = join(tempRoot, "adb.log");
    const injectionPath = join(tempRoot, "serial-injection-ran");
    const serial = `emulator-5570; touch "${injectionPath}"`;

    try {
      mkdirSync(fakeBinRoot, { recursive: true });
      writeExecutable(
        join(fakeBinRoot, "adb"),
        `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${adbLogPath}"
if [[ "$1" == "start-server" ]]; then
  exit 0
fi
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "get-state" ]]; then
  printf 'device\n'
  exit 0
fi
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "shell" && "$4" == "wm" && "$5" == "size" ]]; then
  printf 'Physical size: 1920x1080\r\n'
  exit 0
fi
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "shell" && "$4" == "wm" && "$5" == "density" ]]; then
  printf 'Physical density: 420\r\n'
  exit 0
fi
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "shell" && "$4" == "getprop" && "$5" == "sys.boot_completed" ]]; then
  printf '1\r\n'
  exit 0
fi
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "shell" && "$4" == "getprop" && "$5" == "init.svc.bootanim" ]]; then
  printf 'stopped\r\n'
  exit 0
fi
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "shell" && "$4" == "cmd" && "$5" == "package" && "$6" == "resolve-activity" ]]; then
  printf 'app.secpal/.MainActivity\r\n'
  exit 0
fi
exit 1
`
      );

      const result = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "wait-for-android-device.sh"),
          serial,
          "5",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: tempRoot,
            PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
            ANDROID_SDK_ROOT: "",
            ANDROID_HOME: "",
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`serial=${serial}`);
      expect(existsSync(injectionPath)).toBe(false);

      const adbInvocations = readFileSync(adbLogPath, "utf8");
      expect(adbInvocations).toContain(`-s ${serial} get-state`);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
