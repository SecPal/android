/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
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
      getPasskeyCapabilities: undefined,
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
      getPasskeyCapabilities: Mock | undefined;
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

  it("reports no Android push registration error on the direct native auth bridge wrapper", async () => {
    const { createNativeAuthBridge } =
      await import("../src/secpal/native-auth-bridge");
    const bridge = createNativeAuthBridge();

    await expect(bridge.getAndroidPushRegistrationState()).resolves.toEqual({
      disabledError: null,
    });
  });

  it("maps native passkey capabilities onto the typed bridge", async () => {
    pluginMocks.getPasskeyCapabilities = vi.fn().mockResolvedValue({
      passkeysAvailable: false,
      reason: "PASSKEY_ANDROID_VERSION_UNSUPPORTED",
    });

    const { createNativeAuthBridge } =
      await import("../src/secpal/native-auth-bridge");
    const bridge = createNativeAuthBridge();

    await expect(bridge.getPasskeyCapabilities()).resolves.toEqual({
      passkeysAvailable: false,
      reason: "PASSKEY_ANDROID_VERSION_UNSUPPORTED",
    });
    expect(pluginMocks.getPasskeyCapabilities).toHaveBeenCalledWith();
  });

  it("keeps the optional vault wrapper bridge methods undefined even when the native plugin supports them", async () => {
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

    expect("isVaultDeviceBoundWrapperAvailable" in bridge).toBe(false);
    expect("wrapVaultRootKey" in bridge).toBe(false);
    expect("unwrapVaultRootKey" in bridge).toBe(false);

    expect(
      pluginMocks.isVaultDeviceBoundWrapperAvailable
    ).not.toHaveBeenCalled();
    expect(pluginMocks.wrapVaultRootKey).not.toHaveBeenCalled();
    expect(pluginMocks.unwrapVaultRootKey).not.toHaveBeenCalled();
  });

  it("keeps the optional vault wrapper bridge methods undefined when the native plugin does not support them", async () => {
    pluginMocks.isVaultDeviceBoundWrapperAvailable = undefined;
    pluginMocks.wrapVaultRootKey = undefined;
    pluginMocks.unwrapVaultRootKey = undefined;

    const { createNativeAuthBridge } =
      await import("../src/secpal/native-auth-bridge");
    const bridge = createNativeAuthBridge();

    expect("isVaultDeviceBoundWrapperAvailable" in bridge).toBe(false);
    expect("wrapVaultRootKey" in bridge).toBe(false);
    expect("unwrapVaultRootKey" in bridge).toBe(false);
  });

  it("dispatches the native logout event after a successful typed bridge logout", async () => {
    pluginMocks.logout.mockResolvedValue(undefined);
    const dispatched: Event[] = [];
    const originalDispatch = globalThis.dispatchEvent;
    try {
      globalThis.dispatchEvent = (event: Event) => {
        dispatched.push(event);
        return true;
      };

      const { createNativeAuthBridge } =
        await import("../src/secpal/native-auth-bridge");
      const bridge = createNativeAuthBridge();

      await bridge.logout();

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]?.type).toBe("secpal:native-auth-logout");
    } finally {
      globalThis.dispatchEvent = originalDispatch;
    }
  });

  it("does not dispatch the native logout event when the typed bridge plugin logout throws", async () => {
    pluginMocks.logout.mockRejectedValueOnce(
      Object.assign(new Error("native logout failed"), { code: "HTTP_500" })
    );
    const dispatched: Event[] = [];
    const originalDispatch = globalThis.dispatchEvent;
    try {
      globalThis.dispatchEvent = (event: Event) => {
        dispatched.push(event);
        return true;
      };

      const { createNativeAuthBridge } =
        await import("../src/secpal/native-auth-bridge");
      const bridge = createNativeAuthBridge();

      await expect(bridge.logout()).rejects.toThrow("native logout failed");

      expect(dispatched).toHaveLength(0);
    } finally {
      globalThis.dispatchEvent = originalDispatch;
    }
  });
});
