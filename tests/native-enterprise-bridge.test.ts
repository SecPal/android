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
    expect(pluginMocks.launchAllowedApp).toHaveBeenCalledWith({
      packageName: "com.android.settings",
    });
    expect(pluginMocks.openGestureNavigationSettings).toHaveBeenCalledOnce();
  });

  it("delegates phone and sms launches to the native enterprise plugin", async () => {
    pluginMocks.launchPhone.mockResolvedValue(undefined);
    pluginMocks.launchSms.mockResolvedValue(undefined);

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const bridge = installNativeEnterpriseBridge();

    await expect(bridge.launchPhone()).resolves.toBeUndefined();
    await expect(bridge.launchSms()).resolves.toBeUndefined();

    expect(pluginMocks.launchPhone).toHaveBeenCalledOnce();
    expect(pluginMocks.launchSms).toHaveBeenCalledOnce();
  });

  it("passes through alternate managed-state payloads without reshaping them", async () => {
    const managedState = {
      managed: false,
      mode: "none" as const,
      kioskActive: false,
      lockTaskEnabled: false,
      gestureNavigationEnabled: true,
      gestureNavigationSettingsAvailable: false,
      allowPhone: false,
      allowSms: true,
      distributionState: {
        bootstrapStatus: "failed" as const,
        updateChannel: null,
        releaseMetadataUrl: null,
        bootstrapLastErrorCode: "BOOTSTRAP_EXCHANGE_RETRY",
      },
      allowedApps: [{ packageName: "com.android.contacts", label: "Contacts" }],
    };
    pluginMocks.getManagedState.mockResolvedValue(managedState);

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const bridge = installNativeEnterpriseBridge();

    await expect(bridge.getManagedState()).resolves.toEqual(managedState);
    expect(pluginMocks.getManagedState).toHaveBeenCalledOnce();
  });

  it("propagates native plugin rejections for telephony and gesture-navigation actions", async () => {
    const phoneError = new Error("phone unavailable");
    const smsError = new Error("sms unavailable");
    const settingsError = new Error("settings unavailable");
    pluginMocks.launchPhone.mockRejectedValue(phoneError);
    pluginMocks.launchSms.mockRejectedValue(smsError);
    pluginMocks.openGestureNavigationSettings.mockRejectedValue(settingsError);

    const { installNativeEnterpriseBridge } =
      await import("../src/secpal/native-enterprise-bridge");
    const bridge = installNativeEnterpriseBridge();

    await expect(bridge.launchPhone()).rejects.toThrow(phoneError);
    await expect(bridge.launchSms()).rejects.toThrow(smsError);
    await expect(bridge.openGestureNavigationSettings()).rejects.toThrow(
      settingsError
    );
  });
});
