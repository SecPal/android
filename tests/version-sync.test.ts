/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

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
});
