// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const androidWebAssetInventoryName = "secpal-web-assets.json";

const inventorySchemaVersion = 1;
const inventorySpdx =
  "SPDX-FileCopyrightText: 2026 SecPal Contributors; SPDX-License-Identifier: AGPL-3.0-or-later";
const sha256Pattern = /^[0-9a-f]{64}$/;
const androidAssetIgnorePolicyPath = fileURLToPath(
  new URL("../android/app/aapt-ignore-assets.json", import.meta.url)
);

function parseAndroidAssetIgnorePatterns(source, sourceLabel) {
  let policy;
  try {
    policy = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${sourceLabel} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  const pattern = policy?.ignore_assets_pattern;
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error(
      `${sourceLabel} must define a non-empty ignore_assets_pattern.`
    );
  }

  return pattern.split(":").map((configuredPattern) => {
    const entryPattern = configuredPattern.startsWith("!")
      ? configuredPattern.slice(1)
      : configuredPattern;
    const match = /^(\*)?([^*]+)(\*)?$/.exec(entryPattern);
    if (
      !match ||
      (match[1] && match[3]) ||
      /^<(?:dir|file)>/i.test(entryPattern)
    ) {
      throw new Error(
        `${sourceLabel} contains unsupported AAPT ignore pattern ${configuredPattern}.`
      );
    }

    const [, leadingWildcard, value, trailingWildcard] = match;
    const matchType = leadingWildcard
      ? "suffix"
      : trailingWildcard
        ? "prefix"
        : "exact";
    return { matchType, value: value.toLowerCase() };
  });
}

const androidAssetIgnorePatterns = parseAndroidAssetIgnorePatterns(
  readFileSync(androidAssetIgnorePolicyPath, "utf8"),
  androidAssetIgnorePolicyPath
);

function toPortablePath(path) {
  return path.split(sep).join("/");
}

function isIgnoredAndroidAssetName(name) {
  if (name === "." || name === "..") return true;
  const normalizedName = name.toLowerCase();
  return androidAssetIgnorePatterns.some(({ matchType, value }) => {
    if (matchType === "prefix") return normalizedName.startsWith(value);
    if (matchType === "suffix") return normalizedName.endsWith(value);
    return normalizedName === value;
  });
}

function isPackageableAssetPath(path) {
  const segments = path.split("/");
  return (
    path !== androidWebAssetInventoryName &&
    segments.every((segment) => segment && !isIgnoredAndroidAssetName(segment))
  );
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function collectPackageableFiles(assetRoot) {
  const files = [];
  const pending = [assetRoot];

  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const assetPath = toPortablePath(relative(assetRoot, entryPath));
      if (!isPackageableAssetPath(assetPath)) continue;
      if (entry.isSymbolicLink()) {
        throw new Error(
          `${assetRoot} contains unsupported symbolic link ${assetPath}.`
        );
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(assetPath);
      } else {
        throw new Error(
          `${assetRoot} contains unsupported asset entry ${assetPath}.`
        );
      }
    }
  }

  return files.sort();
}

