#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function verifyVersionSync({ repoRoot = defaultRepoRoot } = {}) {
  const canonicalVersion = readFileSync(
    resolve(repoRoot, "VERSION"),
    "utf8"
  ).trim();
  if (!semanticVersionPattern.test(canonicalVersion)) {
    throw new Error(
      `VERSION must contain one valid semantic version; received ${JSON.stringify(canonicalVersion)}`
    );
  }

  const packageJson = readJson(resolve(repoRoot, "package.json"));
  const packageLock = readJson(resolve(repoRoot, "package-lock.json"));
  const versions = {
    "package.json": packageJson.version,
    "package-lock.json top-level": packageLock.version,
    "package-lock.json root package": packageLock.packages?.[""]?.version,
  };

  for (const [source, version] of Object.entries(versions)) {
    if (version !== canonicalVersion) {
      throw new Error(
        `${source} version ${JSON.stringify(version)} does not match VERSION ${canonicalVersion}`
      );
    }
  }

  return canonicalVersion;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const version = verifyVersionSync();
    console.log(`VERSION_SYNC_OK ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
