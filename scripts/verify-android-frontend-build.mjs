#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDirectNodeExecution } from "./inject-native-auth-bridge.mjs";

const metadataName = "build-metadata.json";
const expectedMetadata = {
  schemaVersion: 1,
  applicationSurface: "android-native",
  buildMode: "android",
  production: true,
};
const expectedMetadataSource = `${JSON.stringify(expectedMetadata, null, 2)}\n`;

export function verifyAndroidFrontendBuildMetadataSource(
  source,
  sourceLabel = metadataName
) {
  let metadata;
  try {
    metadata = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Android frontend build metadata is missing or invalid at ${sourceLabel}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  const keys =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? Object.keys(metadata).sort()
      : [];
  const expectedKeys = Object.keys(expectedMetadata).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    Object.entries(expectedMetadata).some(
      ([key, expectedValue]) => metadata[key] !== expectedValue
    )
  ) {
    throw new Error(
      `Android frontend build metadata at ${sourceLabel} must contain exactly schemaVersion 1, applicationSurface android-native, buildMode android, and production true.`
    );
  }
  if (source !== expectedMetadataSource) {
    throw new Error(
      `Android frontend build metadata at ${sourceLabel} must use the deterministic build metadata serialization without duplicate, reordered, or ambiguously encoded properties.`
    );
  }
}

export function verifyAndroidFrontendBuildMetadata(assetRoot) {
  const metadataPath = join(assetRoot, metadataName);
  let source;
  try {
    source = readFileSync(metadataPath, "utf8");
  } catch (error) {
    throw new Error(
      `Android frontend build metadata is missing or invalid at ${metadataPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  verifyAndroidFrontendBuildMetadataSource(source, metadataPath);
}

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const [, , assetRoot] = process.argv;
    if (!assetRoot) {
      throw new Error(
        "Usage: node scripts/verify-android-frontend-build.mjs <frontend-build-directory>"
      );
    }
    verifyAndroidFrontendBuildMetadata(resolve(assetRoot));
    console.log("ANDROID_FRONTEND_BUILD_METADATA_OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
