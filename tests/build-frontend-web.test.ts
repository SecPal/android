/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const buildScript = join(repositoryRoot, "scripts/build-frontend-web.sh");

type BuildFixtureOptions = {
  bridgeFailure?: boolean;
  createIndex?: boolean;
  createProvidedFrontend?: boolean;
  createSiblingFrontend?: boolean;
  frontendVerificationFailure?: boolean;
};

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function runBuildScript({
  bridgeFailure = false,
  createIndex = true,
  createProvidedFrontend = false,
  createSiblingFrontend = false,
  frontendVerificationFailure = false,
}: BuildFixtureOptions = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "build-frontend-web-"));
  const isolatedRepositoryRoot = join(tempRoot, "android");
  const siblingFrontendDirectory = join(tempRoot, "frontend");
  const providedFrontendDirectory = join(tempRoot, "linked-frontend");
  const selectedFrontendDirectory = createProvidedFrontend
    ? providedFrontendDirectory
    : siblingFrontendDirectory;
  const commandLog = join(tempRoot, "commands.log");

  writeFileSync(commandLog, "");

  mkdirSync(join(isolatedRepositoryRoot, "android/app/src/main/res/values"), {
    recursive: true,
  });
  mkdirSync(join(isolatedRepositoryRoot, "scripts"), { recursive: true });
  writeFileSync(
    join(isolatedRepositoryRoot, "android/app/src/main/res/values/strings.xml"),
    '<resources><string name="api_base_url">https://api.secpal.dev</string></resources>'
  );
  if (createSiblingFrontend || createProvidedFrontend) {
    mkdirSync(selectedFrontendDirectory, { recursive: true });
    writeFileSync(
      join(selectedFrontendDirectory, "package.json"),
      '{"scripts":{"build:android":"cross-env VITE_APP_SURFACE=android-native vite build --mode android"}}\n'
    );
  }

  writeExecutable(
    join(tempRoot, "git"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$SECPAL_TEST_REPOSITORY_ROOT\"\n"
  );
  writeExecutable(
    join(tempRoot, "npm"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf \'npm|%s|%s|%s\\n\' "$PWD" "$*" "${VITE_API_URL:-}" >>"$SECPAL_TEST_COMMAND_LOG"',
      'mkdir -p "$PWD/dist/assets"',
      'if [ "${SECPAL_TEST_CREATE_INDEX:-1}" = "1" ]; then',
      '  printf \'%s\\n\' \'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src &apos;self&apos;"><script type="module" src="/assets/index.js"></script></head><body></body></html>\' >"$PWD/dist/index.html"',
      "  printf '%s\\n' 'resolveAppSurface(\"android-native\", true);' >\"$PWD/dist/assets/index.js\"",
      "fi",
    ].join("\n")
  );
  writeExecutable(
    join(tempRoot, "node"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf \'node|%s\\n\' "$*" >>"$SECPAL_TEST_COMMAND_LOG"',
      'if [ "${SECPAL_TEST_BRIDGE_FAILURE:-0}" = "1" ]; then',
      '  echo "bridge generation failed" >&2',
      "  exit 23",
      "fi",
      'if [[ "$*" == *verify-android-frontend-build.mjs* ]] && [ "${SECPAL_TEST_FRONTEND_VERIFICATION_FAILURE:-0}" = "1" ]; then',
      '  echo "frontend contract verification failed" >&2',
      "  exit 24",
      "fi",
    ].join("\n")
  );

  try {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${tempRoot}:${process.env.PATH ?? ""}`,
      SECPAL_TEST_BRIDGE_FAILURE: bridgeFailure ? "1" : "0",
      SECPAL_TEST_COMMAND_LOG: commandLog,
      SECPAL_TEST_CREATE_INDEX: createIndex ? "1" : "0",
      SECPAL_TEST_FRONTEND_VERIFICATION_FAILURE: frontendVerificationFailure
        ? "1"
        : "0",
      SECPAL_TEST_REPOSITORY_ROOT: isolatedRepositoryRoot,
    };

    if (createProvidedFrontend) {
      environment.SECPAL_ANDROID_FRONTEND_DIR = providedFrontendDirectory;
    } else {
      delete environment.SECPAL_ANDROID_FRONTEND_DIR;
    }

    const result = spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: environment,
    });

    return {
      commandLog: readFileSync(commandLog, "utf8"),
      providedFrontendDirectory,
      result,
      siblingFrontendDirectory,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe("build frontend web script", () => {
  it("uses the conventional sibling frontend checkout by default", () => {
    const { result, siblingFrontendDirectory } = runBuildScript();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `frontend repository not found at: ${siblingFrontendDirectory}`
    );
  });

  it("uses SECPAL_ANDROID_FRONTEND_DIR and reports the selected checkout", () => {
    const { commandLog, providedFrontendDirectory, result } = runBuildScript({
      createProvidedFrontend: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `Building Android-native frontend from ${providedFrontendDirectory}`
    );
    expect(commandLog).toContain(`npm|${providedFrontendDirectory}|`);
  });

  it("builds the android-native surface with the configured API URL before bridge generation", () => {
    const { commandLog, result } = runBuildScript({
      createSiblingFrontend: true,
    });
    const commands = commandLog.trim().split("\n");

    expect(result.status, result.stderr).toBe(0);
    expect(commands[0]).toMatch(
      /^npm\|.*\/frontend\|run build:android\|https:\/\/api\.secpal\.dev$/u
    );
    expect(commands[1]).toMatch(
      /^node\|.*inject-native-auth-bridge\.mjs .*\/frontend\/dist\/index\.html .*\/strings\.xml$/u
    );
    expect(commands[2]).toMatch(
      /^node\|.*verify-android-frontend-build\.mjs .*\/frontend\/dist\/index\.html$/u
    );
  });

  it("fails before bridge generation when dist/index.html is missing", () => {
    const { commandLog, result } = runBuildScript({
      createIndex: false,
      createSiblingFrontend: true,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("index.html is missing");
    expect(commandLog).not.toContain("inject-native-auth-bridge.mjs");
  });

  it("propagates bridge generation failures", () => {
    const { result } = runBuildScript({
      bridgeFailure: true,
      createSiblingFrontend: true,
    });

    expect(result.status).toBe(23);
    expect(result.stderr).toContain("bridge generation failed");
    expect(result.stdout).not.toContain("frontend dist ready");
  });

  it("propagates post-build frontend contract failures", () => {
    const { result } = runBuildScript({
      createSiblingFrontend: true,
      frontendVerificationFailure: true,
    });

    expect(result.status).toBe(24);
    expect(result.stderr).toContain("frontend contract verification failed");
    expect(result.stdout).not.toContain("frontend dist ready");
  });
});
