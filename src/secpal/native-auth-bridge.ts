/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { registerPlugin } from "@capacitor/core";

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface NativeAuthBridge {
  login(credentials: AuthCredentials): Promise<unknown>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<unknown>;
}

interface SecPalNativeAuthPlugin {
  login(options: {
    baseUrl: string;
    email: string;
    password: string;
  }): Promise<unknown>;
  logout(options: { baseUrl: string }): Promise<void>;
  getCurrentUser(options: { baseUrl: string }): Promise<unknown>;
}

export interface NativeAuthBridgeOptions {
  apiBaseUrl: string;
}

const secPalNativeAuthPlugin =
  registerPlugin<SecPalNativeAuthPlugin>("SecPalNativeAuth");

function normalizeBaseUrl(apiBaseUrl: string): string {
  const normalizedBaseUrl = apiBaseUrl.trim();

  if (normalizedBaseUrl.length === 0) {
    throw new Error(
      "Native Android auth bridge requires a non-empty API base URL"
    );
  }

  return normalizedBaseUrl.endsWith("/")
    ? normalizedBaseUrl.slice(0, -1)
    : normalizedBaseUrl;
}

export function createNativeAuthBridge(
  options: NativeAuthBridgeOptions
): NativeAuthBridge {
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);

  return {
    login(credentials) {
      return secPalNativeAuthPlugin.login({
        baseUrl,
        email: credentials.email,
        password: credentials.password,
      });
    },
    logout() {
      return secPalNativeAuthPlugin.logout({ baseUrl });
    },
    getCurrentUser() {
      return secPalNativeAuthPlugin.getCurrentUser({ baseUrl });
    },
  };
}

export function installNativeAuthBridge(
  options: NativeAuthBridgeOptions,
  target: typeof globalThis = globalThis
): NativeAuthBridge {
  const bridge = createNativeAuthBridge(options);

  (
    target as typeof globalThis & {
      SecPalNativeAuthBridge?: NativeAuthBridge;
    }
  ).SecPalNativeAuthBridge = bridge;

  return bridge;
}
