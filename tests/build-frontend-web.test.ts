/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  chmodSync,
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

function runBuildScript(frontendDirectory?: string) {
  const tempRoot = mkdtempSync(join(tmpdir(), "build-frontend-web-"));
  const isolatedRepositoryRoot = join(tempRoot, "android");

  writeFileSync(
    join(tempRoot, "git"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$SECPAL_TEST_REPOSITORY_ROOT\"\n"
  );
  chmodSync(join(tempRoot, "git"), 0o755);

  try {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${tempRoot}:${process.env.PATH ?? ""}`,
      SECPAL_TEST_REPOSITORY_ROOT: isolatedRepositoryRoot,
    };

    if (frontendDirectory) {
      environment.SECPAL_ANDROID_FRONTEND_DIR = frontendDirectory;
    } else {
      delete environment.SECPAL_ANDROID_FRONTEND_DIR;
    }

    const result = spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: environment,
    });

    return {
      conventionalFrontendDirectory: `${isolatedRepositoryRoot}/../frontend`,
      result,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe("build frontend web script", () => {
  it("builds and verifies the explicit Android-native frontend surface", () => {
    const source = readFileSync(buildScript, "utf8");

    expect(source).toContain("npm run build:android");
    expect(source).toContain("verify-android-frontend-build.mjs");
    expect(source.indexOf("verify-android-frontend-build.mjs")).toBeLessThan(
      source.indexOf("inject-native-auth-bridge.mjs")
    );
    expect(source).not.toMatch(/\bnpm run build\s*$/m);
  });

  it("uses the conventional sibling frontend checkout by default", () => {
    const { conventionalFrontendDirectory, result } = runBuildScript();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `frontend repository not found at: ${conventionalFrontendDirectory}`
    );
  });

  it("uses SECPAL_ANDROID_FRONTEND_DIR when provided", () => {
    const frontendDirectory = "/linked-workspaces/frontend";
    const { result } = runBuildScript(frontendDirectory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `frontend repository not found at: ${frontendDirectory}`
    );
  });
});
