/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, type Mock } from "vitest";
import config from "../capacitor.config";

const pluginMocks = vi.hoisted(
  () =>
    ({
      login: vi.fn(),
      loginWithPasskey: undefined,
      createPasskeyAttestation: undefined,
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn(),
      request: vi.fn(),
      isVaultDeviceBoundWrapperAvailable: undefined,
      wrapVaultRootKey: undefined,
      unwrapVaultRootKey: undefined,
    }) as {
      login: Mock;
      loginWithPasskey: Mock | undefined;
      createPasskeyAttestation: Mock | undefined;
      logout: Mock;
      getCurrentUser: Mock;
      isNetworkAvailable: Mock;
      request: Mock;
      isVaultDeviceBoundWrapperAvailable: Mock | undefined;
      wrapVaultRootKey: Mock | undefined;
      unwrapVaultRootKey: Mock | undefined;
    }
);

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
    expect(config.appId).toBe("app.secpal");
    expect(config.appName).toBe("SecPal");
    expect(config.cordova?.accessOrigins).toEqual([
      "https://api.secpal.dev",
      "https://app.secpal.dev",
    ]);
    expect(config.server?.hostname).toBe("app.secpal.dev");
    expect(config.server?.androidScheme).toBe("https");
  });

  it("installs a native auth bridge without exposing the API origin to plugin calls", async () => {
    pluginMocks.login.mockResolvedValue({ user: { id: 1 } });
    pluginMocks.request.mockResolvedValue({
      status: 200,
      bodyBase64: "eyJvayI6dHJ1ZX0=",
      contentType: "application/json",
    });

    const { installNativeAuthBridge } =
      await import("../src/secpal/native-auth-bridge");
    const target = {} as typeof globalThis & {
      SecPalNativeAuthBridge?: unknown;
    };
    const bridge = installNativeAuthBridge(target);

    await expect(
      bridge.login({ email: "worker@secpal.dev", password: "password123" })
    ).resolves.toEqual({ user: { id: 1 } });
    pluginMocks.isNetworkAvailable.mockResolvedValue({ available: false });
    await expect(bridge.isNetworkAvailable()).resolves.toBe(false);
    await expect(
      bridge.request({ method: "GET", path: "/v1/me" })
    ).resolves.toEqual({
      status: 200,
      bodyBase64: "eyJvayI6dHJ1ZX0=",
      contentType: "application/json",
    });
    expect(target.SecPalNativeAuthBridge).toBe(bridge);
    expect(pluginMocks.login).toHaveBeenCalledWith({
      email: "worker@secpal.dev",
      password: "password123",
    });
    expect(pluginMocks.isNetworkAvailable).toHaveBeenCalledTimes(1);
    expect(pluginMocks.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/me",
      bodyBase64: undefined,
      contentType: undefined,
      accept: undefined,
    });
  });

  it("exposes the optional vault wrapper bridge methods when the native plugin supports them", async () => {
    pluginMocks.isVaultDeviceBoundWrapperAvailable = vi
      .fn()
      .mockResolvedValue({ available: true });
    pluginMocks.wrapVaultRootKey = vi.fn().mockResolvedValue({
      wrappedRootKey: "wrapped-root-key",
    });
    pluginMocks.unwrapVaultRootKey = vi.fn().mockResolvedValue({
      rootKeyBase64: "cm9vdC1rZXk=",
    });

    const { createNativeAuthBridge } =
      await import("../src/secpal/native-auth-bridge");
    const bridge = createNativeAuthBridge();

    await expect(
      bridge.isVaultDeviceBoundWrapperAvailable?.()
    ).resolves.toBe(true);
    await expect(
      bridge.wrapVaultRootKey?.({
        rootKeyBase64: "cm9vdC1rZXk=",
        subjectHash: "subject-hash",
      })
    ).resolves.toEqual({
      wrappedRootKey: "wrapped-root-key",
    });
    await expect(
      bridge.unwrapVaultRootKey?.({
        wrappedRootKey: "wrapped-root-key",
        subjectHash: "subject-hash",
      })
    ).resolves.toEqual({
      rootKeyBase64: "cm9vdC1rZXk=",
    });

    expect(pluginMocks.isVaultDeviceBoundWrapperAvailable).toHaveBeenCalledOnce();
    expect(pluginMocks.wrapVaultRootKey).toHaveBeenCalledWith({
      rootKeyBase64: "cm9vdC1rZXk=",
      subjectHash: "subject-hash",
    });
    expect(pluginMocks.unwrapVaultRootKey).toHaveBeenCalledWith({
      wrappedRootKey: "wrapped-root-key",
      subjectHash: "subject-hash",
      metadata: undefined,
    });
  });

  it("keeps the optional vault wrapper bridge methods undefined when the native plugin does not support them", async () => {
    pluginMocks.isVaultDeviceBoundWrapperAvailable = undefined;
    pluginMocks.wrapVaultRootKey = undefined;
    pluginMocks.unwrapVaultRootKey = undefined;

    const { createNativeAuthBridge } =
      await import("../src/secpal/native-auth-bridge");
    const bridge = createNativeAuthBridge();

    expect(bridge.isVaultDeviceBoundWrapperAvailable).toBeUndefined();
    expect(bridge.wrapVaultRootKey).toBeUndefined();
    expect(bridge.unwrapVaultRootKey).toBeUndefined();
  });
});
