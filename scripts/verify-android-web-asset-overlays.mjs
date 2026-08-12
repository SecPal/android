#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  isDirectNodeExecution,
  nativeAuthBridgeAssetPrefix,
} from "./inject-native-auth-bridge.mjs";

const protectedPaths = new Set([
  "public/index.html",
  "public/build-metadata.json",
  "public/secpal-web-assets.json",
]);

function portablePath(path) {
  return path.split(sep).join("/");
}

export function verifyAndroidWebAssetOverlays(overlayRoots) {
  for (const overlayRoot of overlayRoots) {
    if (!existsSync(overlayRoot)) {
      continue;
    }
    const pending = [overlayRoot];
    while (pending.length > 0) {
      const directory = pending.pop();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = join(directory, entry.name);
        const assetPath = portablePath(relative(overlayRoot, entryPath));
        if (entry.isSymbolicLink()) {
          throw new Error(
            `${overlayRoot} contains unsupported symbolic link ${assetPath}. Android asset overlays must contain only local directories and regular files.`
          );
        }
        if (entry.isDirectory()) {
          pending.push(entryPath);
          continue;
        }
        if (!entry.isFile()) {
          throw new Error(
            `${overlayRoot} contains unsupported Android asset overlay entry ${assetPath}.`
          );
        }
        if (assetPath.startsWith("public/")) {
          const protectionReason =
            protectedPaths.has(assetPath) ||
            assetPath.startsWith(`public/${nativeAuthBridgeAssetPrefix}`)
              ? "protected"
              : "non-inventoried";
          throw new Error(
            `${overlayRoot} contains ${protectionReason} Android web asset overlay ${assetPath}. Build-type overlays must not bypass the canonical runtime inventory.`
          );
        }
      }
    }
  }
}

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const overlayRoots = process.argv.slice(2).map((path) => resolve(path));
    if (overlayRoots.length === 0) {
      throw new Error(
        "Usage: node scripts/verify-android-web-asset-overlays.mjs <overlay-directory> [...]"
      );
    }
    verifyAndroidWebAssetOverlays(overlayRoots);
    console.log("ANDROID_WEB_ASSET_OVERLAYS_OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
