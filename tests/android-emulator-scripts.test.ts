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
    const emulatorLogPath = join(tempRoot, "emulator.log");

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
        `#!/usr/bin/env bash
printf '%s\n' "$*" > "${emulatorLogPath}"
`
      );

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: tempRoot,
        PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
        SECPAL_ANDROID_EMULATOR_MEMORY_MB: "4096",
        SECPAL_ANDROID_EMULATOR_PARTITION_SIZE_MB: "8192",
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
      const emulatorLogWait = spawnSync(
        "bash",
        [
          "-c",
          'for _ in {1..50}; do [[ -f "$1" ]] && exit 0; sleep 0.01; done; exit 1',
          "wait-for-emulator-log",
          emulatorLogPath,
        ],
        { encoding: "utf8" }
      );
      expect(emulatorLogWait.status).toBe(0);
      expect(readFileSync(emulatorLogPath, "utf8")).toContain("-memory 4096");
      expect(readFileSync(emulatorLogPath, "utf8")).toContain(
        "-partition-size 8192"
      );
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

      const memoryResult = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "start-android-emulator.sh"),
          "TestAvd",
          "5570",
        ],
        {
          cwd: repoRoot,
          env: {
            ...env,
            SECPAL_ANDROID_EMULATOR_GPU_MODE: "host",
            SECPAL_ANDROID_EMULATOR_MEMORY_MB: `4096; touch "${injectionPath}"`,
          },
          encoding: "utf8",
        }
      );

      expect(memoryResult.status).toBe(64);
      expect(memoryResult.stderr).toContain("Unsupported emulator memory");
      expect(existsSync(injectionPath)).toBe(false);

      const partitionSizeResult = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "start-android-emulator.sh"),
          "TestAvd",
          "5570",
        ],
        {
          cwd: repoRoot,
          env: {
            ...env,
            SECPAL_ANDROID_EMULATOR_GPU_MODE: "host",
            SECPAL_ANDROID_EMULATOR_PARTITION_SIZE_MB: `8192; touch "${injectionPath}"`,
          },
          encoding: "utf8",
        }
      );

      expect(partitionSizeResult.status).toBe(64);
      expect(partitionSizeResult.stderr).toContain(
        "Unsupported emulator partition size"
      );
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
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "shell" && "$4" == "settings" && "$5" == "get" && "$6" == "global" && "$7" == "device_provisioned" ]]; then
  [[ "\${SECPAL_TEST_SETTINGS_READY:-true}" == "true" ]]
  exit
fi
if [[ "$1" == "-s" && "$2" == '${serial}' && "$3" == "shell" && "$4" == "pm" && "$5" == "path" && "$6" == "android" ]]; then
  if [[ "\${SECPAL_TEST_PACKAGE_READY:-true}" == "true" ]]; then
    printf 'package:/system/framework/framework-res.apk\r\n'
    exit 0
  fi
  exit 1
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
      expect(adbInvocations).toContain(
        `-s ${serial} shell settings get global device_provisioned`
      );
      expect(adbInvocations).toContain(`-s ${serial} shell pm path android`);

      const systemProvidersUnavailableResult = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "wait-for-android-device.sh"),
          serial,
          "1",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: tempRoot,
            PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
            ANDROID_SDK_ROOT: "",
            ANDROID_HOME: "",
            SECPAL_TEST_SETTINGS_READY: "false",
          },
          encoding: "utf8",
        }
      );

      expect(systemProvidersUnavailableResult.status).toBe(1);
      expect(systemProvidersUnavailableResult.stderr).toContain(
        "settings=missing"
      );

      const packageManagerUnavailableResult = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "wait-for-android-device.sh"),
          serial,
          "1",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: tempRoot,
            PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
            ANDROID_SDK_ROOT: "",
            ANDROID_HOME: "",
            SECPAL_TEST_PACKAGE_READY: "false",
          },
          encoding: "utf8",
        }
      );

      expect(packageManagerUnavailableResult.status).toBe(1);
      expect(packageManagerUnavailableResult.stderr).toContain(
        "package=missing"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
