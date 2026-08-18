#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { resolve } from "node:path";
import { writeAndroidWebAssetInventory } from "./android-web-asset-inventory.mjs";
import { isDirectNodeExecution } from "./inject-native-auth-bridge.mjs";

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const [, , assetRoot, mirrorInventoryPath] = process.argv;
    if (!assetRoot) {
      throw new Error(
        "Usage: node scripts/generate-android-web-asset-inventory.mjs <web-asset-directory> [mirror-inventory-path]"
      );
    }
    writeAndroidWebAssetInventory(
      resolve(assetRoot),
      mirrorInventoryPath ? resolve(mirrorInventoryPath) : undefined
    );
    console.log("ANDROID_WEB_ASSET_INVENTORY_OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
