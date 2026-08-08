#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { resolve } from "node:path";
import { writeAndroidWebAssetInventory } from "./android-web-asset-inventory.mjs";
import { isDirectNodeExecution } from "./inject-native-auth-bridge.mjs";

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const [, , assetRoot, ...options] = process.argv;
    if (!assetRoot) {
      throw new Error(
        "Usage: node scripts/generate-android-web-asset-inventory.mjs <web-asset-directory> [--overlay <directory>] [--output <inventory-path>]"
      );
    }
    const overlayRoots = [];
    let inventoryPath;
    for (let index = 0; index < options.length; index += 2) {
      const option = options[index];
      const value = options[index + 1];
      if (!value || !["--overlay", "--output"].includes(option)) {
        throw new Error("Invalid Android web asset inventory option.");
      }
      if (option === "--overlay") {
        overlayRoots.push(resolve(value));
      } else {
        if (inventoryPath) {
          throw new Error(
            "Android web asset inventory output was provided twice."
          );
        }
        inventoryPath = resolve(value);
      }
    }
    writeAndroidWebAssetInventory(resolve(assetRoot), {
      inventoryPath,
      overlayRoots,
    });
    console.log("ANDROID_WEB_ASSET_INVENTORY_OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
