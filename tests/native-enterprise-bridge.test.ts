/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";

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
});
