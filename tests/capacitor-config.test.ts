/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import config from "../capacitor.config";

const pluginMocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: vi.fn(() => pluginMocks),
}));

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("capacitor Android wrapper configuration", () => {
  it("reuses the sibling frontend build as the only web source", () => {
    const webDir = config.webDir;

    expect(webDir).toBe("../frontend/dist");
    expect(webDir).toBeDefined();
    expect(webDir?.startsWith("../frontend/")).toBe(true);
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

  it("uses the SecPal app identity, configured hostname, and secure scheme", () => {
    expect(config.appId).toBe("app.secpal.app");
    expect(config.appName).toBe("SecPal");
    expect(config.server?.hostname).toBe("app.secpal.dev");
    expect(config.server?.androidScheme).toBe("https");
  });

  it("installs a native auth bridge that normalizes the API base URL", async () => {
    pluginMocks.login.mockResolvedValue({ user: { id: 1 } });
    pluginMocks.request.mockResolvedValue({
      status: 200,
      body: '{"ok":true}',
      contentType: "application/json",
    });

    const { installNativeAuthBridge } =
      await import("../src/secpal/native-auth-bridge");
    const target = {} as typeof globalThis & {
      SecPalNativeAuthBridge?: unknown;
    };
    const bridge = installNativeAuthBridge(
      { apiBaseUrl: "https://api.secpal.dev/" },
      target
    );

    await expect(
      bridge.login({ email: "worker@secpal.dev", password: "password123" })
    ).resolves.toEqual({ user: { id: 1 } });
    await expect(
      bridge.request({ method: "GET", path: "/v1/me" })
    ).resolves.toEqual({
      status: 200,
      body: '{"ok":true}',
      contentType: "application/json",
    });
    expect(target.SecPalNativeAuthBridge).toBe(bridge);
    expect(pluginMocks.login).toHaveBeenCalledWith({
      baseUrl: "https://api.secpal.dev",
      email: "worker@secpal.dev",
      password: "password123",
    });
    expect(pluginMocks.request).toHaveBeenCalledWith({
      baseUrl: "https://api.secpal.dev",
      method: "GET",
      path: "/v1/me",
      body: undefined,
    });
  });
});
