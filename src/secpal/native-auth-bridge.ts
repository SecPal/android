/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { registerPlugin } from "@capacitor/core";

export interface NativePasskeyCredentialParameter {
  type: "public-key";
  alg: number;
}

export interface NativePasskeyCredentialDescriptor {
  type: "public-key";
  id: string;
  transports?: string[];
}

export interface NativePasskeyRegistrationPublicKeyOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; display_name: string };
  pub_key_cred_params: NativePasskeyCredentialParameter[];
  timeout?: number;
  exclude_credentials?: NativePasskeyCredentialDescriptor[];
  authenticator_selection?: {
    authenticator_attachment?: "cross-platform" | "platform";
    resident_key?: "discouraged" | "preferred" | "required";
    require_resident_key?: boolean;
    user_verification?: "discouraged" | "preferred" | "required";
  };
  attestation?: "direct" | "enterprise" | "indirect" | "none" | string;
}

export interface NativePasskeyRegistrationCredential {
  id: string;
  raw_id: string;
  type: "public-key";
  response: {
    client_data_json: string;
    attestation_object: string;
    transports?: string[];
  };
  client_extension_results?: Record<string, unknown>;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface NativeAuthBridge {
  login(credentials: AuthCredentials): Promise<unknown>;
  loginWithPasskey?(options?: { email?: string }): Promise<unknown>;
  createPasskeyAttestation?(
    options: NativePasskeyRegistrationPublicKeyOptions
  ): Promise<NativePasskeyRegistrationCredential>;
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
  createPasskeyAttestation?(options: {
    publicKey: NativePasskeyRegistrationPublicKeyOptions;
  }): Promise<{ credential: NativePasskeyRegistrationCredential }>;
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

  if (typeof secPalNativeAuthPlugin.createPasskeyAttestation === "function") {
    const createPasskeyAttestation =
      secPalNativeAuthPlugin.createPasskeyAttestation;

    bridge.createPasskeyAttestation = async (options) => {
      const result = await createPasskeyAttestation({ publicKey: options });

      return result.credential;
    };
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
