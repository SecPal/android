/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const tempRoots: string[] = [];

async function loadVersionSyncModule(): Promise<{
  verifyVersionSync: (options?: { repoRoot?: string }) => string;
}> {
  // @ts-expect-error The helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/verify-version-sync.mjs");
}

function createVersionTree(
  version: string,
  packageVersion = version,
  lockTopLevelVersion = version,
  lockRootVersion = lockTopLevelVersion
) {
  const root = mkdtempSync(join(tmpdir(), "secpal-version-sync-"));
  tempRoots.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "VERSION"), `${version}\n`);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@secpal/android", version: packageVersion })
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: "@secpal/android",
      version: lockTopLevelVersion,
      packages: {
        "": { name: "@secpal/android", version: lockRootVersion },
      },
    })
  );
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("canonical app version", () => {
  it("keeps the repository at the 0.1.0 development baseline", async () => {
    const { verifyVersionSync } = await loadVersionSyncModule();
    expect(verifyVersionSync({ repoRoot })).toBe("0.1.0");
  });

  it("accepts matching VERSION and npm metadata", async () => {
    const { verifyVersionSync } = await loadVersionSyncModule();
    expect(verifyVersionSync({ repoRoot: createVersionTree("0.1.0") })).toBe(
      "0.1.0"
    );
  });

  it.each(["0.1.0-01", "0.1.0-alpha.01"])(
    "rejects SemVer-invalid numeric prerelease identifiers in %s",
    async (version) => {
      const { verifyVersionSync } = await loadVersionSyncModule();

      expect(() =>
        verifyVersionSync({ repoRoot: createVersionTree(version) })
      ).toThrow(/valid semantic version/);

      const buildGradle = readFileSync(
        join(repoRoot, "android", "app", "build.gradle"),
        "utf8"
      );
      const gradlePattern = buildGradle.match(
        /releaseVersionName ==~ \/(.+)\//
      )?.[1];

      expect(gradlePattern).toBeDefined();
      expect(new RegExp(gradlePattern ?? "").test(version)).toBe(false);
    }
  );

  it("rejects a package.json version mismatch", async () => {
    const { verifyVersionSync } = await loadVersionSyncModule();
    expect(() =>
      verifyVersionSync({
        repoRoot: createVersionTree("0.1.0", "0.0.1", "0.1.0"),
      })
    ).toThrow(/package\.json/);
  });

  it("rejects a package-lock top-level version mismatch", async () => {
    const { verifyVersionSync } = await loadVersionSyncModule();
    expect(() =>
      verifyVersionSync({
        repoRoot: createVersionTree("0.1.0", "0.1.0", "0.0.1"),
      })
    ).toThrow(/package-lock\.json/);
  });

  it("rejects a package-lock root-package version mismatch", async () => {
    const { verifyVersionSync } = await loadVersionSyncModule();
    expect(() =>
      verifyVersionSync({
        repoRoot: createVersionTree("0.1.0", "0.1.0", "0.1.0", "0.0.1"),
      })
    ).toThrow(/package-lock\.json root package/);
  });

  it("keeps Gradle on VERSION and removes the legacy version-name input", () => {
    const buildGradle = readFileSync(
      join(repoRoot, "android", "app", "build.gradle"),
      "utf8"
    );

    expect(buildGradle).toContain(
      "rootProject.projectDir.parentFile, 'VERSION'"
    );
    expect(buildGradle).not.toContain(
      "System.getenv('SECPAL_ANDROID_VERSION_NAME')"
    );
  });

  it("keeps keystore setup free of version identity and current build values", () => {
    const setupScript = readFileSync(
      join(repoRoot, "scripts", "setup-android-release-keystore.sh"),
      "utf8"
    );

    expect(setupScript).not.toContain(
      'write_env_assignment "SECPAL_ANDROID_VERSION_CODE"'
    );
    expect(setupScript).not.toContain(
      'write_env_assignment "SECPAL_ANDROID_VERSION_NAME"'
    );
  });

  it("requires a valid explicit code before native signed Gradle builds", () => {
    const wrapperPath = join(
      repoRoot,
      "scripts",
      "require-android-build-version-code.rb"
    );
    const environment = { ...process.env };
    delete environment.SECPAL_ANDROID_VERSION_CODE;

    const missing = spawnSync(
      "ruby",
      [wrapperPath, "native:bundle:release:signed", "printf", "unreachable"],
      { cwd: repoRoot, env: environment, encoding: "utf8" }
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("native:bundle:release:signed");
    expect(missing.stderr).toContain("SECPAL_ANDROID_VERSION_CODE");

    const invalid = spawnSync(
      "ruby",
      [wrapperPath, "native:bundle:release:signed", "printf", "unreachable"],
      {
        cwd: repoRoot,
        env: { ...environment, SECPAL_ANDROID_VERSION_CODE: "1" },
        encoding: "utf8",
      }
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("YYYYMMDDXX");

    const valid = spawnSync(
      "ruby",
      [wrapperPath, "native:bundle:release:signed", "printf", "validated"],
      {
        cwd: repoRoot,
        env: {
          ...environment,
          SECPAL_ANDROID_VERSION_CODE: "2026072201",
        },
        encoding: "utf8",
      }
    );
    expect(valid.status).toBe(0);
    expect(valid.stdout).toBe("validated");
  });
});
