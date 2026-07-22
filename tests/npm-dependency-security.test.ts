/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(repoRoot, file), "utf8")) as T;

type Version = readonly [number, number, number];

const parseVersion = (version: string): Version => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  expect(
    match,
    `Expected a stable semantic version, received ${version}`
  ).not.toBeNull();
  return [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
};

const compareVersions = (left: Version, right: Version) => {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
};

describe("npm dependency security", () => {
  it.each([
    ["brace-expansion", "^5.0.7", [5, 0, 7]],
    ["tar", "^7.5.19", [7, 5, 19]],
  ] as const)(
    "keeps every resolved %s instance on its supported security line",
    (dependency, overrideRange, minimumVersion) => {
      const packageJson = readJson<{
        overrides?: Record<string, unknown>;
      }>("package.json");
      const packageLock = readJson<{
        packages?: Record<string, { version?: string }>;
      }>("package-lock.json");

      expect(packageJson.overrides?.[dependency]).toBe(overrideRange);

      const lockfileEntries = Object.entries(packageLock.packages ?? {}).filter(
        ([path]) =>
          path === `node_modules/${dependency}` ||
          path.endsWith(`/node_modules/${dependency}`)
      );
      expect(lockfileEntries.length).toBeGreaterThan(0);

      for (const [path, entry] of lockfileEntries) {
        expect(entry.version, `${path} must declare a version`).toBeTypeOf(
          "string"
        );
        const resolvedVersion = parseVersion(entry.version ?? "");
        expect(
          resolvedVersion[0],
          `${path} must stay on the reviewed major`
        ).toBe(minimumVersion[0]);
        expect(
          compareVersions(resolvedVersion, minimumVersion),
          `${path} must resolve at or above ${minimumVersion.join(".")}`
        ).toBeGreaterThanOrEqual(0);
      }
    }
  );
});
