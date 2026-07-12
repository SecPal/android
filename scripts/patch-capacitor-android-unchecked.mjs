#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const replacements = [
  [
    "new CopyOnWriteArrayList(listeners)",
    "new CopyOnWriteArrayList<>(listeners)",
  ],
  [
    "private ActivityResultLauncher permissionLauncher;",
    "private ActivityResultLauncher<String[]> permissionLauncher;",
  ],
  [
    "private ActivityResultLauncher activityLauncher;",
    "private ActivityResultLauncher<Intent> activityLauncher;",
  ],
];

export function patchCapacitorAndroidSource(
  source,
  expectedReplacements = replacements
) {
  let patchedSource = source;

  for (const [unpatched, patched] of expectedReplacements) {
    if (patchedSource.includes(unpatched)) {
      patchedSource = patchedSource.replaceAll(unpatched, patched);
    } else if (patchedSource.includes(patched)) {
      continue;
    } else {
      throw new Error(
        "Expected Capacitor unchecked Java source pattern was not found"
      );
    }
  }

  return patchedSource;
}

export function patchCapacitorAndroidSources(repoRoot) {
  const sourceFiles = [
    [
      "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Plugin.java",
      replacements.slice(0, 1),
    ],
    [
      "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java",
      replacements.slice(1),
    ],
  ];

  const patchedFiles = sourceFiles.map(([sourcePath, expectedReplacements]) => {
    const absolutePath = resolve(repoRoot, sourcePath);
    const source = readFileSync(absolutePath, "utf8");
    const patchedSource = patchCapacitorAndroidSource(
      source,
      expectedReplacements
    );

    return { absolutePath, source, patchedSource };
  });

  for (const { absolutePath, source, patchedSource } of patchedFiles) {
    if (patchedSource !== source) {
      writeFileSync(absolutePath, patchedSource, "utf8");
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  patchCapacitorAndroidSources(repoRoot);
}
