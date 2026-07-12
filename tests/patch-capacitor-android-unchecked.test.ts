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
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  patchCapacitorAndroidSource,
  patchCapacitorAndroidSources,
} from "../scripts/patch-capacitor-android-unchecked.mjs";

const pluginPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Plugin.java";
const bridgeWebChromeClientPath =
  "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java";

function writeFixture(repoRoot: string, path: string, source: string) {
  const absolutePath = join(repoRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

describe("patchCapacitorAndroidSource", () => {
  it("parameterizes the raw Capacitor generics that emit unchecked warnings", () => {
    const source = [
      "CopyOnWriteArrayList<PluginCall> listenersCopy = new CopyOnWriteArrayList(listeners);",
      "private ActivityResultLauncher permissionLauncher;",
      "private ActivityResultLauncher activityLauncher;",
      "permissionLauncher.launch(permissions);",
      "activityLauncher.launch(intent);",
    ].join("\n");

    expect(patchCapacitorAndroidSource(source)).toBe(
      [
        "CopyOnWriteArrayList<PluginCall> listenersCopy = new CopyOnWriteArrayList<>(listeners);",
        "private ActivityResultLauncher<String[]> permissionLauncher;",
        "private ActivityResultLauncher<Intent> activityLauncher;",
        "permissionLauncher.launch(permissions);",
        "activityLauncher.launch(intent);",
      ].join("\n")
    );
  });

  it("fails closed when a supported Capacitor source no longer matches", () => {
    expect(() => patchCapacitorAndroidSource("unrecognized source")).toThrow(
      "Expected Capacitor unchecked Java source pattern was not found"
    );
  });

  it("fails closed when only part of the expected source matches", () => {
    expect(() =>
      patchCapacitorAndroidSource(
        "private ActivityResultLauncher permissionLauncher;"
      )
    ).toThrow("Expected Capacitor unchecked Java source pattern was not found");
  });

  it("validates every Capacitor source before writing any patched file", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "secpal-capacitor-patch-"));
    const pluginSource = "new CopyOnWriteArrayList(listeners)";

    try {
      writeFixture(repoRoot, pluginPath, pluginSource);
      writeFixture(repoRoot, bridgeWebChromeClientPath, "upstream drift");

      expect(() => patchCapacitorAndroidSources(repoRoot)).toThrow(
        "Expected Capacitor unchecked Java source pattern was not found"
      );
      expect(readFileSync(join(repoRoot, pluginPath), "utf8")).toBe(
        pluginSource
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
