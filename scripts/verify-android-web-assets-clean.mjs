#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { isDirectNodeExecution } from "./inject-native-auth-bridge.mjs";

const packagedAssetPaths = [
  "android/app/src/main/assets/public",
  "android/app/src/main/web-assets-fallback.json",
];

export function assertCleanAndroidWebAssets(repositoryRoot) {
  const status = execFileSync(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ...packagedAssetPaths,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    }
  ).trim();

  if (status) {
    throw new Error(
      "Generated Android web assets differ from the reviewed package:\n" +
        status
    );
  }
}

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const repositoryRoot =
      process.argv[2] ??
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }).trim();
    assertCleanAndroidWebAssets(resolve(repositoryRoot));
    console.log("ANDROID_WEB_ASSETS_CLEAN");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
