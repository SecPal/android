/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../capacitor.config";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("capacitor Android wrapper configuration", () => {
  it("reuses the sibling frontend build as the only web source", () => {
    const webDir = config.webDir;

    expect(webDir).toBe("../frontend/dist");
    expect(webDir).toBeDefined();

    if (webDir !== undefined) {
      expect(webDir.startsWith("../frontend/")).toBe(true);
    }
  });

  it("keeps a committed native Android project alongside the wrapper", () => {
    expect(existsSync(resolve(repoRoot, "android/settings.gradle"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "android/app/build.gradle"))).toBe(
      true
    );
    expect(
      existsSync(resolve(repoRoot, "android/app/src/main/AndroidManifest.xml"))
    ).toBe(true);
  });

  it("uses the SecPal app identity and secure scheme", () => {
    expect(config.appId).toBe("app.secpal.app");
    expect(config.appName).toBe("SecPal");
    expect(config.server?.hostname).toBe("app.secpal.dev");
    expect(config.server?.androidScheme).toBe("https");
  });
});
