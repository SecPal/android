/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { registerPlugin } from "@capacitor/core";

const NATIVE_AUTH_LOGOUT_EVENT_NAME = "secpal:native-auth-logout";
const MAX_NATIVE_AUTH_REQUEST_BODY_BASE64_CHARACTERS = 16 * 1024 * 1024;

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

export interface NativePasskeyCapabilities {
  passkeysAvailable: boolean;
  reason?: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AndroidPushRegistrationState {
  state:
    | "disabled"
    | "unconfigured"
    | "awaiting_token"
    | "awaiting_auth"
    | "registered"
    | "retry_pending"
    | "reconfiguration_required";
  configured: boolean;
  retryable: boolean;
  failureCode?: string;
}

export interface NativeAuthBridge {
  login(credentials: AuthCredentials): Promise<unknown>;
  loginWithPasskey?(): Promise<unknown>;
  getPasskeyCapabilities(): Promise<NativePasskeyCapabilities>;
  createPasskeyAttestation?(
    options: NativePasskeyRegistrationPublicKeyOptions
  ): Promise<NativePasskeyRegistrationCredential>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<unknown>;
  isNetworkAvailable(): Promise<boolean>;
  getAndroidPushRegistrationState(): Promise<AndroidPushRegistrationState>;
  retryAndroidPushRegistration(): Promise<AndroidPushRegistrationState>;
  request(
    request: NativeAuthenticatedRequest
  ): Promise<NativeAuthenticatedResponse>;
}

export interface NativeAuthenticatedRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  bodyBase64?: string;
  contentType?: string;
  accept?: string;
  signal?: AbortSignal;
}

export interface NativeAuthenticatedResponse {
  status: number;
  bodyBase64?: string;
  contentType?: string;
}

interface SecPalNativeAuthPlugin {
  login(options: { email: string; password: string }): Promise<unknown>;
  loginWithPasskey?(): Promise<unknown>;
  getPasskeyCapabilities(): Promise<NativePasskeyCapabilities>;
  createPasskeyAttestation?(options: {
    publicKey: NativePasskeyRegistrationPublicKeyOptions;
  }): Promise<{ credential: NativePasskeyRegistrationCredential }>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<unknown>;
  isNetworkAvailable(): Promise<{ available?: boolean }>;
  getAndroidPushRegistrationState(): Promise<AndroidPushRegistrationState>;
  retryAndroidPushRegistration(): Promise<AndroidPushRegistrationState>;
  request(options: {
    requestId: string;
    method: string;
    path: string;
    bodyBase64?: string;
    contentType?: string;
    accept?: string;
  }): Promise<NativeAuthenticatedResponse>;
  cancelRequest(options: {
    requestId: string;
  }): Promise<{ cancelled?: boolean }>;
}

const secPalNativeAuthPlugin =
  registerPlugin<SecPalNativeAuthPlugin>("SecPalNativeAuth");

let nativeRequestSequence = 0;

function createNativeRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  nativeRequestSequence += 1;
  return `webview-${Date.now().toString(36)}-${nativeRequestSequence.toString(36)}`;
}

function createAbortError(): DOMException {
  return new DOMException(
    "The authenticated request was aborted.",
    "AbortError"
  );
}

function createRequestTooLargeError(): Error & { code: string } {
  return Object.assign(
    new Error("The authenticated request exceeds the allowed size."),
    { code: "NATIVE_AUTH_REQUEST_TOO_LARGE" }
  );
}

export function createNativeAuthBridge(): NativeAuthBridge {
  const bridge: NativeAuthBridge = {
    login(credentials) {
      return secPalNativeAuthPlugin.login({
        email: credentials.email,
        password: credentials.password,
      });
    },
    async logout() {
      await secPalNativeAuthPlugin.logout();
      globalThis.dispatchEvent?.(new Event(NATIVE_AUTH_LOGOUT_EVENT_NAME));
    },
    getCurrentUser() {
      return secPalNativeAuthPlugin.getCurrentUser();
    },
    async isNetworkAvailable() {
      const result = await secPalNativeAuthPlugin.isNetworkAvailable();

      return result.available === true;
    },
    getAndroidPushRegistrationState() {
      return secPalNativeAuthPlugin.getAndroidPushRegistrationState();
    },
    retryAndroidPushRegistration() {
      return secPalNativeAuthPlugin.retryAndroidPushRegistration();
    },
    getPasskeyCapabilities() {
      return secPalNativeAuthPlugin.getPasskeyCapabilities();
    },
    async request(request) {
      const requestId = createNativeRequestId();
      const signal = request.signal;
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (
        typeof request.bodyBase64 === "string" &&
        request.bodyBase64.length >
          MAX_NATIVE_AUTH_REQUEST_BODY_BASE64_CHARACTERS
      ) {
        throw createRequestTooLargeError();
      }

      const cancel = () => {
        void secPalNativeAuthPlugin.cancelRequest({ requestId }).catch(() => {
          // The request may already have reached its one terminal callback.
        });
      };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const response = await secPalNativeAuthPlugin.request({
          requestId,
          method: request.method,
          path: request.path,
          bodyBase64: request.bodyBase64,
          contentType: request.contentType,
          accept: request.accept,
        });
        if (signal?.aborted) {
          throw createAbortError();
        }
        return response;
      } catch (error) {
        if (signal?.aborted) {
          throw createAbortError();
        }
        throw error;
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    },
  };

  if (typeof secPalNativeAuthPlugin.loginWithPasskey === "function") {
    const loginWithPasskey = secPalNativeAuthPlugin.loginWithPasskey;

    bridge.loginWithPasskey = () => loginWithPasskey();
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
