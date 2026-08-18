/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
const expectedFrontendRevision = "8c950220d8ae582a536135eed75c8ecb2a4858c8";

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

function runBuildScriptWithFrontendState({
  actualRevision = expectedFrontendRevision,
  dirty = false,
  ignoredBuildInput = false,
}: {
  actualRevision?: string;
  dirty?: boolean;
  ignoredBuildInput?: boolean;
}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "build-frontend-state-"));
  const isolatedRepositoryRoot = join(tempRoot, "android");
  const frontendDirectory = join(tempRoot, "frontend");

  mkdirSync(
    join(
      isolatedRepositoryRoot,
      "android",
      "app",
      "src",
      "main",
      "res",
      "values"
    ),
    { recursive: true }
  );
  mkdirSync(frontendDirectory, { recursive: true });
  writeFileSync(
    join(isolatedRepositoryRoot, "android", "frontend-revision.txt"),
    `# SPDX-FileCopyrightText: 2026 SecPal Contributors\n# SPDX-License-Identifier: CC0-1.0\n${expectedFrontendRevision}\n`
  );
  writeFileSync(
    join(
      isolatedRepositoryRoot,
      "android",
      "app",
      "src",
      "main",
      "res",
      "values",
      "strings.xml"
    ),
    '<resources><string name="api_base_url">https://api.secpal.dev</string></resources>\n'
  );
  writeFileSync(join(frontendDirectory, "package.json"), "{}\n");
  writeFileSync(
    join(tempRoot, "git"),
    `#!/usr/bin/env bash
set -eu
if [ "$#" -eq 2 ] && [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  printf '%s\\n' "$SECPAL_TEST_REPOSITORY_ROOT"
elif [ "$1" = "-C" ] && [ "$3" = "rev-parse" ]; then
  printf '%s\\n' "$SECPAL_TEST_ACTUAL_REVISION"
elif [ "$1" = "-C" ] && [ "$3" = "status" ]; then
  if [[ " $* " == *" --ignored=matching "* ]]; then
    if [ "$SECPAL_TEST_FRONTEND_IGNORED_BUILD_INPUT" = "1" ]; then
      printf '!! .env.android.local\\n'
    fi
  elif [ "$SECPAL_TEST_FRONTEND_DIRTY" = "1" ]; then
    printf ' M src/App.tsx\\n'
  fi
elif [ "$1" = "-C" ] && [ "$3" = "show" ]; then
  printf '1786943204\\n'
else
  exit 91
fi
`
  );
  writeFileSync(
    join(tempRoot, "npm"),
    "#!/usr/bin/env bash\nprintf 'SOURCE_DATE_EPOCH=%s\\n' \"${SOURCE_DATE_EPOCH-}\"\nexit 73\n"
  );
  chmodSync(join(tempRoot, "git"), 0o755);
  chmodSync(join(tempRoot, "npm"), 0o755);

  try {
    return spawnSync("bash", [buildScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${tempRoot}:${process.env.PATH ?? ""}`,
        SECPAL_ANDROID_FRONTEND_DIR: frontendDirectory,
        SECPAL_TEST_ACTUAL_REVISION: actualRevision,
        SECPAL_TEST_FRONTEND_DIRTY: dirty ? "1" : "0",
        SECPAL_TEST_FRONTEND_IGNORED_BUILD_INPUT: ignoredBuildInput ? "1" : "0",
        SECPAL_TEST_REPOSITORY_ROOT: isolatedRepositoryRoot,
      },
    });
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

  it("builds a clean pinned frontend with its commit timestamp", () => {
    const result = runBuildScriptWithFrontendState({});

    expect(result.status).toBe(73);
    expect(result.stdout).toContain("SOURCE_DATE_EPOCH=1786943204");
  });

  it("rejects a frontend checkout at another revision", () => {
    const result = runBuildScriptWithFrontendState({
      actualRevision: "9".repeat(40),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match pinned revision");
  });

  it("rejects tracked or untracked frontend source changes", () => {
    const result = runBuildScriptWithFrontendState({ dirty: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("frontend checkout is not clean");
  });

  it("rejects ignored frontend build inputs", () => {
    const result = runBuildScriptWithFrontendState({
      ignoredBuildInput: true,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ignored build inputs");
    expect(result.stderr).toContain(".env.android.local");
  });
});
