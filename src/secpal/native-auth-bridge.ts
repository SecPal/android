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
  loginWithPasskey?(options?: { email?: string }): Promise<unknown>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<unknown>;
  isNetworkAvailable(): Promise<boolean>;
  request(
    request: NativeAuthenticatedRequest
  ): Promise<NativeAuthenticatedResponse>;
}

export interface NativeAuthenticatedRequest {
  method: string;
  path: string;
  bodyBase64?: string;
  contentType?: string;
  accept?: string;
}

export interface NativeAuthenticatedResponse {
  status: number;
  bodyBase64?: string;
  contentType?: string;
}

interface SecPalNativeAuthPlugin {
  login(options: { email: string; password: string }): Promise<unknown>;
  loginWithPasskey?(options?: { email?: string }): Promise<unknown>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<unknown>;
  isNetworkAvailable(): Promise<{ available?: boolean }>;
  request(options: {
    method: string;
    path: string;
    bodyBase64?: string;
    contentType?: string;
    accept?: string;
  }): Promise<NativeAuthenticatedResponse>;
}

const secPalNativeAuthPlugin =
  registerPlugin<SecPalNativeAuthPlugin>("SecPalNativeAuth");
export function createNativeAuthBridge(): NativeAuthBridge {
  const bridge: NativeAuthBridge = {
    login(credentials) {
      return secPalNativeAuthPlugin.login({
        email: credentials.email,
        password: credentials.password,
      });
    },
    logout() {
      return secPalNativeAuthPlugin.logout();
    },
    getCurrentUser() {
      return secPalNativeAuthPlugin.getCurrentUser();
    },
    async isNetworkAvailable() {
      const result = await secPalNativeAuthPlugin.isNetworkAvailable();

      return result.available === true;
    },
    request(request) {
      return secPalNativeAuthPlugin.request({
        method: request.method,
        path: request.path,
        bodyBase64: request.bodyBase64,
        contentType: request.contentType,
        accept: request.accept,
      });
    },
  };

  if (typeof secPalNativeAuthPlugin.loginWithPasskey === "function") {
    const loginWithPasskey = secPalNativeAuthPlugin.loginWithPasskey;

    bridge.loginWithPasskey = (options) => loginWithPasskey(options ?? {});
  }

  return bridge;
}

export function installNativeAuthBridge(
  target: typeof globalThis = globalThis
): NativeAuthBridge {
  const bridge = createNativeAuthBridge();

  (
    target as typeof globalThis & {
      SecPalNativeAuthBridge?: NativeAuthBridge;
    }
  ).SecPalNativeAuthBridge = bridge;

  return bridge;
}
