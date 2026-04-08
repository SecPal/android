/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { registerPlugin } from "@capacitor/core";

export type EnterpriseBootstrapStatus = "pending" | "completed" | "failed";

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

export interface EnterpriseManagedState {
  managed: boolean;
  mode: string;
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

export interface NativeEnterpriseBridge {
  getManagedState(): Promise<EnterpriseManagedState>;
  launchPhone(): Promise<void>;
  launchSms(): Promise<void>;
  launchAllowedApp(options: LaunchAllowedAppOptions): Promise<void>;
  openGestureNavigationSettings(): Promise<OpenGestureNavigationSettingsResult>;
}

const secPalEnterprisePlugin =
  registerPlugin<NativeEnterpriseBridge>("SecPalEnterprise");

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
