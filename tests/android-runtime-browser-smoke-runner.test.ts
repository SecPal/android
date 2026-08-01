/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
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
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryRoots: string[] = [];

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Android runtime browser smoke runner", () => {
  it("fails closed when the required Chromium executable is unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "android-browser-smoke-runner-"));
    temporaryRoots.push(root);
    const result = spawnSync(
      "bash",
      [resolve(repositoryRoot, "scripts/run-android-runtime-browser-smoke.sh")],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CHROMIUM_PATH: join(root, "missing-chromium"),
        },
      }
    );

    expect(result.status).toBe(66);
    expect(result.stderr).toContain(
      "Required Chromium executable is unavailable"
    );
  });

  it("runs exactly the strict-CSP browser smoke with the selected executable", () => {
    const root = mkdtempSync(join(tmpdir(), "android-browser-smoke-runner-"));
    temporaryRoots.push(root);
    const binRoot = join(root, "bin");
    const chromiumPath = join(root, "chromium");
    const invocationPath = join(root, "vitest-args");
    mkdirSync(binRoot);
    writeExecutable(chromiumPath, "#!/usr/bin/env bash\nexit 0\n");
    writeExecutable(
      join(binRoot, "vitest"),
      `#!/usr/bin/env bash
printf '%s\n' "$*" > "${invocationPath}"
`
    );

    const result = spawnSync(
      "bash",
      [resolve(repositoryRoot, "scripts/run-android-runtime-browser-smoke.sh")],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CHROMIUM_PATH: chromiumPath,
          PATH: `${binRoot}:${process.env.PATH ?? ""}`,
        },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(invocationPath, "utf8")).toBe(
      "run tests/android-runtime-browser-smoke.test.ts\n"
    );
  });

  it("discovers a Chromium-compatible executable from PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "android-browser-smoke-runner-"));
    temporaryRoots.push(root);
    const binRoot = join(root, "bin");
    const chromiumPath = join(binRoot, "chromium");
    const invocationPath = join(root, "vitest-env");
    mkdirSync(binRoot);
    writeExecutable(chromiumPath, "#!/usr/bin/env bash\nexit 0\n");
    writeExecutable(
      join(binRoot, "vitest"),
      `#!/usr/bin/env bash
printf '%s\n' "$CHROMIUM_PATH" > "${invocationPath}"
`
    );

    const result = spawnSync(
      "bash",
      [resolve(repositoryRoot, "scripts/run-android-runtime-browser-smoke.sh")],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CHROMIUM_PATH: "",
          PATH: `${binRoot}:/usr/bin:/bin`,
        },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(invocationPath, "utf8")).toBe(`${chromiumPath}\n`);
  });
});
