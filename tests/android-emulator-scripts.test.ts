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
  }, 10_000);

  it("retries only recognized API 37 infrastructure failures once", () => {
    const runScenario = (
      apiLevel: number,
      failureMode:
        | "package-manager"
        | "package-manager-always"
        | "instrumentation-crash"
        | "instrumentation-crash-always"
        | "command-error"
        | "command-error-always"
        | "command-error-with-tests"
        | "test"
    ) => {
      const tempRoot = mkdtempSync(
        join(tmpdir(), "secpal-connected-test-script-")
      );
      const androidRoot = join(tempRoot, "android");
      const scriptsRoot = join(tempRoot, "scripts");
      const attemptPath = join(tempRoot, "attempts");
      const waitPath = join(tempRoot, "waits");

      try {
        mkdirSync(androidRoot, { recursive: true });
        mkdirSync(scriptsRoot, { recursive: true });
        writeExecutable(
          join(androidRoot, "gradlew"),
          `#!/usr/bin/env bash
attempt=0
if [[ -f "${attemptPath}" ]]; then
  attempt="$(cat "${attemptPath}")"
fi
attempt=$((attempt + 1))
printf '%s' "$attempt" > "${attemptPath}"
if [[ "$attempt" == "1" || "${failureMode}" == *-always ]]; then
  if [[ "${failureMode}" == package-manager* ]]; then
    printf '%s\n' 'Failed to commit install session 1234'
    printf '%s\n' 'Failure calling service package: Broken pipe (32)'
  elif [[ "${failureMode}" == instrumentation-crash* ]]; then
    printf '%s\n' 'Starting 0 tests on emulator-5570 - 17'
    printf '%s\n' 'Test run failed to complete. No test results.'
    printf '%s\n' 'INSTRUMENTATION_ABORTED: System has crashed.'
  elif [[ "${failureMode}" == command-error* ]]; then
    if [[ "${failureMode}" == "command-error-with-tests" ]]; then
      printf '%s\n' 'Starting 1 tests on emulator-5570 - 17'
    else
      printf '%s\n' 'Starting 0 tests on emulator-5570 - 17'
    fi
    printf '%s\n' 'Test run failed to complete. No test results. onError: commandError=true message=null'
  else
    printf '%s\n' 'There were failing tests'
  fi
  exit 1
fi
printf '%s\n' 'connected test passed'
`
        );
        writeExecutable(
          join(scriptsRoot, "wait-for-android-device.sh"),
          `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${waitPath}"
`
        );

        const result = spawnSync(
          "bash",
          [
            resolve(repoRoot, "scripts", "run-android-connected-test.sh"),
            "emulator-5570",
            apiLevel.toString(),
            "60",
            ":app:connectedCtRegressionAndroidTest",
          ],
          {
            cwd: tempRoot,
            env: {
              ...process.env,
              TMPDIR: tempRoot,
            },
            encoding: "utf8",
          }
        );

        return {
          result,
          attempts: Number.parseInt(readFileSync(attemptPath, "utf8"), 10),
          waits: existsSync(waitPath)
            ? readFileSync(waitPath, "utf8").trim().split("\n")
            : [],
        };
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    };

    const recoverableApi37Failure = runScenario(37, "package-manager");
    expect(recoverableApi37Failure.result.status).toBe(0);
    expect(recoverableApi37Failure.attempts).toBe(2);
    expect(recoverableApi37Failure.waits).toEqual(["emulator-5570 60"]);
    expect(recoverableApi37Failure.result.stdout).toContain(
      "Retrying API 37 instrumentation after PackageManager connection failure"
    );

    const repeatedApi37Failure = runScenario(37, "package-manager-always");
    expect(repeatedApi37Failure.result.status).toBe(1);
    expect(repeatedApi37Failure.attempts).toBe(2);
    expect(repeatedApi37Failure.waits).toEqual(["emulator-5570 60"]);

    const recoverableInstrumentationCrash = runScenario(
      37,
      "instrumentation-crash"
    );
    expect(recoverableInstrumentationCrash.result.status).toBe(0);
    expect(recoverableInstrumentationCrash.attempts).toBe(2);
    expect(recoverableInstrumentationCrash.waits).toEqual(["emulator-5570 60"]);
    expect(recoverableInstrumentationCrash.result.stdout).toContain(
      "Retrying API 37 instrumentation after pre-test system crash"
    );

    const repeatedInstrumentationCrash = runScenario(
      37,
      "instrumentation-crash-always"
    );
    expect(repeatedInstrumentationCrash.result.status).toBe(1);
    expect(repeatedInstrumentationCrash.attempts).toBe(2);
    expect(repeatedInstrumentationCrash.waits).toEqual(["emulator-5570 60"]);

    const recoverableCommandError = runScenario(37, "command-error");
    expect(recoverableCommandError.result.status).toBe(0);
    expect(recoverableCommandError.attempts).toBe(2);
    expect(recoverableCommandError.waits).toEqual(["emulator-5570 60"]);
    expect(recoverableCommandError.result.stdout).toContain(
      "Retrying API 37 instrumentation after zero-test command error"
    );

    const repeatedCommandError = runScenario(37, "command-error-always");
    expect(repeatedCommandError.result.status).toBe(1);
    expect(repeatedCommandError.attempts).toBe(2);
    expect(repeatedCommandError.waits).toEqual(["emulator-5570 60"]);

    const api36Failure = runScenario(36, "package-manager");
    expect(api36Failure.result.status).toBe(1);
    expect(api36Failure.attempts).toBe(1);
    expect(api36Failure.waits).toEqual([]);

    const api36InstrumentationCrash = runScenario(36, "instrumentation-crash");
    expect(api36InstrumentationCrash.result.status).toBe(1);
    expect(api36InstrumentationCrash.attempts).toBe(1);
    expect(api36InstrumentationCrash.waits).toEqual([]);

    const api36CommandError = runScenario(36, "command-error");
    expect(api36CommandError.result.status).toBe(1);
    expect(api36CommandError.attempts).toBe(1);
    expect(api36CommandError.waits).toEqual([]);

    const commandErrorAfterTestStart = runScenario(
      37,
      "command-error-with-tests"
    );
    expect(commandErrorAfterTestStart.result.status).toBe(1);
    expect(commandErrorAfterTestStart.attempts).toBe(1);
    expect(commandErrorAfterTestStart.waits).toEqual([]);

    const testFailure = runScenario(37, "test");
    expect(testFailure.result.status).toBe(1);
    expect(testFailure.attempts).toBe(1);
    expect(testFailure.waits).toEqual([]);
  });
});
