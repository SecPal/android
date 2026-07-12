/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { describe, expect, it } from "vitest";

import { patchCapacitorAndroidSource } from "../scripts/patch-capacitor-android-unchecked.mjs";

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
});
