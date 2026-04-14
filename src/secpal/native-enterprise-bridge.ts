/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type EnterpriseBootstrapStatus =
  | "none"
  | "pending"
  | "completed"
  | "failed";

export interface EnterpriseDistributionState {
  bootstrapStatus: EnterpriseBootstrapStatus;
  updateChannel: string | null;
  releaseMetadataUrl: string | null;
  bootstrapLastErrorCode: string | null;
}

export interface EnterpriseAllowedApp {
  packageName: string;
  label: string;
}

export type EnterpriseManagedMode = "none" | "profile_owner" | "device_owner";

export interface EnterpriseManagedState {
  managed: boolean;
  mode: EnterpriseManagedMode;
  kioskActive: boolean;
  lockTaskEnabled: boolean;
  gestureNavigationEnabled: boolean;
  gestureNavigationSettingsAvailable: boolean;
  allowPhone: boolean;
  allowSms: boolean;
  distributionState: EnterpriseDistributionState;
  allowedApps: EnterpriseAllowedApp[];
}

export interface OpenGestureNavigationSettingsResult {
  opened: boolean;
  gestureNavigationEnabled: boolean;
  willReenterLockTaskOnResume: boolean;
}

export interface LaunchAllowedAppOptions {
  packageName: string;
}

export interface HardwareButtonPressedEvent {
  action: "down";
  origin: "activity_dispatch";
  keyCode: number;
  keyName: string;
  scanCode: number;
  repeatCount: number;
  deviceId: number;
  source: number;
}

export interface HardwareButtonShortPressedEvent {
  action: "short_press";
  origin: "activity_dispatch";
  keyCode: number;
  keyName: string;
  scanCode: number;
  repeatCount: number;
  holdDurationMs: number;
  deviceId: number;
  source: number;
}

export interface HardwareButtonLongPressedEvent {
  action: "long_press";
  origin: "activity_dispatch";
  keyCode: number;
  keyName: string;
  scanCode: number;
  repeatCount: number;
  holdDurationMs: number;
  deviceId: number;
  source: number;
}

export interface NativeEnterpriseBridge {
  getManagedState(): Promise<EnterpriseManagedState>;
  launchPhone(): Promise<void>;
  launchSms(): Promise<void>;
  launchAllowedApp(options: LaunchAllowedAppOptions): Promise<void>;
  openGestureNavigationSettings(): Promise<OpenGestureNavigationSettingsResult>;
  addHardwareButtonListener(
    listener: (event: HardwareButtonPressedEvent) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addHardwareButtonShortPressListener(
    listener: (event: HardwareButtonShortPressedEvent) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addHardwareButtonLongPressListener(
    listener: (event: HardwareButtonLongPressedEvent) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

interface SecPalEnterprisePlugin {
  getManagedState(): Promise<EnterpriseManagedState>;
  launchPhone(): Promise<void>;
  launchSms(): Promise<void>;
  launchAllowedApp(options: LaunchAllowedAppOptions): Promise<void>;
  openGestureNavigationSettings(): Promise<OpenGestureNavigationSettingsResult>;
  addListener(
    eventName: "hardwareButtonPressed",
    listener: (event: HardwareButtonPressedEvent) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: "hardwareButtonShortPressed",
    listener: (event: HardwareButtonShortPressedEvent) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: "hardwareButtonLongPressed",
    listener: (event: HardwareButtonLongPressedEvent) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

const secPalEnterprisePlugin = registerPlugin<SecPalEnterprisePlugin>(
  "SecPalEnterprise"
);

export function createNativeEnterpriseBridge(): NativeEnterpriseBridge {
  return {
    getManagedState() {
      return secPalEnterprisePlugin.getManagedState();
    },
    launchPhone() {
      return secPalEnterprisePlugin.launchPhone();
    },
    launchSms() {
      return secPalEnterprisePlugin.launchSms();
    },
    launchAllowedApp(options) {
      return secPalEnterprisePlugin.launchAllowedApp(options);
    },
    openGestureNavigationSettings() {
      return secPalEnterprisePlugin.openGestureNavigationSettings();
    },
    addHardwareButtonListener(listener) {
      return secPalEnterprisePlugin.addListener(
        "hardwareButtonPressed",
        listener
      );
    },
    addHardwareButtonShortPressListener(listener) {
      return secPalEnterprisePlugin.addListener(
        "hardwareButtonShortPressed",
        listener
      );
    },
    addHardwareButtonLongPressListener(listener) {
      return secPalEnterprisePlugin.addListener(
        "hardwareButtonLongPressed",
        listener
      );
    },
  };
}

export function installNativeEnterpriseBridge(
  target: typeof globalThis = globalThis
): NativeEnterpriseBridge {
  const bridge = createNativeEnterpriseBridge();

  (
    target as typeof globalThis & {
      SecPalEnterpriseBridge?: NativeEnterpriseBridge;
    }
  ).SecPalEnterpriseBridge = bridge;

  return bridge;
}
