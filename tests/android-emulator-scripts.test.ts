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

  it("performs a readiness probe even when the deadline expires before the first check", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-device-wait-"));
    const fakeBinRoot = join(tempRoot, "bin");
    const adbLogPath = join(tempRoot, "adb.log");
    const monotonicClockPath = join(tempRoot, "monotonic-clock");
    const sleepLogPath = join(tempRoot, "sleep.log");
    const bashEnvPath = join(tempRoot, "bash-env");

    try {
      mkdirSync(fakeBinRoot, { recursive: true });
      writeFileSync(monotonicClockPath, "1000000\n");
      writeExecutable(
        join(fakeBinRoot, "adb"),
        `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${adbLogPath}"
exit 1
`
      );
      writeExecutable(
        join(fakeBinRoot, "node"),
        `#!/usr/bin/env bash
if [[ "$*" != *"process.hrtime.bigint()"* ]]; then
  exit 1
fi
cat "${monotonicClockPath}"
`
      );
      writeFileSync(
        bashEnvPath,
        `unset EPOCHREALTIME
trap 'if [[ "$BASH_COMMAND" == "run_adb start-server"* ]]; then printf "1001000\\n" > "${monotonicClockPath}"; fi' DEBUG
sleep() {
  printf '%s\n' "$1" >> "${sleepLogPath}"
  printf "1001000\\n" > "${monotonicClockPath}"
}
`
      );

      const result = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "wait-for-android-device.sh"),
          "emulator-5570",
          "1",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            BASH_ENV: bashEnvPath,
            HOME: tempRoot,
            PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
            ANDROID_SDK_ROOT: "",
            ANDROID_HOME: "",
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(1);
      expect(
        existsSync(adbLogPath) ? readFileSync(adbLogPath, "utf8") : ""
      ).toContain("-s emulator-5570 get-state");
      expect(
        readFileSync(adbLogPath, "utf8").match(/^-s emulator-5570 get-state$/gm)
      ).toHaveLength(1);
      expect(existsSync(sleepLogPath)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses monotonic time to limit retry sleep and stop probes at the readiness deadline", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-device-wait-"));
    const fakeBinRoot = join(tempRoot, "bin");
    const adbLogPath = join(tempRoot, "adb.log");
    const monotonicClockPath = join(tempRoot, "monotonic-clock");
    const sleepLogPath = join(tempRoot, "sleep.log");
    const wallClockPath = join(tempRoot, "wall-clock");
    const bashEnvPath = join(tempRoot, "bash-env");

    try {
      mkdirSync(fakeBinRoot, { recursive: true });
      writeFileSync(monotonicClockPath, "1000000\n");
      writeFileSync(wallClockPath, "1000000\n");
      writeExecutable(
        join(fakeBinRoot, "adb"),
        `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${adbLogPath}"
exit 1
`
      );
      writeExecutable(
        join(fakeBinRoot, "node"),
        `#!/usr/bin/env bash
if [[ "$*" == *"process.hrtime.bigint()"* ]]; then
  cat "${monotonicClockPath}"
  exit 0
fi
if [[ "$*" == *"Date.now()"* ]]; then
  cat "${wallClockPath}"
  exit 0
fi
exit 1
`
      );
      writeFileSync(
        bashEnvPath,
        `unset EPOCHREALTIME
first_probe_clock_update=true
trap 'if [[ "$BASH_COMMAND" == "run_adb start-server"* && "$first_probe_clock_update" == true ]]; then first_probe_clock_update=false; printf "1000400\\n" > "${monotonicClockPath}"; printf "1000400\\n" > "${wallClockPath}"; fi' DEBUG
sleep_calls=0
sleep() {
  printf '%s\n' "$1" >> "${sleepLogPath}"
  sleep_calls=$((sleep_calls + 1))
  printf "1001000\\n" > "${monotonicClockPath}"
  if (( sleep_calls == 1 )); then
    printf "998000\\n" > "${wallClockPath}"
  else
    printf "1001000\\n" > "${wallClockPath}"
  fi
}
`
      );

      const result = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "wait-for-android-device.sh"),
          "emulator-5570",
          "1",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            BASH_ENV: bashEnvPath,
            HOME: tempRoot,
            PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
            ANDROID_SDK_ROOT: "",
            ANDROID_HOME: "",
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(1);
      expect(
        existsSync(sleepLogPath) ? readFileSync(sleepLogPath, "utf8") : ""
      ).toBe("0.600\n");
      expect(
        readFileSync(adbLogPath, "utf8").match(/^-s emulator-5570 get-state$/gm)
      ).toHaveLength(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses subsecond monotonic uptime when the Node clock is unavailable", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-device-wait-"));
    const fakeBinRoot = join(tempRoot, "bin");
    const adbLogPath = join(tempRoot, "adb.log");
    const sleepLogPath = join(tempRoot, "sleep.log");
    const bashEnvPath = join(tempRoot, "bash-env");
    const monotonicUptimePath = join(tempRoot, "uptime");

    try {
      mkdirSync(fakeBinRoot, { recursive: true });
      writeFileSync(monotonicUptimePath, "1000.000 0.000\n");
      writeExecutable(
        join(fakeBinRoot, "adb"),
        `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${adbLogPath}"
exit 1
`
      );
      writeExecutable(
        join(fakeBinRoot, "node"),
        "#!/usr/bin/env bash\nexit 1\n"
      );
      writeFileSync(
        bashEnvPath,
        `unset EPOCHREALTIME
monotonic_uptime_path="${monotonicUptimePath}"
trap 'if [[ "$BASH_COMMAND" == "run_adb start-server"* ]]; then printf "1000.450 0.000\\n" > "${monotonicUptimePath}"; fi' DEBUG
sleep() {
  printf '%s\n' "$1" >> "${sleepLogPath}"
  printf "1001.000 0.000\\n" > "${monotonicUptimePath}"
}
`
      );

      const result = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "wait-for-android-device.sh"),
          "emulator-5570",
          "1",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            BASH_ENV: bashEnvPath,
            HOME: tempRoot,
            PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
            ANDROID_SDK_ROOT: "",
            ANDROID_HOME: "",
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(1);
      expect(readFileSync(sleepLogPath, "utf8")).toBe("0.550\n");
      expect(
        readFileSync(adbLogPath, "utf8").match(/^-s emulator-5570 get-state$/gm)
      ).toHaveLength(1);
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

  it("retries only recognized connected-test infrastructure failures", () => {
    const runScenario = (
      apiLevel: number,
      failureMode:
        | "maven-403"
        | "maven-403-always"
        | "maven-403-resource"
        | "maven-403-same-line"
        | "maven-403-then-package-manager"
        | "maven-404"
        | "mixed-repository-responses"
        | "other-repository-403"
        | "other-repository-403-resource"
        | "package-manager"
        | "package-manager-always"
        | "package-manager-then-missing-package-service"
        | "split-install-broken-pipe"
        | "missing-package-service"
        | "install-write"
        | "install-write-always"
        | "install-write-with-tests"
        | "instrumentation-crash"
        | "instrumentation-crash-always"
        | "instrumentation-crash-then-install-write"
        | "instrumentation-crash-then-missing-package-service"
        | "instrumentation-crash-then-missing-package-service-then-test"
        | "command-error"
        | "command-error-always"
        | "command-error-then-missing-package-service"
        | "command-error-with-diagnostic"
        | "command-error-with-tests"
        | "test"
    ) => {
      const tempRoot = mkdtempSync(
        join(tmpdir(), "secpal-connected-test-script-")
      );
      const androidRoot = join(tempRoot, "android");
      const scriptsRoot = join(tempRoot, "scripts");
      const attemptPath = join(tempRoot, "attempts");
      const rebootPath = join(tempRoot, "reboots");
      const waitPath = join(tempRoot, "waits");
      const recoveryEventPath = join(tempRoot, "recovery-events");

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
printf 'attempt:%s\n' "$attempt" >> "${recoveryEventPath}"
attempt_failure_mode=""
if [[ "${failureMode}" == "maven-403-then-package-manager" ]]; then
  if [[ "$attempt" == "1" ]]; then
    attempt_failure_mode="maven-403"
  elif [[ "$attempt" == "2" ]]; then
    attempt_failure_mode="package-manager"
  fi
elif [[ "${failureMode}" == "package-manager-then-missing-package-service" ]]; then
  if [[ "$attempt" == "1" ]]; then
    attempt_failure_mode="package-manager"
  elif [[ "$attempt" == "2" ]]; then
    attempt_failure_mode="missing-package-service"
  fi
elif [[ "${failureMode}" == "instrumentation-crash-then-install-write" ]]; then
  if [[ "$attempt" == "1" ]]; then
    attempt_failure_mode="instrumentation-crash"
  elif [[ "$attempt" == "2" ]]; then
    attempt_failure_mode="install-write"
  fi
elif [[ "${failureMode}" == instrumentation-crash-then-missing-package-service* ]]; then
  if [[ "$attempt" == "1" ]]; then
    attempt_failure_mode="instrumentation-crash"
  elif [[ "$attempt" == "2" ]]; then
    attempt_failure_mode="missing-package-service"
  elif [[ "${failureMode}" == *-then-test && "$attempt" == "3" ]]; then
    attempt_failure_mode="test"
  fi
elif [[ "${failureMode}" == "command-error-then-missing-package-service" ]]; then
  if [[ "$attempt" == "1" ]]; then
    attempt_failure_mode="command-error"
  elif [[ "$attempt" == "2" ]]; then
    attempt_failure_mode="missing-package-service"
  fi
elif [[ "$attempt" == "1" || "${failureMode}" == *-always ]]; then
  attempt_failure_mode="${failureMode}"
fi
if [[ -n "$attempt_failure_mode" ]]; then
  if [[ "$attempt_failure_mode" == "maven-403-same-line" ]]; then
    printf '%s\n' "Could not GET 'https://repo.maven.apache.org/maven2/org/example/dependency/1.0/dependency-1.0.pom'. Received status code 403 from server: Forbidden"
  elif [[ "$attempt_failure_mode" == *-403-resource ]]; then
    if [[ "$attempt_failure_mode" == other-repository-* ]]; then
      repository_url="https://dl.google.com/dl/android/maven2"
    else
      repository_url="https://repo.maven.apache.org/maven2"
    fi
    printf '%s\n' "Could not get resource '\${repository_url}/org/example/dependency/1.0/dependency-1.0.pom'."
    printf '%s\n' "Received status code 403 from server: Forbidden"
  elif [[ "$attempt_failure_mode" == "mixed-repository-responses" ]]; then
    printf '%s\n' "Could not GET 'https://repo.maven.apache.org/maven2/org/example/dependency/1.0/dependency-1.0.pom'."
    printf '%s\n' "Received status code 404 from server: Not Found"
    printf '%s\n' "Could not GET 'https://dl.google.com/dl/android/maven2/org/example/dependency/1.0/dependency-1.0.pom'."
    printf '%s\n' "Received status code 403 from server: Forbidden"
  elif [[ "$attempt_failure_mode" == maven-* || "$attempt_failure_mode" == other-repository-* ]]; then
    if [[ "$attempt_failure_mode" == "maven-404" ]]; then
      status_code=404
      status_text="Not Found"
    else
      status_code=403
      status_text="Forbidden"
    fi
    if [[ "$attempt_failure_mode" == other-repository-* ]]; then
      repository_url="https://dl.google.com/dl/android/maven2"
    else
      repository_url="https://repo.maven.apache.org/maven2"
    fi
    printf '%s\n' "Could not GET '\${repository_url}/org/example/dependency/1.0/dependency-1.0.pom'."
    printf '%s\n' "Received status code $status_code from server: $status_text"
  elif [[ "$attempt_failure_mode" == "split-install-broken-pipe" ]]; then
    printf '%s\n' 'Starting 0 tests on emulator-5570 - 17'
    printf '%s\n' 'Failed to install split APK(s): [app-ctRegression.apk]'
    printf '%s\n' "Unknown failure: cmd: Failure calling service package: Broken pipe (32)"
  elif [[ "$attempt_failure_mode" == package-manager* ]]; then
    printf '%s\n' 'Failed to commit install session 1234'
    printf '%s\n' 'Failure calling service package: Broken pipe (32)'
  elif [[ "$attempt_failure_mode" == "missing-package-service" ]]; then
    printf '%s\n' 'Starting 0 tests on emulator-5570 - 17'
    printf '%s\n' 'Failed to install split APK(s): [app-ctRegression.apk]'
    printf '%s\n' "Unknown failure: cmd: Can't find service: package"
  elif [[ "$attempt_failure_mode" == install-write* ]]; then
    if [[ "$attempt_failure_mode" == "install-write-with-tests" ]]; then
      printf '%s\n' 'Starting 1 tests on emulator-5570 - 17'
    else
      printf '%s\n' 'Starting 0 tests on emulator-5570 - 17'
    fi
    printf '%s\n' 'Failed to install-write all apks'
  elif [[ "$attempt_failure_mode" == instrumentation-crash* ]]; then
    printf '%s\n' 'Starting 0 tests on emulator-5570 - 17'
    printf '%s\n' 'Test run failed to complete. No test results.'
    printf '%s\n' 'INSTRUMENTATION_ABORTED: System has crashed.'
  elif [[ "$attempt_failure_mode" == command-error* ]]; then
    if [[ "$attempt_failure_mode" == "command-error-with-tests" ]]; then
      printf '%s\n' 'Starting 1 tests on emulator-5570 - 17'
    else
      printf '%s\n' 'Starting 0 tests on emulator-5570 - 17'
    fi
    if [[ "$attempt_failure_mode" == "command-error-with-diagnostic" ]]; then
      printf '%s\n' "Test run failed to complete. No test results. onError: commandError=true message=Attempt to invoke interface method 'boolean android.app.IActivityManager.startInstrumentation(...)' on a null object reference"
    else
      printf '%s\n' 'Test run failed to complete. No test results. onError: commandError=true message=null'
    fi
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
printf 'wait:%s\n' "$*" >> "${recoveryEventPath}"
`
        );
        writeExecutable(
          join(scriptsRoot, "with-android-env.sh"),
          `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${rebootPath}"
printf 'reboot:%s\n' "$*" >> "${recoveryEventPath}"
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
          reboots: existsSync(rebootPath)
            ? readFileSync(rebootPath, "utf8").trim().split("\n")
            : [],
          waits: existsSync(waitPath)
            ? readFileSync(waitPath, "utf8").trim().split("\n")
            : [],
          recoveryEvents: readFileSync(recoveryEventPath, "utf8")
            .trim()
            .split("\n"),
        };
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    };

    const recoverableMavenCentralFailure = runScenario(29, "maven-403");
    expect(recoverableMavenCentralFailure.result.status).toBe(0);
    expect(recoverableMavenCentralFailure.attempts).toBe(2);
    expect(recoverableMavenCentralFailure.reboots).toEqual([]);
    expect(recoverableMavenCentralFailure.waits).toEqual([]);
    expect(recoverableMavenCentralFailure.result.stdout).toContain(
      "Retrying Gradle after transient Maven Central HTTP 403"
    );

    const sameLineMavenCentralFailure = runScenario(29, "maven-403-same-line");
    expect(sameLineMavenCentralFailure.result.status).toBe(0);
    expect(sameLineMavenCentralFailure.attempts).toBe(2);
    expect(sameLineMavenCentralFailure.reboots).toEqual([]);
    expect(sameLineMavenCentralFailure.waits).toEqual([]);

    const resourceMavenCentralFailure = runScenario(29, "maven-403-resource");
    expect(resourceMavenCentralFailure.result.status).toBe(0);
    expect(resourceMavenCentralFailure.attempts).toBe(2);
    expect(resourceMavenCentralFailure.reboots).toEqual([]);
    expect(resourceMavenCentralFailure.waits).toEqual([]);

    const repeatedMavenCentralFailure = runScenario(29, "maven-403-always");
    expect(repeatedMavenCentralFailure.result.status).toBe(1);
    expect(repeatedMavenCentralFailure.attempts).toBe(2);
    expect(repeatedMavenCentralFailure.reboots).toEqual([]);
    expect(repeatedMavenCentralFailure.waits).toEqual([]);

    const nonTransientMavenFailure = runScenario(29, "maven-404");
    expect(nonTransientMavenFailure.result.status).toBe(1);
    expect(nonTransientMavenFailure.attempts).toBe(1);
    expect(nonTransientMavenFailure.reboots).toEqual([]);
    expect(nonTransientMavenFailure.waits).toEqual([]);

    const unrelatedRepositoryFailure = runScenario(29, "other-repository-403");
    expect(unrelatedRepositoryFailure.result.status).toBe(1);
    expect(unrelatedRepositoryFailure.attempts).toBe(1);
    expect(unrelatedRepositoryFailure.reboots).toEqual([]);
    expect(unrelatedRepositoryFailure.waits).toEqual([]);

    const unrelatedResourceFailure = runScenario(
      29,
      "other-repository-403-resource"
    );
    expect(unrelatedResourceFailure.result.status).toBe(1);
    expect(unrelatedResourceFailure.attempts).toBe(1);
    expect(unrelatedResourceFailure.reboots).toEqual([]);
    expect(unrelatedResourceFailure.waits).toEqual([]);

    const mixedRepositoryResponses = runScenario(
      29,
      "mixed-repository-responses"
    );
    expect(mixedRepositoryResponses.result.status).toBe(1);
    expect(mixedRepositoryResponses.attempts).toBe(1);
    expect(mixedRepositoryResponses.reboots).toEqual([]);
    expect(mixedRepositoryResponses.waits).toEqual([]);

    const chainedApi37Failure = runScenario(
      37,
      "maven-403-then-package-manager"
    );
    expect(chainedApi37Failure.result.status).toBe(0);
    expect(chainedApi37Failure.attempts).toBe(3);
    expect(chainedApi37Failure.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(chainedApi37Failure.waits).toEqual(["emulator-5570 60"]);
    expect(chainedApi37Failure.recoveryEvents).toEqual([
      "attempt:1",
      "attempt:2",
      "reboot:adb -s emulator-5570 reboot",
      "wait:emulator-5570 60",
      "attempt:3",
    ]);
    expect(chainedApi37Failure.result.stdout).toContain(
      "Retrying Gradle after transient Maven Central HTTP 403"
    );
    expect(chainedApi37Failure.result.stdout).toContain(
      "Retrying API 37 instrumentation after PackageManager connection failure"
    );

    const recoverableApi37Failure = runScenario(37, "package-manager");
    expect(recoverableApi37Failure.result.status).toBe(0);
    expect(recoverableApi37Failure.attempts).toBe(2);
    expect(recoverableApi37Failure.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(recoverableApi37Failure.waits).toEqual(["emulator-5570 60"]);
    expect(recoverableApi37Failure.result.stdout).toContain(
      "Retrying API 37 instrumentation after PackageManager connection failure"
    );

    const recoverableMissingPackageService = runScenario(
      37,
      "missing-package-service"
    );
    expect(recoverableMissingPackageService.result.status).toBe(0);
    expect(recoverableMissingPackageService.attempts).toBe(2);
    expect(recoverableMissingPackageService.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(recoverableMissingPackageService.waits).toEqual([
      "emulator-5570 60",
    ]);
    expect(recoverableMissingPackageService.result.stdout).toContain(
      "Retrying API 37 instrumentation after PackageManager connection failure"
    );

    const recoverableSplitInstallBrokenPipe = runScenario(
      37,
      "split-install-broken-pipe"
    );
    expect(recoverableSplitInstallBrokenPipe.result.status).toBe(0);
    expect(recoverableSplitInstallBrokenPipe.attempts).toBe(2);
    expect(recoverableSplitInstallBrokenPipe.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(recoverableSplitInstallBrokenPipe.waits).toEqual([
      "emulator-5570 60",
    ]);
    expect(recoverableSplitInstallBrokenPipe.result.stdout).toContain(
      "Retrying API 37 instrumentation after PackageManager connection failure"
    );

    const repeatedApi37Failure = runScenario(37, "package-manager-always");
    expect(repeatedApi37Failure.result.status).toBe(1);
    expect(repeatedApi37Failure.attempts).toBe(2);
    expect(repeatedApi37Failure.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(repeatedApi37Failure.waits).toEqual(["emulator-5570 60"]);

    const missingPackageServiceAfterPackageManagerFailure = runScenario(
      37,
      "package-manager-then-missing-package-service"
    );
    expect(missingPackageServiceAfterPackageManagerFailure.result.status).toBe(
      0
    );
    expect(missingPackageServiceAfterPackageManagerFailure.attempts).toBe(3);
    expect(missingPackageServiceAfterPackageManagerFailure.reboots).toEqual([
      "adb -s emulator-5570 reboot",
      "adb -s emulator-5570 reboot",
    ]);
    expect(missingPackageServiceAfterPackageManagerFailure.waits).toEqual([
      "emulator-5570 60",
      "emulator-5570 60",
    ]);

    const recoverableInstallWriteFailure = runScenario(37, "install-write");
    expect(recoverableInstallWriteFailure.result.status).toBe(0);
    expect(recoverableInstallWriteFailure.attempts).toBe(2);
    expect(recoverableInstallWriteFailure.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(recoverableInstallWriteFailure.waits).toEqual(["emulator-5570 60"]);
    expect(recoverableInstallWriteFailure.result.stdout).toContain(
      "Retrying API 37 instrumentation after PackageManager install-write failure"
    );

    const persistentInstallWriteFailure = runScenario(
      37,
      "install-write-always"
    );
    expect(persistentInstallWriteFailure.result.status).toBe(1);
    expect(persistentInstallWriteFailure.attempts).toBe(2);
    expect(persistentInstallWriteFailure.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(persistentInstallWriteFailure.waits).toEqual(["emulator-5570 60"]);

    const installWriteAfterTestStart = runScenario(
      37,
      "install-write-with-tests"
    );
    expect(installWriteAfterTestStart.result.status).toBe(1);
    expect(installWriteAfterTestStart.attempts).toBe(1);
    expect(installWriteAfterTestStart.reboots).toEqual([]);
    expect(installWriteAfterTestStart.waits).toEqual([]);

    const recoverableInstrumentationCrash = runScenario(
      37,
      "instrumentation-crash"
    );
    expect(recoverableInstrumentationCrash.result.status).toBe(0);
    expect(recoverableInstrumentationCrash.attempts).toBe(2);
    expect(recoverableInstrumentationCrash.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(recoverableInstrumentationCrash.waits).toEqual(["emulator-5570 60"]);
    expect(recoverableInstrumentationCrash.recoveryEvents).toEqual([
      "attempt:1",
      "reboot:adb -s emulator-5570 reboot",
      "wait:emulator-5570 60",
      "attempt:2",
    ]);
    expect(recoverableInstrumentationCrash.result.stdout).toContain(
      "Retrying API 37 instrumentation after pre-test system crash"
    );

    const installWriteFailureAfterInstrumentationCrash = runScenario(
      37,
      "instrumentation-crash-then-install-write"
    );
    expect(installWriteFailureAfterInstrumentationCrash.result.status).toBe(0);
    expect(installWriteFailureAfterInstrumentationCrash.attempts).toBe(3);
    expect(installWriteFailureAfterInstrumentationCrash.reboots).toEqual([
      "adb -s emulator-5570 reboot",
      "adb -s emulator-5570 reboot",
    ]);
    expect(installWriteFailureAfterInstrumentationCrash.waits).toEqual([
      "emulator-5570 60",
      "emulator-5570 60",
    ]);
    expect(installWriteFailureAfterInstrumentationCrash.recoveryEvents).toEqual(
      [
        "attempt:1",
        "reboot:adb -s emulator-5570 reboot",
        "wait:emulator-5570 60",
        "attempt:2",
        "reboot:adb -s emulator-5570 reboot",
        "wait:emulator-5570 60",
        "attempt:3",
      ]
    );

    const packageServiceFailureAfterInstrumentationCrash = runScenario(
      37,
      "instrumentation-crash-then-missing-package-service"
    );
    expect(packageServiceFailureAfterInstrumentationCrash.result.status).toBe(
      0
    );
    expect(packageServiceFailureAfterInstrumentationCrash.attempts).toBe(3);
    expect(packageServiceFailureAfterInstrumentationCrash.reboots).toEqual([
      "adb -s emulator-5570 reboot",
      "adb -s emulator-5570 reboot",
    ]);
    expect(packageServiceFailureAfterInstrumentationCrash.waits).toEqual([
      "emulator-5570 60",
      "emulator-5570 60",
    ]);
    expect(
      packageServiceFailureAfterInstrumentationCrash.recoveryEvents
    ).toEqual([
      "attempt:1",
      "reboot:adb -s emulator-5570 reboot",
      "wait:emulator-5570 60",
      "attempt:2",
      "reboot:adb -s emulator-5570 reboot",
      "wait:emulator-5570 60",
      "attempt:3",
    ]);

    const testFailureAfterInfrastructureRecovery = runScenario(
      37,
      "instrumentation-crash-then-missing-package-service-then-test"
    );
    expect(testFailureAfterInfrastructureRecovery.result.status).toBe(1);
    expect(testFailureAfterInfrastructureRecovery.attempts).toBe(3);
    expect(testFailureAfterInfrastructureRecovery.reboots).toEqual([
      "adb -s emulator-5570 reboot",
      "adb -s emulator-5570 reboot",
    ]);
    expect(testFailureAfterInfrastructureRecovery.waits).toEqual([
      "emulator-5570 60",
      "emulator-5570 60",
    ]);
    expect(testFailureAfterInfrastructureRecovery.recoveryEvents).toEqual([
      "attempt:1",
      "reboot:adb -s emulator-5570 reboot",
      "wait:emulator-5570 60",
      "attempt:2",
      "reboot:adb -s emulator-5570 reboot",
      "wait:emulator-5570 60",
      "attempt:3",
    ]);

    const repeatedInstrumentationCrash = runScenario(
      37,
      "instrumentation-crash-always"
    );
    expect(repeatedInstrumentationCrash.result.status).toBe(1);
    expect(repeatedInstrumentationCrash.attempts).toBe(2);
    expect(repeatedInstrumentationCrash.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(repeatedInstrumentationCrash.waits).toEqual(["emulator-5570 60"]);

    const recoverableCommandError = runScenario(37, "command-error");
    expect(recoverableCommandError.result.status).toBe(0);
    expect(recoverableCommandError.attempts).toBe(2);
    expect(recoverableCommandError.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(recoverableCommandError.waits).toEqual(["emulator-5570 60"]);
    expect(recoverableCommandError.result.stdout).toContain(
      "Retrying API 37 instrumentation after zero-test command error"
    );

    const packageServiceFailureAfterCommandError = runScenario(
      37,
      "command-error-then-missing-package-service"
    );
    expect(packageServiceFailureAfterCommandError.result.status).toBe(0);
    expect(packageServiceFailureAfterCommandError.attempts).toBe(3);
    expect(packageServiceFailureAfterCommandError.reboots).toEqual([
      "adb -s emulator-5570 reboot",
      "adb -s emulator-5570 reboot",
    ]);
    expect(packageServiceFailureAfterCommandError.waits).toEqual([
      "emulator-5570 60",
      "emulator-5570 60",
    ]);

    const recoverableCommandErrorWithDiagnostic = runScenario(
      37,
      "command-error-with-diagnostic"
    );
    expect(recoverableCommandErrorWithDiagnostic.result.status).toBe(0);
    expect(recoverableCommandErrorWithDiagnostic.attempts).toBe(2);
    expect(recoverableCommandErrorWithDiagnostic.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(recoverableCommandErrorWithDiagnostic.waits).toEqual([
      "emulator-5570 60",
    ]);

    const repeatedCommandError = runScenario(37, "command-error-always");
    expect(repeatedCommandError.result.status).toBe(1);
    expect(repeatedCommandError.attempts).toBe(2);
    expect(repeatedCommandError.reboots).toEqual([
      "adb -s emulator-5570 reboot",
    ]);
    expect(repeatedCommandError.waits).toEqual(["emulator-5570 60"]);

    const api36Failure = runScenario(36, "package-manager");
    expect(api36Failure.result.status).toBe(1);
    expect(api36Failure.attempts).toBe(1);
    expect(api36Failure.reboots).toEqual([]);
    expect(api36Failure.waits).toEqual([]);

    const api36InstrumentationCrash = runScenario(36, "instrumentation-crash");
    expect(api36InstrumentationCrash.result.status).toBe(1);
    expect(api36InstrumentationCrash.attempts).toBe(1);
    expect(api36InstrumentationCrash.waits).toEqual([]);

    const api36CommandError = runScenario(36, "command-error");
    expect(api36CommandError.result.status).toBe(1);
    expect(api36CommandError.attempts).toBe(1);
    expect(api36CommandError.waits).toEqual([]);

    const api36InstallWriteFailure = runScenario(36, "install-write");
    expect(api36InstallWriteFailure.result.status).toBe(1);
    expect(api36InstallWriteFailure.attempts).toBe(1);
    expect(api36InstallWriteFailure.reboots).toEqual([]);
    expect(api36InstallWriteFailure.waits).toEqual([]);

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
    expect(testFailure.reboots).toEqual([]);
    expect(testFailure.waits).toEqual([]);
  });
});
