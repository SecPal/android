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
  request(
    request: NativeAuthenticatedRequest
  ): Promise<NativeAuthenticatedResponse>;
}

export interface NativeAuthenticatedRequest {
  method: string;
  path: string;
  body?: string;
}

export interface NativeAuthenticatedResponse {
  status: number;
  body: string;
  contentType?: string;
}

interface SecPalNativeAuthPlugin {
  login(options: {
    baseUrl: string;
    email: string;
    password: string;
  }): Promise<unknown>;
  logout(options: { baseUrl: string }): Promise<void>;
  getCurrentUser(options: { baseUrl: string }): Promise<unknown>;
  request(options: {
    baseUrl: string;
    method: string;
    path: string;
    body?: string;
  }): Promise<NativeAuthenticatedResponse>;
}

export interface NativeAuthBridgeOptions {
  apiBaseUrl: string;
}

const secPalNativeAuthPlugin =
  registerPlugin<SecPalNativeAuthPlugin>("SecPalNativeAuth");

function normalizeBaseUrl(apiBaseUrl: string): string {
  const trimmedBaseUrl = apiBaseUrl.trim();

  if (trimmedBaseUrl.length === 0) {
    throw new Error(
      "Native Android auth bridge requires a non-empty API base URL"
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedBaseUrl);
  } catch {
    throw new Error(
      `Native Android auth bridge requires an absolute http(s) API base URL, got: ${trimmedBaseUrl}`
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `Native Android auth bridge requires an absolute http(s) API base URL, got: ${trimmedBaseUrl}`
    );
  }

  return trimmedBaseUrl.endsWith("/")
    ? trimmedBaseUrl.slice(0, -1)
    : trimmedBaseUrl;
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
    request(request) {
      return secPalNativeAuthPlugin.request({
        baseUrl,
        method: request.method,
        path: request.path,
        body: request.body,
      });
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