function parseInventory(source, sourceLabel) {
  let inventory;
  try {
    inventory = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${sourceLabel} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  if (
    !inventory ||
    typeof inventory !== "object" ||
    Array.isArray(inventory) ||
    inventory.schema_version !== inventorySchemaVersion ||
    !Array.isArray(inventory.files)
  ) {
    throw new Error(
      `${sourceLabel} must contain Android web asset inventory schema ${inventorySchemaVersion}.`
    );
  }

  const files = new Map();
  let previousPath = "";
  for (const entry of inventory.files) {
    const path = entry?.path;
    const sha256 = entry?.sha256;
    if (
      typeof path !== "string" ||
      !isPackageableAssetPath(path) ||
      path.startsWith("/") ||
      path.includes("\\") ||
      posix.normalize(path) !== path ||
      typeof sha256 !== "string" ||
      !sha256Pattern.test(sha256)
    ) {
      throw new Error(`${sourceLabel} contains an invalid asset entry.`);
    }
    if (path <= previousPath || files.has(path)) {
      throw new Error(
        `${sourceLabel} asset entries must be unique and sorted by path.`
      );
    }
    previousPath = path;
    files.set(path, sha256);
  }

  if (!files.has("index.html")) {
    throw new Error(`${sourceLabel} must declare index.html.`);
  }

  return files;
}

function assertMatchingPaths({ actualPaths, expectedFiles, sourceLabel }) {
  const actualPathSet = new Set(actualPaths);
  const missingPaths = [...expectedFiles.keys()].filter(
    (path) => !actualPathSet.has(path)
  );
  if (missingPaths.length > 0) {
    throw new Error(
      `${sourceLabel} is missing Android web assets declared by its inventory: ${missingPaths.join(", ")}`
    );
  }

  const unexpectedPaths = actualPaths.filter(
    (path) => !expectedFiles.has(path)
  );
  if (unexpectedPaths.length > 0) {
    throw new Error(
      `${sourceLabel} contains Android web assets that are not declared by its Android web asset inventory: ${unexpectedPaths.join(", ")}`
    );
  }
}

function assertNoMismatchedPaths(mismatchedPaths, sourceLabel) {
  if (mismatchedPaths.length > 0) {
    throw new Error(
      `${sourceLabel} does not match its Android web asset inventory: ${mismatchedPaths.join(", ")}`
    );
  }
}

export function writeAndroidWebAssetInventory(assetRoot, mirrorInventoryPath) {
  const inventory = {
    $comment: inventorySpdx,
    schema_version: inventorySchemaVersion,
    files: collectPackageableFiles(assetRoot).map((path) => ({
      path,
      sha256: hash(readFileSync(join(assetRoot, ...path.split("/")))),
    })),
  };
  const inventoryPath = join(assetRoot, androidWebAssetInventoryName);
  const inventorySource = `${JSON.stringify(inventory, null, 2)}\n`;
  writeFileSync(inventoryPath, inventorySource);
  if (mirrorInventoryPath && mirrorInventoryPath !== inventoryPath) {
    writeFileSync(mirrorInventoryPath, inventorySource);
  }
  return inventoryPath;
}

export function assertAndroidWebAssetDirectory(assetRoot, inventoryPath) {
  const expectedFiles = parseInventory(
    readFileSync(inventoryPath, "utf8"),
    inventoryPath
  );
  const actualPaths = collectPackageableFiles(assetRoot);
  assertMatchingPaths({
    actualPaths,
    expectedFiles,
    sourceLabel: assetRoot,
  });
  assertNoMismatchedPaths(
    [...expectedFiles].flatMap(([path, expectedSha256]) =>
      hash(readFileSync(join(assetRoot, ...path.split("/")))) === expectedSha256
        ? []
        : [path]
    ),
    assetRoot
  );
  return { actualPaths, expectedFiles };
}

export async function assertAndroidWebAssetArchive({
  archiveEntries,
  hashEntry,
  readEntry,
  runtimeAssetRoot,
  sourceLabel,
}) {
  const relativeEntries = archiveEntries
    .filter(
      (entry) => entry.startsWith(runtimeAssetRoot) && !entry.endsWith("/")
    )
    .map((entry) => entry.slice(runtimeAssetRoot.length))
    .filter(
      (path) =>
        path === androidWebAssetInventoryName || isPackageableAssetPath(path)
    );
  const manifestEntries = relativeEntries.filter(
    (path) => path === androidWebAssetInventoryName
  );
  if (manifestEntries.length !== 1) {
    throw new Error(
      `${sourceLabel} must contain exactly one Android web asset inventory at ${runtimeAssetRoot}${androidWebAssetInventoryName}.`
    );
  }

  const actualPaths = relativeEntries.filter(
    (path) => path !== androidWebAssetInventoryName
  );
  if (new Set(actualPaths).size !== actualPaths.length) {
    throw new Error(`${sourceLabel} contains duplicate Android web assets.`);
  }

  const inventoryEntry = `${runtimeAssetRoot}${androidWebAssetInventoryName}`;
  const expectedFiles = parseInventory(
    (await readEntry(inventoryEntry)).toString("utf8"),
    `${sourceLabel}:${inventoryEntry}`
  );
  assertMatchingPaths({
    actualPaths: actualPaths.sort(),
    expectedFiles,
    sourceLabel,
  });
  const mismatchedPaths = [];
  for (const [path, expectedSha256] of expectedFiles) {
    if ((await hashEntry(`${runtimeAssetRoot}${path}`)) !== expectedSha256) {
      mismatchedPaths.push(path);
    }
  }
  assertNoMismatchedPaths(mismatchedPaths, sourceLabel);
  return { actualPaths, expectedFiles };
}
