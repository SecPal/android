/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginMocks = vi.hoisted(() => ({
  getManagedState: vi.fn(),
  launchPhone: vi.fn(),
  launchSms: vi.fn(),
  launchAllowedApp: vi.fn(),
  openGestureNavigationSettings: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: vi.fn(() => pluginMocks),
}));

describe("native enterprise bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs a typed enterprise bridge with managed distribution metadata", async () => {
    pluginMocks.getManagedState.mockResolvedValue({
      managed: true,
      mode: "device_owner",
      kioskActive: true,
      lockTaskEnabled: true,
      gestureNavigationEnabled: false,
      gestureNavigationSettingsAvailable: true,
      allowPhone: true,
      allowSms: false,
      distributionState: {
        bootstrapStatus: "completed",
        updateChannel: "managed_device",
        releaseMetadataUrl:
          "https://apk.secpal.app/android/channels/managed_device/latest.json",
        bootstrapLastErrorCode: null,
      },
      allowedApps: [{ packageName: "com.android.settings", label: "Settings" }],
    });
    pluginMocks.launchPhone.mockResolvedValue(undefined);
    pluginMocks.launchSms.mockResolvedValue(undefined);
    pluginMocks.launchAllowedApp.mockResolvedValue(undefined);
    pluginMocks.openGestureNavigationSettings.mockResolvedValue({
      opened: true,
      gestureNavigationEnabled: false,
      willReenterLockTaskOnResume: true,
    });

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const target = {} as typeof globalThis & {
      SecPalEnterpriseBridge?: unknown;
    };
    const bridge = installNativeEnterpriseBridge(target);

    await expect(bridge.getManagedState()).resolves.toEqual({
      managed: true,
      mode: "device_owner",
      kioskActive: true,
      lockTaskEnabled: true,
      gestureNavigationEnabled: false,
      gestureNavigationSettingsAvailable: true,
      allowPhone: true,
      allowSms: false,
      distributionState: {
        bootstrapStatus: "completed",
        updateChannel: "managed_device",
        releaseMetadataUrl:
          "https://apk.secpal.app/android/channels/managed_device/latest.json",
        bootstrapLastErrorCode: null,
      },
      allowedApps: [{ packageName: "com.android.settings", label: "Settings" }],
    });
    await expect(bridge.launchPhone()).resolves.toBeUndefined();
    await expect(bridge.launchSms()).resolves.toBeUndefined();
    await expect(
      bridge.launchAllowedApp({ packageName: "com.android.settings" })
    ).resolves.toBeUndefined();
    await expect(bridge.openGestureNavigationSettings()).resolves.toEqual({
      opened: true,
      gestureNavigationEnabled: false,
      willReenterLockTaskOnResume: true,
    });

    expect(target.SecPalEnterpriseBridge).toBe(bridge);
    expect(pluginMocks.getManagedState).toHaveBeenCalledOnce();
    expect(pluginMocks.launchPhone).toHaveBeenCalledWith();
    expect(pluginMocks.launchSms).toHaveBeenCalledWith();
    expect(pluginMocks.launchAllowedApp).toHaveBeenCalledWith({
      packageName: "com.android.settings",
    });
    expect(pluginMocks.openGestureNavigationSettings).toHaveBeenCalledOnce();
  });

  it("returns a failed gesture navigation settings result when settings cannot be opened", async () => {
    pluginMocks.openGestureNavigationSettings.mockResolvedValue({
      opened: false,
      gestureNavigationEnabled: false,
      willReenterLockTaskOnResume: false,
    });

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const target = {} as typeof globalThis & {
      SecPalEnterpriseBridge?: unknown;
    };
    const bridge = installNativeEnterpriseBridge(target);

    await expect(bridge.openGestureNavigationSettings()).resolves.toEqual({
      opened: false,
      gestureNavigationEnabled: false,
      willReenterLockTaskOnResume: false,
    });

    expect(pluginMocks.openGestureNavigationSettings).toHaveBeenCalledOnce();
  });

  it("forwards hardware button listener registrations to the native enterprise plugin", async () => {
    const handle = { remove: vi.fn() };

    pluginMocks.addListener.mockReturnValue(handle);

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const bridge = installNativeEnterpriseBridge();

    const registrations = [
      ["hardwareButtonPressed", vi.fn(), bridge.addHardwareButtonListener],
      [
        "hardwareButtonShortPressed",
        vi.fn(),
        bridge.addHardwareButtonShortPressListener,
      ],
      [
        "hardwareButtonLongPressed",
        vi.fn(),
        bridge.addHardwareButtonLongPressListener,
      ],
    ] as const;

    for (const [eventName, listener, register] of registrations) {
      const registration = register(listener);
      expect(registration).toBe(handle);
      expect(pluginMocks.addListener).toHaveBeenCalledWith(eventName, listener);

      const nativeCallback = pluginMocks.addListener.mock.lastCall?.[1];
      const event = { source: "native", eventName };
      expect(nativeCallback).toBeTypeOf("function");
      (nativeCallback as (value: typeof event) => void)(event);
      expect(listener).toHaveBeenCalledWith(event);

      registration.remove();
      expect(handle.remove).toHaveBeenCalledTimes(1);
      handle.remove.mockClear();
    }
  });

  it("delegates launchPhone and launchSms to the native plugin", async () => {
    pluginMocks.launchPhone.mockResolvedValue(undefined);
    pluginMocks.launchSms.mockResolvedValue(undefined);

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const bridge = installNativeEnterpriseBridge(globalThis);

    await expect(bridge.launchPhone()).resolves.toBeUndefined();
    await expect(bridge.launchSms()).resolves.toBeUndefined();

    expect(pluginMocks.launchPhone).toHaveBeenCalledWith();
    expect(pluginMocks.launchSms).toHaveBeenCalledWith();
  });

  it("propagates plugin errors for rejected calls", async () => {
    const managedStateError = new Error("managed state unavailable");
    const launchAllowedAppError = new Error("app launch blocked");
    pluginMocks.getManagedState.mockRejectedValue(managedStateError);
    pluginMocks.launchAllowedApp.mockRejectedValue(launchAllowedAppError);

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const bridge = installNativeEnterpriseBridge(globalThis);

    await expect(bridge.getManagedState()).rejects.toThrow(
      "managed state unavailable"
    );
    await expect(
      bridge.launchAllowedApp({ packageName: "com.android.settings" })
    ).rejects.toThrow("app launch blocked");
  });

  it("returns alternate managed state values unchanged", async () => {
    pluginMocks.getManagedState.mockResolvedValue({
      managed: false,
      mode: "none",
      kioskActive: false,
      lockTaskEnabled: false,
      gestureNavigationEnabled: true,
      gestureNavigationSettingsAvailable: false,
      allowPhone: false,
      allowSms: true,
      distributionState: {
        bootstrapStatus: "idle",
        updateChannel: null,
        releaseMetadataUrl: null,
        bootstrapLastErrorCode: "NETWORK_ERROR",
      },
      allowedApps: [],
    });

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const bridge = installNativeEnterpriseBridge(globalThis);

    await expect(bridge.getManagedState()).resolves.toEqual({
      managed: false,
      mode: "none",
      kioskActive: false,
      lockTaskEnabled: false,
      gestureNavigationEnabled: true,
      gestureNavigationSettingsAvailable: false,
      allowPhone: false,
      allowSms: true,
      distributionState: {
        bootstrapStatus: "idle",
        updateChannel: null,
        releaseMetadataUrl: null,
        bootstrapLastErrorCode: "NETWORK_ERROR",
      },
      allowedApps: [],
    });
  });
});
