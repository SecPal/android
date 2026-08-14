/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

/// <reference types="node" />
/// <reference lib="dom" />

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const CANONICAL_API_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function expectCanonicalApiTimestamp(
  value: string | null
): asserts value is string {
  expect(value).not.toBeNull();
  expect(value).toMatch(CANONICAL_API_TIMESTAMP_PATTERN);
}

class MockElement {
  id = "";
  className = "";
  textContent = "";
  value = "";
  disabled = false;
  parentElement: MockElement | null = null;
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: MockElement[] = [];
  listeners = new Map<
    string,
    Array<(event: { preventDefault(): void }) => void>
  >();
  ownerDocument: MockDocument | null = null;

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  appendChild(child: MockElement) {
    child.ownerDocument = this.ownerDocument;
    child.parentElement = this;
    this.children.push(child);
    this.ownerDocument?.register(child);
    return child;
  }

  insertBefore(child: MockElement, referenceChild: MockElement | null) {
    if (referenceChild == null) {
      return this.appendChild(child);
    }

    const referenceIndex = this.children.indexOf(referenceChild);

    if (referenceIndex === -1) {
      return this.appendChild(child);
    }

    child.ownerDocument = this.ownerDocument;
    child.parentElement = this;
    this.children.splice(referenceIndex, 0, child);
    this.ownerDocument?.register(child);
    return child;
  }

  addEventListener(
    eventName: string,
    listener: (event: { preventDefault(): void }) => void
  ) {
    const listeners = this.listeners.get(eventName) ?? [];

    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  dispatch(eventName: string) {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener({
        preventDefault() {
          // no-op
        },
      });
    }
  }

  click() {
    if (this.disabled) {
      return;
    }

    this.dispatch("click");
  }

  change() {
    if (this.disabled) {
      return;
    }

    this.dispatch("change");
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(
        (child) => child !== this
      );
      this.parentElement = null;
    }

    this.ownerDocument?.unregister(this.id);
  }
}

class MockDocument {
  readonly body = new MockElement("body");
  readonly head = new MockElement("head");
  readyState = "complete";
  readonly documentElement = { lang: "en" };
  private readonly elementsById = new Map<string, MockElement>();

  constructor() {
    this.body.ownerDocument = this;
    this.head.ownerDocument = this;
  }

  createElement(tagName: string) {
    const element = new MockElement(tagName);

    element.ownerDocument = this;
    return element;
  }

  createElementNS(_namespace: string, tagName: string) {
    return this.createElement(tagName);
  }

  getElementById(id: string) {
    return this.elementsById.get(id) ?? null;
  }

  addEventListener() {
    // no-op for this test harness
  }

  register(element: MockElement) {
    if (element.id) {
      this.elementsById.set(element.id, element);
    }
  }

  unregister(id: string) {
    if (id) {
      this.elementsById.delete(id);
    }
  }
}

function appendMockLoginFooter(document: MockDocument) {
  const layout = document.createElement("div");
  const form = document.createElement("form");
  const submitButton = document.createElement("button");
  const passkeyButton = document.createElement("button");
  const footerWrapper = document.createElement("div");
  const footer = document.createElement("footer");
  const container = document.createElement("div");
  const sloganRow = document.createElement("div");
  const sloganLink = document.createElement("a");
  const metaRow = document.createElement("div");

  submitButton.setAttribute("type", "submit");
  submitButton.textContent = "Einloggen";
  passkeyButton.setAttribute("type", "button");
  passkeyButton.textContent = "Mit Passkey anmelden";

  sloganLink.setAttribute("href", "https://secpal.app");
  sloganLink.textContent = "Powered by SecPal – A guard's best friend";

  form.appendChild(submitButton);
  form.appendChild(passkeyButton);
  sloganRow.appendChild(sloganLink);
  container.appendChild(sloganRow);
  container.appendChild(metaRow);
  footer.appendChild(container);
  layout.appendChild(form);
  footerWrapper.appendChild(footer);
  layout.appendChild(footerWrapper);
  document.body.appendChild(layout);

  return {
    layout,
    form,
    submitButton,
    passkeyButton,
    footerWrapper,
    footer,
    container,
    sloganRow,
    sloganLink,
    metaRow,
  };
}

async function loadInjectorModule({
  attributionTermsUrl,
}: {
  attributionTermsUrl?: string;
} = {}): Promise<{
  buildNativeAuthBridgeAssetName: (bootstrapScript: string) => string;
  buildNativeAuthBridgeBootstrapScript: (apiBaseUrl: string) => string;
  injectNativeAuthBridgeBootstrap: (html: string, apiBaseUrl: string) => string;
  readApiBaseUrlFromStringsXml: (stringsXml: string) => string;
}> {
  const previousAttributionTermsUrl = process.env.SECPAL_ATTRIBUTION_TERMS_URL;

  if (attributionTermsUrl === undefined) {
    delete process.env.SECPAL_ATTRIBUTION_TERMS_URL;
  } else {
    process.env.SECPAL_ATTRIBUTION_TERMS_URL = attributionTermsUrl;
  }

  const moduleUrl = new URL(
    `../scripts/inject-native-auth-bridge.mjs?test=${Math.random().toString(16).slice(2)}`,
    import.meta.url
  );

  try {
    return await import(moduleUrl.href);
  } finally {
    if (previousAttributionTermsUrl === undefined) {
      delete process.env.SECPAL_ATTRIBUTION_TERMS_URL;
    } else {
      process.env.SECPAL_ATTRIBUTION_TERMS_URL = previousAttributionTermsUrl;
    }
  }
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function createMockStorage(initialValues?: Record<string, string>) {
  const values = new Map<string, string>(
    initialValues ? Object.entries(initialValues) : []
  );

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

const runtimeBootstrapPlaceholderOrigin =
  "https://runtime-bootstrap-required.secpal.dev";
const runtimeBootstrapStorageKey = "runtimeBootstrapState";
const runtimeResetPendingStorageKey = "secpal-android-runtime-reset-pending";

function buildRuntimeBootstrapValue(
  overrides: Partial<{
    instanceDisplayName: string;
    apiOrigin: string;
    rawApiBaseUrl: string;
    androidPush: {
      provider: string;
      metadataRevision: number;
      publicClientMetadata: {
        apiKey: string;
        projectId: string;
        applicationId: string;
        senderId: string;
      };
    } | null;
    features: {
      passwordLoginEnabled: boolean;
      passkeyLoginEnabled: boolean;
    };
  }> = {}
) {
  return {
    instanceDisplayName: "Configured Example",
    apiOrigin: "https://api.secpal.dev",
    rawApiBaseUrl: "https://api.secpal.dev/v1",
    androidPush: null,
    features: {
      passwordLoginEnabled: true,
      passkeyLoginEnabled: true,
    },
    ...overrides,
  };
}

function buildStoredRuntimeBootstrap(
  overrides: Parameters<typeof buildRuntimeBootstrapValue>[0] = {}
) {
  return JSON.stringify(buildRuntimeBootstrapValue(overrides));
}

async function flushMicrotasks(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("native auth bridge bootstrap injection", () => {
  it("reads the configured API base URL from Android strings.xml", () => {
    const injectorModulePromise = loadInjectorModule();
    const stringsXml = readFileSync(
      "android/app/src/main/res/values/strings.xml",
      "utf8"
    );

    return expect(
      injectorModulePromise.then(({ readApiBaseUrlFromStringsXml }) =>
        readApiBaseUrlFromStringsXml(stringsXml)
      )
    ).resolves.toBe(runtimeBootstrapPlaceholderOrigin);
  });

  it("injects one empty content-hashed bridge element before the first module script and stays idempotent", async () => {
    const {
      buildNativeAuthBridgeAssetName,
      buildNativeAuthBridgeBootstrapScript,
      injectNativeAuthBridgeBootstrap,
    } = await loadInjectorModule();
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<script type="module" src="/assets/index.js"></script>',
      "</head>",
      "<body></body>",
      "</html>",
    ].join("\n");

    const injectedHtml = injectNativeAuthBridgeBootstrap(
      html,
      "https://api.secpal.dev"
    );
    const assetName = buildNativeAuthBridgeAssetName(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev")
    );

    expect(injectedHtml).toContain(
      `<script id="secpal-native-auth-bridge-bootstrap" src="/${assetName}"></script>`
    );
    expect(
      injectedHtml.indexOf('id="secpal-native-auth-bridge-bootstrap"')
    ).toBeLessThan(injectedHtml.indexOf('<script type="module"'));
    expect(
      injectNativeAuthBridgeBootstrap(injectedHtml, "https://api.secpal.dev")
    ).toBe(injectedHtml);
  });

  it("preserves a self-only script CSP while loading the bridge as a same-origin asset", async () => {
    const {
      buildNativeAuthBridgeBootstrapScript,
      injectNativeAuthBridgeBootstrap,
    } = await loadInjectorModule();
    const apiOrigin = "https://api.secpal.dev";
    const bootstrap = buildNativeAuthBridgeBootstrapScript(apiOrigin);
    const bootstrapSha256 = createHash("sha256")
      .update(bootstrap, "utf8")
      .digest("hex");
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; script-src-attr 'none'\">",
      '<script type="module" src="/assets/index.js"></script>',
      "</head>",
      "<body></body>",
      "</html>",
    ].join("\n");

    const injectedHtml = injectNativeAuthBridgeBootstrap(html, apiOrigin);

    expect(injectedHtml).toContain(
      `src="/secpal-native-auth-bridge.${bootstrapSha256}.js"`
    );
    expect(injectedHtml).toContain(`script-src 'self'`);
    expect(injectedHtml).not.toContain("sha256-");
    expect(injectedHtml).not.toContain("'unsafe-inline'");
    expect(injectedHtml).not.toContain("'unsafe-eval'");
    expect(injectNativeAuthBridgeBootstrap(injectedHtml, apiOrigin)).toBe(
      injectedHtml
    );
  });

  it("does not modify script-src-elem when it overrides script-src", async () => {
    const { injectNativeAuthBridgeBootstrap } = await loadInjectorModule();
    const apiOrigin = "https://api.secpal.dev";
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; script-src-elem 'self'; script-src-attr 'none'\">",
      '<script type="module" src="/assets/index.js"></script>',
      "</head>",
      "<body></body>",
      "</html>",
    ].join("\n");

    const injectedHtml = injectNativeAuthBridgeBootstrap(html, apiOrigin);

    expect(injectedHtml).toContain(`script-src-elem 'self'`);
    expect(injectedHtml).not.toContain("sha256-");
  });

  it("injects before a case-insensitive module entry without moving the doctype", async () => {
    const { injectNativeAuthBridgeBootstrap } = await loadInjectorModule();
    const html = [
      "<!DOCTYPE HTML>",
      "<HTML>",
      "<HEAD>",
      '<SCRIPT TYPE="MODULE" SRC="/assets/index.js"></SCRIPT>',
      "</HEAD>",
      "<BODY></BODY>",
      "</HTML>",
    ].join("\n");

    const injectedHtml = injectNativeAuthBridgeBootstrap(
      html,
      "https://api.secpal.dev"
    );

    expect(injectedHtml.startsWith("<!DOCTYPE HTML>")).toBe(true);
    expect(
      injectedHtml.indexOf('id="secpal-native-auth-bridge-bootstrap"')
    ).toBeGreaterThan(injectedHtml.indexOf("<HEAD>"));
    expect(
      injectedHtml.indexOf('id="secpal-native-auth-bridge-bootstrap"')
    ).toBeLessThan(injectedHtml.indexOf('<SCRIPT TYPE="MODULE"'));
  });

  it("replaces an existing bootstrap script when reinjecting updated content", async () => {
    const { injectNativeAuthBridgeBootstrap } = await loadInjectorModule();
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<script id="secpal-native-auth-bridge-bootstrap" src="/secpal-native-auth-bridge.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js"></script>',
      '<script type="module" src="/assets/index.js"></script>',
      "</head>",
      "<body></body>",
      "</html>",
    ].join("\n");

    const reinjectedHtml = injectNativeAuthBridgeBootstrap(
      html,
      "https://api.secpal.dev"
    );

    expect(reinjectedHtml).toContain(
      'id="secpal-native-auth-bridge-bootstrap"'
    );
    expect(reinjectedHtml).not.toContain("aaaaaaaaaaaaaaaa");
    expect(
      reinjectedHtml.match(/id="secpal-native-auth-bridge-bootstrap"/g)
    ).toHaveLength(1);
  });

  it("moves an existing bootstrap script before the first module entry", async () => {
    const { injectNativeAuthBridgeBootstrap } = await loadInjectorModule();
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<script type="module" src="/assets/index.js"></script>',
      '<script id="secpal-native-auth-bridge-bootstrap" src="/secpal-native-auth-bridge.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js"></script>',
      "</head>",
      "<body></body>",
      "</html>",
    ].join("\n");

    const reinjectedHtml = injectNativeAuthBridgeBootstrap(
      html,
      "https://api.secpal.dev"
    );

    expect(
      reinjectedHtml.indexOf('id="secpal-native-auth-bridge-bootstrap"')
    ).toBeLessThan(reinjectedHtml.indexOf('<script type="module"'));
    expect(
      reinjectedHtml.match(/id="secpal-native-auth-bridge-bootstrap"/g)
    ).toHaveLength(1);
  });

  it("does not inject WebView presentation owned by the shared frontend", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const bootstrap = buildNativeAuthBridgeBootstrapScript(
      runtimeBootstrapPlaceholderOrigin
    );

    expect(bootstrap).not.toContain("secpal-instance-discovery-gate");
    expect(bootstrap).not.toContain("secpal-instance-runtime-info");
    expect(bootstrap).not.toContain("secpal-about-attribution");
    expect(bootstrap).not.toContain("normalizeDiscoveryOrigin");
    expect(bootstrap).not.toContain("validateBootstrapPayload");
  });

  it("does not mutate the WebView document while installing native capabilities", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const document = new MockDocument();
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
            getRuntimeBootstrap: vi
              .fn()
              .mockResolvedValue({ configured: false }),
          },
        },
      },
      document,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );
    await flushMicrotasks();

    expect(document.body.children).toHaveLength(0);
    expect(document.head.children).toHaveLength(0);
  });

  it("installs the native bridge, keeps the vault wrapper methods off the bootstrap bridge, and routes authenticated /v1/ fetch traffic through the native plugin", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      loginWithPasskey: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      getPasskeyCapabilities: vi.fn().mockResolvedValue({
        passkeysAvailable: true,
      }),
      createPasskeyAttestation: vi.fn().mockResolvedValue({
        id: "credential-id",
        raw_id: "cmF3LWlk",
        type: "public-key",
        response: {
          client_data_json: "Y2xpZW50LWRhdGE",
          attestation_object: "YXR0ZXN0YXRpb24tb2JqZWN0",
        },
      }),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 7 }),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      isVaultDeviceBoundWrapperAvailable: vi
        .fn()
        .mockResolvedValue({ available: true }),
      wrapVaultRootKey: vi.fn().mockResolvedValue({
        wrappedRootKey: "wrapped-root-key",
      }),
      unwrapVaultRootKey: vi.fn().mockResolvedValue({
        rootKeyBase64: "cm9vdC1rZXk=",
      }),
      request: vi.fn().mockResolvedValue({
        status: 200,
        bodyBase64: encodeBase64('{"ok":true}'),
        contentType: "application/json",
      }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue({
          apiOrigin: "https://api.secpal.dev",
          rawApiBaseUrl: "https://api.secpal.dev/v1",
        }),
      }),
      confirmRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const browserFetch = vi
      .fn()
      .mockResolvedValue(new Response("browser", { status: 200 }));

    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage(),
      fetch: browserFetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      login(credentials: { email: string; password: string }): Promise<unknown>;
      setRuntimeBootstrap(bootstrap: Record<string, unknown>): Promise<string>;
      loginWithPasskey?(): Promise<unknown>;
      getPasskeyCapabilities?(): Promise<{
        passkeysAvailable: boolean;
        reason?: string;
      }>;
      createPasskeyAttestation?(options: {
        challenge: string;
        rp: { id: string; name: string };
        user: { id: string; name: string; display_name: string };
        pub_key_cred_params: Array<{ type: "public-key"; alg: number }>;
      }): Promise<unknown>;
      unwrapVaultRootKey?(options: {
        wrappedRootKey: string;
        subjectHash: string;
        metadata?: string;
      }): Promise<{ rootKeyBase64: string }>;
    };

    await bridge.setRuntimeBootstrap(
      buildRuntimeBootstrapValue({
        apiOrigin: "https://api.secpal.dev",
        rawApiBaseUrl: "https://api.secpal.dev/v1",
      })
    );
    await bridge.login({ email: "worker@secpal.dev", password: "password123" });
    await expect(bridge.getPasskeyCapabilities?.()).resolves.toEqual({
      passkeysAvailable: true,
    });
    await bridge.loginWithPasskey?.();
    await bridge.createPasskeyAttestation?.({
      challenge: "Zm9vYmFy",
      rp: { id: "app.secpal.dev", name: "SecPal" },
      user: {
        id: "dXNlci1pZA",
        name: "worker@secpal.dev",
        display_name: "Worker",
      },
      pub_key_cred_params: [{ type: "public-key", alg: -7 }],
    });
    expect("isVaultDeviceBoundWrapperAvailable" in bridge).toBe(false);
    expect("wrapVaultRootKey" in bridge).toBe(false);
    expect(bridge.unwrapVaultRootKey).toBeUndefined();

    const response = await (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/customers",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "SecPal GmbH" }),
      }
    );

    expect(plugin.login).toHaveBeenCalledWith({
      email: "worker@secpal.dev",
      password: "password123",
    });
    expect(plugin.loginWithPasskey).toHaveBeenCalledWith();
    expect(plugin.getPasskeyCapabilities).toHaveBeenCalledTimes(3);
    expect(plugin.createPasskeyAttestation).toHaveBeenCalledWith({
      publicKey: {
        challenge: "Zm9vYmFy",
        rp: { id: "app.secpal.dev", name: "SecPal" },
        user: {
          id: "dXNlci1pZA",
          name: "worker@secpal.dev",
          display_name: "Worker",
        },
        pub_key_cred_params: [{ type: "public-key", alg: -7 }],
      },
    });
    expect(plugin.isVaultDeviceBoundWrapperAvailable).not.toHaveBeenCalled();
    expect(plugin.wrapVaultRootKey).not.toHaveBeenCalled();
    expect(plugin.unwrapVaultRootKey).not.toHaveBeenCalled();
    expect(plugin.request).toHaveBeenCalledWith({
      requestId: expect.any(String),
      method: "POST",
      path: "/v1/customers",
      bodyBase64: encodeBase64('{"name":"SecPal GmbH"}'),
      contentType: "application/json",
      accept: "application/json",
    });
    await expect(response.text()).resolves.toBe('{"ok":true}');
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it("keeps the optional vault wrapper methods off the injected bridge when the native plugin does not support them", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
    };

    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as Record<string, unknown>;

    expect(bridge.isVaultDeviceBoundWrapperAvailable).toBeUndefined();
    expect(bridge.wrapVaultRootKey).toBeUndefined();
    expect(bridge.unwrapVaultRootKey).toBeUndefined();
  });

  it("does not invoke native passkey actions when Android reports passkeys unavailable", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      createPasskeyAttestation: vi.fn(),
      getPasskeyCapabilities: vi.fn().mockResolvedValue({
        passkeysAvailable: false,
        reason: "PASSKEY_ANDROID_VERSION_UNSUPPORTED",
      }),
      login: vi.fn(),
      loginWithPasskey: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      createPasskeyAttestation(
        options: Record<string, unknown>
      ): Promise<unknown>;
      getPasskeyCapabilities(): Promise<unknown>;
    };

    await expect(bridge.getPasskeyCapabilities()).resolves.toEqual({
      passkeysAvailable: false,
      reason: "PASSKEY_ANDROID_VERSION_UNSUPPORTED",
    });
    await expect(bridge.createPasskeyAttestation({})).rejects.toMatchObject({
      code: "PASSKEY_ANDROID_VERSION_UNSUPPORTED",
    });
    expect(plugin.createPasskeyAttestation).not.toHaveBeenCalled();
    expect(plugin.loginWithPasskey).not.toHaveBeenCalled();
  });

  it("exposes native connectivity status through the injected bridge", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: false }),
      request: vi.fn(),
    };

    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      isNetworkAvailable(): Promise<boolean>;
    };

    await expect(bridge.isNetworkAvailable()).resolves.toBe(false);
    expect(plugin.isNetworkAvailable).toHaveBeenCalledOnce();
  });

  it("exposes an enterprise bridge for managed-state reads without gesture-navigation settings", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const enterprisePlugin = {
      getManagedState: vi.fn().mockResolvedValue({
        managed: true,
        mode: "device_owner",
        kioskActive: true,
        lockTaskEnabled: true,
        gestureNavigationEnabled: false,
        gestureNavigationSettingsAvailable: true,
        allowPhone: true,
        allowSms: true,
        allowedApps: [],
      }),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
      openOssLicenses: vi.fn().mockResolvedValue(undefined),
    };
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    expect(enterprisePlugin.getManagedState).not.toHaveBeenCalled();

    const bridge = sandbox.SecPalEnterpriseBridge as {
      getManagedState(): Promise<unknown>;
      openOssLicenses(): Promise<void>;
      openGestureNavigationSettings?: unknown;
    };

    expect(bridge.openGestureNavigationSettings).toBeUndefined();
    await expect(bridge.getManagedState()).resolves.toEqual({
      managed: true,
      mode: "device_owner",
      kioskActive: true,
      lockTaskEnabled: true,
      gestureNavigationEnabled: false,
      gestureNavigationSettingsAvailable: true,
      allowPhone: true,
      allowSms: true,
      allowedApps: [],
    });
    expect(enterprisePlugin.getManagedState).toHaveBeenCalledOnce();
    await expect(bridge.openOssLicenses()).resolves.toBeUndefined();
    expect(enterprisePlugin.openOssLicenses).toHaveBeenCalledOnce();
  });

  it("registers enterprise hardware-button listeners and routes short and long presses", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const listeners: Record<string, Array<() => void>> = {
      hardwareButtonShortPressed: [],
      hardwareButtonLongPressed: [],
    };
    const handles: { remove: () => void }[] = [];
    const enterprisePlugin = {
      addListener: vi.fn((eventName: string, listener: () => void) => {
        if (eventName in listeners) {
          listeners[eventName].push(listener);
        }

        const handle = { remove: vi.fn() };
        handles.push(handle);
        return handle;
      }),
    };
    const location = { href: "https://app.secpal.dev/dashboard" };
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location,
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    expect(listeners.hardwareButtonShortPressed).toHaveLength(1);
    expect(listeners.hardwareButtonLongPressed).toHaveLength(1);

    listeners.hardwareButtonShortPressed[0]?.();
    expect(location.href).toBe("https://app.secpal.dev/profile");

    listeners.hardwareButtonLongPressed[0]?.();
    expect(location.href).toBe("https://app.secpal.dev/about");

    // Each auto-registered listener returns a handle with a callable remove() function.
    expect(handles.length).toBeGreaterThanOrEqual(2);
    for (const handle of handles) {
      expect(typeof handle.remove).toBe("function");
      handle.remove();
      expect(handle.remove).toHaveBeenCalledOnce();
    }
  });

  it("returns a handle with remove() from addHardwareButtonShortPressListener and addHardwareButtonLongPressListener on the enterprise bridge", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const enterprisePlugin = {
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    };
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const bridge = sandbox.SecPalEnterpriseBridge as {
      addHardwareButtonShortPressListener: (cb: () => void) => {
        remove: () => void;
      };
      addHardwareButtonLongPressListener: (cb: () => void) => {
        remove: () => void;
      };
    };

    const shortHandle = bridge.addHardwareButtonShortPressListener(() => {});
    expect(typeof shortHandle.remove).toBe("function");
    shortHandle.remove();
    expect(enterprisePlugin.addListener).toHaveBeenCalledWith(
      "hardwareButtonShortPressed",
      expect.any(Function)
    );

    const longHandle = bridge.addHardwareButtonLongPressListener(() => {});
    expect(typeof longHandle.remove).toBe("function");
    longHandle.remove();
    expect(enterprisePlugin.addListener).toHaveBeenCalledWith(
      "hardwareButtonLongPressed",
      expect.any(Function)
    );
  });

  it("keeps public and non-authenticated requests on the browser fetch path", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
    };
    const browserFetch = vi.fn().mockResolvedValue(
      new Response('{"status":"ready"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      fetch: browserFetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const response = await (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/health/ready",
      { method: "GET" }
    );
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    await (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/bootstrap?client_platform=browser"
    );
    await (sandbox.fetch as typeof fetch)("https://api.secpal.dev/v1/release");
    await (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/onboarding/validate-token?token=invite&email=worker%40example.com"
    );
    await (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/onboarding/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );

    expect(plugin.request).not.toHaveBeenCalled();
    expect(browserFetch).toHaveBeenCalledTimes(5);
    await expect(response.text()).resolves.toBe('{"status":"ready"}');
  });

  it("cancels an in-flight native fetch when its AbortSignal fires", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    let rejectNativeRequest: ((error: Error) => void) | undefined;
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectNativeRequest = reject;
          })
      ),
      cancelRequest: vi.fn().mockImplementation(() => {
        rejectNativeRequest?.(
          Object.assign(new Error("cancelled"), {
            code: "REQUEST_CANCELLED",
          })
        );
        return Promise.resolve({ cancelled: true });
      }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue({
          apiOrigin: "https://api.secpal.dev",
          rawApiBaseUrl: "https://api.secpal.dev/v1",
        }),
      }),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );
    await flushMicrotasks();
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    const abortController = new AbortController();
    const pendingFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me",
      { signal: abortController.signal }
    );
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(1));

    abortController.abort();

    await expect(pendingFetch).rejects.toMatchObject({ name: "AbortError" });
    expect(plugin.cancelRequest).toHaveBeenCalledWith({
      requestId: plugin.request.mock.calls[0][0].requestId,
    });
  });

  it("observes abort while native runtime restoration is still pending", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      cancelRequest: vi.fn().mockResolvedValue({ cancelled: false }),
      getRuntimeBootstrap: vi
        .fn()
        .mockImplementation(() => new Promise(() => {})),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    const abortController = new AbortController();
    const pendingFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me",
      { signal: abortController.signal }
    );

    abortController.abort();

    await expect(
      Promise.race([
        pendingFetch.then(
          () => "resolved",
          (error: Error) => error.name
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("timeout"), 100)
        ),
      ])
    ).resolves.toBe("AbortError");
    expect(plugin.request).not.toHaveBeenCalled();
  });

  it("rejects an oversized intercepted upload before native submission", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      cancelRequest: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue({
          apiOrigin: "https://api.secpal.dev",
          rawApiBaseUrl: "https://api.secpal.dev/v1",
        }),
      }),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );
    await flushMicrotasks();
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;

    const upload = new Uint8Array(12 * 1024 * 1024 + 1);
    const pendingFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/customers/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: upload,
      }
    );

    await expect(pendingFetch).rejects.toMatchObject({
      code: "NATIVE_AUTH_REQUEST_TOO_LARGE",
    });
    expect(plugin.request).not.toHaveBeenCalled();
  });

  it("bounds queued intercepted requests before buffering or native submission", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const pendingNativeRequests = new Map<
      string,
      { reject: (error: Error) => void }
    >();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockImplementation(
        ({ requestId }: { requestId: string }) =>
          new Promise((_resolve, reject) => {
            pendingNativeRequests.set(requestId, { reject });
          })
      ),
      cancelRequest: vi
        .fn()
        .mockImplementation(({ requestId }: { requestId: string }) => {
          pendingNativeRequests.get(requestId)?.reject(
            Object.assign(new Error("cancelled"), {
              code: "REQUEST_CANCELLED",
            })
          );
          return Promise.resolve({ cancelled: true });
        }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue({
          apiOrigin: "https://api.secpal.dev",
          rawApiBaseUrl: "https://api.secpal.dev/v1",
        }),
      }),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );
    await flushMicrotasks();
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    const controllers = Array.from({ length: 9 }, () => new AbortController());
    const admitted = controllers.map((controller, index) =>
      (sandbox.fetch as typeof fetch)(
        `https://api.secpal.dev/v1/customers?page=${index + 1}`,
        { signal: controller.signal }
      )
    );
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalled());

    const overloaded = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/customers?page=10"
    );

    await expect(
      Promise.race([
        overloaded.catch((error: Error & { code?: string }) => error.code),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("timeout"), 100)
        ),
      ])
    ).resolves.toBe("NATIVE_AUTH_BUSY");
    expect(plugin.request).toHaveBeenCalledTimes(1);

    for (const controller of controllers) {
      controller.abort();
    }
    await Promise.allSettled(admitted);
  });

  it("rejects when abort wins after an intercepted native fetch resolves", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    let resolveNativeRequest:
      | ((response: {
          status: number;
          bodyBase64: string;
          contentType: string;
        }) => void)
      | undefined;
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveNativeRequest = resolve;
          })
      ),
      cancelRequest: vi.fn().mockResolvedValue({ cancelled: true }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue({
          apiOrigin: "https://api.secpal.dev",
          rawApiBaseUrl: "https://api.secpal.dev/v1",
        }),
      }),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );
    await flushMicrotasks();
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    const abortController = new AbortController();
    const pendingFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me",
      { signal: abortController.signal }
    );
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(1));

    resolveNativeRequest?.({
      status: 200,
      bodyBase64: "e30=",
      contentType: "application/json",
    });
    abortController.abort();

    await expect(pendingFetch).rejects.toMatchObject({ name: "AbortError" });
  });

  it("blocks logout when the runtime bootstrap restore failed", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi
        .fn()
        .mockRejectedValue(new Error("native bridge unavailable")),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      sessionStorage,
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console: { ...console, warn: vi.fn() },
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const bridge = sandbox.SecPalNativeAuthBridge as {
      logout(): Promise<void>;
    };
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };

    authState.active = true;

    await expect(bridge.logout()).rejects.toThrow(/not configured/i);
    expect(plugin.logout).not.toHaveBeenCalled();
    expect(authState.active).toBe(true);
  });

  function createCustomerAndroidPushBootstrap() {
    return buildRuntimeBootstrapValue({
      instanceDisplayName: "Customer Example",
      apiOrigin: "https://customer-api.example",
      rawApiBaseUrl: "https://customer-api.example/v1",
      androidPush: {
        provider: "fcm",
        metadataRevision: 3,
        publicClientMetadata: {
          apiKey: "public-client-api-key-demo-1234567890",
          projectId: "secpal-demo-push",
          applicationId: "1:1234567890:android:abcdef1234567890",
          senderId: "1234567890",
        },
      },
    });
  }

  function decodeBase64Json(value: string) {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
  }

  function getNotificationRegistrationPushToken(
    payload: Record<string, unknown>
  ) {
    const registration = payload.registration as
      { push_token?: string } | undefined;

    return registration?.push_token;
  }

  async function createAndroidPushLifecycleSandbox(
    options: {
      includeResetUi?: boolean;
      crypto?: Record<string, unknown>;
      installationId?: string;
      localStorage?: ReturnType<typeof createMockStorage>;
      sessionStorage?: ReturnType<typeof createMockStorage>;
      runtimeBootstrap?: ReturnType<typeof createCustomerAndroidPushBootstrap>;
    } = {}
  ) {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const installationId =
      options.installationId ?? "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap =
      options.runtimeBootstrap ?? createCustomerAndroidPushBootstrap();
    const browserFetch = vi.fn(
      async () => new Response("browser", { status: 200 })
    );
    const listeners: Record<
      string,
      Array<(payload: Record<string, unknown>) => void>
    > = {
      androidPushTokenReceived: [],
      androidPushTokenError: [],
    };
    const handles: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 7 }),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockResolvedValue({
        status: 201,
        bodyBase64: encodeBase64(
          JSON.stringify({
            data: {
              installation_id: installationId,
            },
          })
        ),
        contentType: "application/json",
      }),
      getRuntimeInfo: vi.fn().mockResolvedValue({
        clientPlatform: "android",
        appVersion: "1.5.0",
        appBuild: 10500,
      }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: runtimeBootstrap,
      }),
      confirmRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn(
        (
          eventName: string,
          listener: (payload: Record<string, unknown>) => void
        ) => {
          if (eventName in listeners) {
            listeners[eventName].push(listener);
          }

          const handle = { remove: vi.fn() };
          handles.push(handle);
          return handle;
        }
      ),
    };
    const document = new MockDocument();

    if (options.includeResetUi) {
      appendMockLoginFooter(document);
    }

    const localStorage =
      options.localStorage ??
      createMockStorage({
        "secpal-locale": "en",
        "tenant-cache": "customer-a",
      });
    const sessionStorage =
      options.sessionStorage ??
      createMockStorage({
        [runtimeBootstrapStorageKey]:
          buildStoredRuntimeBootstrap(runtimeBootstrap),
        "tenant-session": "customer-a-session",
      });
    const windowEventListeners = new Map<
      string,
      Array<(event: { type: string }) => void>
    >();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage,
      fetch: browserFetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      confirm: vi.fn().mockReturnValue(true),
      crypto: options.crypto ?? {
        randomUUID: vi.fn(() => installationId),
      },
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
      Event: class MockWindowEvent {
        constructor(readonly type: string) {}
      },
      addEventListener(
        eventName: string,
        listener: (event: { type: string }) => void
      ) {
        const registeredListeners = windowEventListeners.get(eventName) ?? [];
        registeredListeners.push(listener);
        windowEventListeners.set(eventName, registeredListeners);
      },
      dispatchEvent(event: { type: string }) {
        for (const listener of windowEventListeners.get(event.type) ?? []) {
          listener(event);
        }

        return true;
      },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    return {
      bridge: sandbox.SecPalNativeAuthBridge as {
        login(credentials: {
          email: string;
          password: string;
        }): Promise<unknown>;
        logout(): Promise<void>;
      },
      browserFetch,
      document,
      handles,
      installationId,
      listeners,
      localStorage,
      plugin,
      sandbox,
      sessionStorage,
    };
  }

  it("registers a pending Android push token after native login against the selected customer-hosted backend", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const {
      bridge,
      browserFetch,
      handles,
      installationId,
      listeners,
      plugin,
      sandbox,
    } = await createAndroidPushLifecycleSandbox();

    expect(plugin.addListener).toHaveBeenCalledTimes(2);
    expect(plugin.addListener.mock.calls.map((call) => call[0])).toEqual([
      "androidPushTokenReceived",
      "androidPushTokenError",
    ]);

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledOnce();
    expect(browserFetch).not.toHaveBeenCalled();

    const registrationRequest = plugin.request.mock.calls[0]?.[0] as {
      accept?: string;
      bodyBase64?: string;
      contentType?: string;
      method: string;
      path: string;
    };
    const registrationPayload = decodeBase64Json(
      String(registrationRequest.bodyBase64)
    );

    expect(registrationRequest).toEqual({
      requestId: installationId,
      method: "PUT",
      path: `/v1/me/notification-installations/${installationId}`,
      bodyBase64: registrationRequest.bodyBase64,
      contentType: "application/json",
      accept: "application/json",
    });
    expect(registrationPayload).toEqual({
      channel: "android_fcm",
      installation_name: "SecPal Android",
      registration: {
        push_token: pushToken,
        app: {
          package_name: "app.secpal",
          package_version_name: "1.5.0",
          package_version_code: 10500,
        },
      },
      lifecycle_event: "registered",
      runtime: {
        bootstrap_version: "v1",
        schema_version: 4,
        metadata_revision: 3,
      },
    });

    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      tokenReceivedHandle: { remove: () => void } | null;
      tokenErrorHandle: { remove: () => void } | null;
    };

    expect(handles).toHaveLength(2);
    await flushMicrotasks();
    expect(pushSyncState.tokenReceivedHandle).not.toBeNull();
    expect(typeof pushSyncState.tokenReceivedHandle?.remove).toBe("function");
    expect(pushSyncState.tokenErrorHandle).not.toBeNull();
    expect(typeof pushSyncState.tokenErrorHandle?.remove).toBe("function");

    for (const handle of handles) {
      expect(typeof handle.remove).toBe("function");
      const remove = handle.remove as unknown as () => void;
      remove();
      expect(handle.remove).toHaveBeenCalledOnce();
    }
  });

  it("emits strict schema 4 after restoring runtime state with obsolete schema markers", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const firstInstallationId = "11111111-1111-4111-8111-111111111111";
    const secondInstallationId = "22222222-2222-4222-8222-222222222222";
    const runtimeBootstrap = {
      ...createCustomerAndroidPushBootstrap(),
      schemaVersion: 3,
      schema_version: 3,
    };
    const installationStorageKey =
      "secpal-android-push-installation:" +
      encodeURIComponent(runtimeBootstrap.apiOrigin);
    const sharedLocalStorage = createMockStorage({
      "secpal-locale": "en",
      "tenant-cache": "customer-a",
      [installationStorageKey]: firstInstallationId,
    });
    const sharedSessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
      "tenant-session": "customer-a-session",
    });
    const firstPage = await createAndroidPushLifecycleSandbox({
      installationId: firstInstallationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });

    firstPage.listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    expect(firstPage.plugin.request).not.toHaveBeenCalled();

    const reloadedPage = await createAndroidPushLifecycleSandbox({
      installationId: secondInstallationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });

    await reloadedPage.bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(reloadedPage.plugin.request).toHaveBeenCalledOnce();

    const registrationRequest = reloadedPage.plugin.request.mock
      .calls[0]?.[0] as {
      bodyBase64?: string;
      method: string;
      path: string;
    };
    const registrationPayload = decodeBase64Json(
      String(registrationRequest.bodyBase64)
    );

    expect(registrationRequest.method).toBe("PUT");
    expect(registrationRequest.path).toBe(
      `/v1/me/notification-installations/${firstInstallationId}`
    );
    expect(registrationRequest.path).not.toBe(
      `/v1/me/notification-installations/${reloadedPage.installationId}`
    );
    expect(getNotificationRegistrationPushToken(registrationPayload)).toBe(
      pushToken
    );
    expect(registrationPayload.lifecycle_event).toBe("registered");
    const registrationRuntime = registrationPayload.runtime as {
      schema_version?: unknown;
    };
    expect(registrationRuntime.schema_version).toBe(4);
    expect(Number.isInteger(registrationRuntime.schema_version)).toBe(true);
  });

  it("rehydrates a retained Android push token after logout clears session storage and the login route reloads", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const installationId = "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const installationStorageKey =
      "secpal-android-push-installation:" +
      encodeURIComponent(runtimeBootstrap.apiOrigin);
    const sharedLocalStorage = createMockStorage({
      [installationStorageKey]: installationId,
    });
    const sharedSessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
      "tenant-session": "customer-a-session",
    });
    const firstPage = await createAndroidPushLifecycleSandbox({
      installationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });

    firstPage.listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    sharedSessionStorage.clear();

    const reloadedPage = await createAndroidPushLifecycleSandbox({
      installationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });
    const pushSyncState = reloadedPage.sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      tokenReceivedHandle: { remove: () => void } | null;
      tokenErrorHandle: { remove: () => void } | null;
    };

    await flushMicrotasks();

    expect(reloadedPage.handles).toHaveLength(2);
    expect(pushSyncState.tokenReceivedHandle).not.toBeNull();
    expect(typeof pushSyncState.tokenReceivedHandle?.remove).toBe("function");
    expect(pushSyncState.tokenErrorHandle).not.toBeNull();
    expect(typeof pushSyncState.tokenErrorHandle?.remove).toBe("function");

    expect(pushSyncState.currentToken).toBe(pushToken);

    await reloadedPage.bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(reloadedPage.plugin.request).toHaveBeenCalledOnce();

    const registrationRequest = reloadedPage.plugin.request.mock
      .calls[0]?.[0] as {
      bodyBase64?: string;
      method: string;
      path: string;
    };
    const registrationPayload = decodeBase64Json(
      String(registrationRequest.bodyBase64)
    );

    expect(registrationRequest.method).toBe("PUT");
    expect(registrationRequest.path).toBe(
      `/v1/me/notification-installations/${installationId}`
    );
    expect(getNotificationRegistrationPushToken(registrationPayload)).toBe(
      pushToken
    );
    expect(registrationPayload.lifecycle_event).toBe("registered");

    for (const handle of reloadedPage.handles) {
      const remove = handle.remove as unknown as () => void;
      remove();
      expect(handle.remove).toHaveBeenCalledOnce();
    }
  });

  it("prefers the freshest trusted retained Android push token when local and session storage diverge", async () => {
    const stalePushToken =
      "fcm-token-stale-1234567890abcdefghijklmnopqrstuvwxyz";
    const freshPushToken =
      "fcm-token-fresh-1234567890abcdefghijklmnopqrstuvwxyz";
    const freshSavedAt = "1970-01-01T00:00:00Z";
    const installationId = "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const encodedApiOrigin = encodeURIComponent(runtimeBootstrap.apiOrigin);
    const installationStorageKey =
      "secpal-android-push-installation:" + encodedApiOrigin;
    const tokenStorageKey = "secpal-android-push-token:" + encodedApiOrigin;
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" + encodedApiOrigin;
    const tokenSavedAtStorageKey =
      "secpal-android-push-token-saved-at:" + encodedApiOrigin;
    const sharedLocalStorage = createMockStorage({
      [installationStorageKey]: installationId,
      [tokenStorageKey]: stalePushToken,
      [tokenAppStorageKey]: "secpal-runtime-push",
      [tokenSavedAtStorageKey]: "100",
    });
    const sharedSessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
      [tokenStorageKey]: freshPushToken,
      [tokenAppStorageKey]: "secpal-runtime-push",
      [tokenSavedAtStorageKey]: "200",
    });

    const reloadedPage = await createAndroidPushLifecycleSandbox({
      installationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });
    const pushSyncState = reloadedPage.sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      currentTokenSavedAt: number;
      tokenReceivedHandle: { remove: () => void } | null;
      tokenErrorHandle: { remove: () => void } | null;
    };

    await flushMicrotasks();

    expect(reloadedPage.handles).toHaveLength(2);
    expect(pushSyncState.tokenReceivedHandle).not.toBeNull();
    expect(typeof pushSyncState.tokenReceivedHandle?.remove).toBe("function");
    expect(pushSyncState.tokenErrorHandle).not.toBeNull();
    expect(typeof pushSyncState.tokenErrorHandle?.remove).toBe("function");

    expect(pushSyncState.currentToken).toBe(freshPushToken);
    expect(pushSyncState.currentTokenSavedAt).toBe(Date.parse(freshSavedAt));
    expect(sharedLocalStorage.getItem(tokenStorageKey)).toBe(freshPushToken);
    expect(sharedSessionStorage.getItem(tokenStorageKey)).toBe(freshPushToken);
    expect(sharedLocalStorage.getItem(tokenSavedAtStorageKey)).toBe(
      freshSavedAt
    );
    expect(sharedSessionStorage.getItem(tokenSavedAtStorageKey)).toBe(
      freshSavedAt
    );

    await reloadedPage.bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(reloadedPage.plugin.request).toHaveBeenCalledOnce();

    const registrationRequest = reloadedPage.plugin.request.mock
      .calls[0]?.[0] as {
      bodyBase64?: string;
      method: string;
      path: string;
    };
    const registrationPayload = decodeBase64Json(
      String(registrationRequest.bodyBase64)
    );

    expect(registrationRequest.method).toBe("PUT");
    expect(registrationRequest.path).toBe(
      `/v1/me/notification-installations/${installationId}`
    );
    expect(getNotificationRegistrationPushToken(registrationPayload)).toBe(
      freshPushToken
    );
    expect(registrationPayload.lifecycle_event).toBe("registered");

    for (const handle of reloadedPage.handles) {
      const remove = handle.remove as unknown as () => void;
      remove();
      expect(handle.remove).toHaveBeenCalledOnce();
    }
  });

  it("hydrates legacy retained Android push token timestamps from persisted storage", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const installationId = "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const encodedApiOrigin = encodeURIComponent(runtimeBootstrap.apiOrigin);
    const installationStorageKey =
      "secpal-android-push-installation:" + encodedApiOrigin;
    const tokenStorageKey = "secpal-android-push-token:" + encodedApiOrigin;
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" + encodedApiOrigin;
    const tokenSavedAtStorageKey =
      "secpal-android-push-token-saved-at:" + encodedApiOrigin;
    const sharedLocalStorage = createMockStorage({
      [installationStorageKey]: installationId,
      [tokenStorageKey]: pushToken,
      [tokenAppStorageKey]: "secpal-runtime-push",
    });
    const sharedSessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
    });
    const reloadedPage = await createAndroidPushLifecycleSandbox({
      installationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });
    const pushSyncState = reloadedPage.sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      currentTokenSavedAt: number;
    };

    await flushMicrotasks();

    const persistedSavedAt = sharedLocalStorage.getItem(tokenSavedAtStorageKey);

    expect(pushSyncState.currentToken).toBe(pushToken);
    expect(pushSyncState.currentTokenSavedAt).toBeGreaterThanOrEqual(0);
    expectCanonicalApiTimestamp(persistedSavedAt);
    expect(pushSyncState.currentTokenSavedAt).toBe(
      Date.parse(persistedSavedAt)
    );
    expect(sharedSessionStorage.getItem(tokenSavedAtStorageKey)).toBe(
      persistedSavedAt
    );
  });

  it("rewrites invalid retained Android push token timestamps during bootstrap hydration", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const installationId = "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const encodedApiOrigin = encodeURIComponent(runtimeBootstrap.apiOrigin);
    const installationStorageKey =
      "secpal-android-push-installation:" + encodedApiOrigin;
    const tokenStorageKey = "secpal-android-push-token:" + encodedApiOrigin;
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" + encodedApiOrigin;
    const tokenSavedAtStorageKey =
      "secpal-android-push-token-saved-at:" + encodedApiOrigin;
    const invalidLegacySavedAt = "8640000000000001";
    const sharedLocalStorage = createMockStorage({
      [installationStorageKey]: installationId,
      [tokenStorageKey]: pushToken,
      [tokenAppStorageKey]: "secpal-runtime-push",
      [tokenSavedAtStorageKey]: invalidLegacySavedAt,
    });
    const sharedSessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
    });
    const reloadedPage = await createAndroidPushLifecycleSandbox({
      installationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });
    const pushSyncState = reloadedPage.sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      currentTokenSavedAt: number;
    };

    await flushMicrotasks();

    const persistedSavedAt = sharedLocalStorage.getItem(tokenSavedAtStorageKey);

    expect(pushSyncState.currentToken).toBe(pushToken);
    expect(pushSyncState.currentTokenSavedAt).toBeGreaterThanOrEqual(0);
    expect(persistedSavedAt).not.toBe(invalidLegacySavedAt);
    expectCanonicalApiTimestamp(persistedSavedAt);
    expect(pushSyncState.currentTokenSavedAt).toBe(
      Date.parse(persistedSavedAt)
    );
    expect(sharedSessionStorage.getItem(tokenSavedAtStorageKey)).toBe(
      persistedSavedAt
    );
  });

  it("aligns the trusted in-memory push token savedAt with the persisted timestamp during bootstrap hydration", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const installationId = "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const tokenSavedAtStorageKey =
      "secpal-android-push-token-saved-at:" +
      encodeURIComponent(runtimeBootstrap.apiOrigin);
    const localStorage = createMockStorage();
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
    });
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 7 }),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockResolvedValue({
        status: 201,
        bodyBase64: encodeBase64(
          JSON.stringify({
            data: {
              installation_id: installationId,
            },
          })
        ),
        contentType: "application/json",
      }),
      getRuntimeInfo: vi.fn().mockResolvedValue({
        clientPlatform: "android",
        appVersion: "1.5.0",
        appBuild: 10500,
      }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: runtimeBootstrap,
      }),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn(() => ({
        remove: vi.fn(),
      })),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      __SecPalAndroidPushSyncState: {
        currentToken: pushToken,
        currentTokenSourceAppName: "secpal-runtime-push",
        currentTokenSavedAt: -1,
      },
      document: new MockDocument(),
      localStorage,
      sessionStorage,
      fetch: vi.fn(async () => new Response("browser", { status: 200 })),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      crypto: {
        randomUUID: vi.fn(() => installationId),
      },
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      currentTokenSavedAt: number;
    };
    const persistedSavedAt = localStorage.getItem(tokenSavedAtStorageKey);

    expectCanonicalApiTimestamp(persistedSavedAt);
    expect(pushSyncState.currentTokenSavedAt).toBe(
      Date.parse(persistedSavedAt)
    );
    expect(pushSyncState.currentTokenSavedAt).toBeGreaterThanOrEqual(0);
  });

  it("persists an early Android push token once the runtime bootstrap finishes restoring and rehydrates it after the login-route reload", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const installationId = "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const tokenStorageKey =
      "secpal-android-push-token:" +
      encodeURIComponent(runtimeBootstrap.apiOrigin);
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" +
      encodeURIComponent(runtimeBootstrap.apiOrigin);
    let resolveRuntimeBootstrap!: (value: unknown) => void;
    const runtimeBootstrapPromise = new Promise((resolve) => {
      resolveRuntimeBootstrap = resolve;
    });
    const listeners: Record<
      string,
      Array<(payload: Record<string, unknown>) => void>
    > = {
      androidPushTokenReceived: [],
      androidPushTokenError: [],
    };
    const handles: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 7 }),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockResolvedValue({
        status: 201,
        bodyBase64: encodeBase64(
          JSON.stringify({
            data: {
              installation_id: installationId,
            },
          })
        ),
        contentType: "application/json",
      }),
      getRuntimeInfo: vi.fn().mockResolvedValue({
        clientPlatform: "android",
        appVersion: "1.5.0",
        appBuild: 10500,
      }),
      getRuntimeBootstrap: vi.fn().mockReturnValue(runtimeBootstrapPromise),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn(
        (
          eventName: string,
          listener: (payload: Record<string, unknown>) => void
        ) => {
          if (eventName in listeners) {
            listeners[eventName].push(listener);
          }

          const handle = { remove: vi.fn() };
          handles.push(handle);
          return handle;
        }
      ),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage();
    const sessionStorage = createMockStorage();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage,
      fetch: vi.fn(async () => new Response("browser", { status: 200 })),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      crypto: {
        randomUUID: vi.fn(() => installationId),
      },
      location: { href: "https://app.secpal.dev/", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    const firstPagePushState = sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      tokenReceivedHandle: { remove: () => void } | null;
      tokenErrorHandle: { remove: () => void } | null;
    };

    expect(handles).toHaveLength(2);
    expect(firstPagePushState.tokenReceivedHandle).not.toBeNull();
    expect(typeof firstPagePushState.tokenReceivedHandle?.remove).toBe(
      "function"
    );
    expect(firstPagePushState.tokenErrorHandle).not.toBeNull();
    expect(typeof firstPagePushState.tokenErrorHandle?.remove).toBe("function");

    expect(firstPagePushState.currentToken).toBe(pushToken);
    expect(localStorage.getItem(tokenStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenStorageKey)).toBeNull();

    resolveRuntimeBootstrap({
      configured: true,
      bootstrap: runtimeBootstrap,
    });
    await flushMicrotasks();

    expect(localStorage.getItem(tokenStorageKey)).toBe(pushToken);
    expect(localStorage.getItem(tokenAppStorageKey)).toBe(
      "secpal-runtime-push"
    );

    const reloadedPage = await createAndroidPushLifecycleSandbox({
      installationId,
      localStorage,
      sessionStorage,
      runtimeBootstrap,
    });
    const reloadedPushState = reloadedPage.sandbox
      .__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      tokenReceivedHandle: { remove: () => void } | null;
      tokenErrorHandle: { remove: () => void } | null;
    };

    await flushMicrotasks();

    expect(reloadedPage.handles).toHaveLength(2);
    expect(reloadedPushState.tokenReceivedHandle).not.toBeNull();
    expect(typeof reloadedPushState.tokenReceivedHandle?.remove).toBe(
      "function"
    );
    expect(reloadedPushState.tokenErrorHandle).not.toBeNull();
    expect(typeof reloadedPushState.tokenErrorHandle?.remove).toBe("function");

    expect(reloadedPushState.currentToken).toBe(pushToken);

    for (const handle of reloadedPage.handles) {
      const remove = handle.remove as unknown as () => void;
      remove();
      expect(handle.remove).toHaveBeenCalledOnce();
    }
  });

  it("does not register a legacy retained Android push token without runtime-app provenance after a reload and login", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const installationId = "11111111-1111-4111-8111-111111111111";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const installationStorageKey =
      "secpal-android-push-installation:" +
      encodeURIComponent(runtimeBootstrap.apiOrigin);
    const tokenStorageKey =
      "secpal-android-push-token:" +
      encodeURIComponent(runtimeBootstrap.apiOrigin);
    const sharedLocalStorage = createMockStorage({
      [installationStorageKey]: installationId,
    });
    const sharedSessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
      [tokenStorageKey]: pushToken,
    });
    const reloadedPage = await createAndroidPushLifecycleSandbox({
      installationId,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
    });

    await reloadedPage.bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(reloadedPage.plugin.request).not.toHaveBeenCalled();
  });

  it("does not reactivate auth state after a successful direct bridge request", async () => {
    const { bridge, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };
    const nativeBridge = bridge as typeof bridge & {
      request(request: {
        method: string;
        path: string;
        accept?: string;
      }): Promise<{
        status: number;
        bodyBase64?: string;
        contentType?: string;
      }>;
    };

    plugin.request.mockResolvedValueOnce({
      status: 200,
      bodyBase64: encodeBase64('{"ok":true}'),
      contentType: "application/json",
    });
    authState.active = false;

    const response = await nativeBridge.request({
      method: "GET",
      path: "/v1/me",
      accept: "application/json",
    });

    expect(plugin.request).toHaveBeenCalledWith({
      requestId: expect.any(String),
      method: "GET",
      path: "/v1/me",
      accept: "application/json",
    });
    expect(response.status).toBe(200);
    expect(authState.active).toBe(false);
  });

  it("clears auth state when a direct bridge request returns 401", async () => {
    const { bridge, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };
    const nativeBridge = bridge as typeof bridge & {
      request(request: {
        method: string;
        path: string;
        accept?: string;
      }): Promise<{
        status: number;
        bodyBase64?: string;
        contentType?: string;
      }>;
    };

    plugin.request.mockResolvedValueOnce({
      status: 401,
      bodyBase64: encodeBase64('{"message":"Unauthenticated."}'),
      contentType: "application/json",
    });
    authState.active = true;

    const response = await nativeBridge.request({
      method: "GET",
      path: "/v1/me",
      accept: "application/json",
    });

    expect(response.status).toBe(401);
    expect(authState.active).toBe(false);
  });

  it("clears auth state when a direct bridge request rejects with HTTP_401", async () => {
    const { bridge, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };
    const nativeBridge = bridge as typeof bridge & {
      request(request: {
        method: string;
        path: string;
        accept?: string;
      }): Promise<unknown>;
    };
    const unauthorizedError = Object.assign(new Error("Unauthenticated"), {
      code: "HTTP_401",
    });

    plugin.request.mockRejectedValueOnce(unauthorizedError);
    authState.active = true;

    await expect(
      nativeBridge.request({
        method: "GET",
        path: "/v1/me",
        accept: "application/json",
      })
    ).rejects.toBe(unauthorizedError);

    expect(authState.active).toBe(false);
  });

  it("updates the backend registration when the Android push token rotates", async () => {
    const firstToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const secondToken = "fcm-token-rotation-0987654321zyxwvutsrqponmlkji";
    const { bridge, installationId, listeners, plugin } =
      await createAndroidPushLifecycleSandbox();

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: firstToken,
    });
    await flushMicrotasks();

    const initialRequest = plugin.request.mock.calls[0]?.[0] as {
      bodyBase64?: string;
      path: string;
    };
    const initialPayload = decodeBase64Json(String(initialRequest.bodyBase64));

    expect(initialRequest.path).toBe(
      `/v1/me/notification-installations/${installationId}`
    );
    expect(initialPayload.lifecycle_event).toBe("registered");

    plugin.request.mockClear();

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: secondToken,
    });
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledOnce();

    const rotatedRequest = plugin.request.mock.calls[0]?.[0] as {
      bodyBase64?: string;
      method: string;
      path: string;
    };
    const rotatedPayload = decodeBase64Json(String(rotatedRequest.bodyBase64));

    expect(rotatedRequest.method).toBe("PUT");
    expect(rotatedRequest.path).toBe(
      `/v1/me/notification-installations/${installationId}`
    );
    expect(rotatedPayload.lifecycle_event).toBe("credential_rotated");
    expect(getNotificationRegistrationPushToken(rotatedPayload)).toBe(
      secondToken
    );
  });

  it("ignores Android push tokens from unexpected Firebase app instances", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const { bridge, listeners, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      lastSyncedToken: string | null;
    };

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    listeners.androidPushTokenReceived[0]?.({
      appName: "legacy-default-firebase",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();
    expect(pushSyncState.currentToken).toBeNull();
    expect(pushSyncState.lastSyncedToken).toBeNull();
  });

  it("clears retained Android push tokens when a foreign Firebase app emits a token event", async () => {
    const staleToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const foreignToken = "fcm-token-abcdefghijklmnopqrstuvwxyz1234567890";
    const { listeners, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
    };

    pushSyncState.currentToken = staleToken;

    listeners.androidPushTokenReceived[0]?.({
      appName: "legacy-default-firebase",
      provider: "fcm",
      token: foreignToken,
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();
    expect(pushSyncState.currentToken).toBeNull();
  });

  it("preserves a trusted retained Android push token when a foreign Firebase app emits a token event", async () => {
    const retainedToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const foreignToken = "fcm-token-abcdefghijklmnopqrstuvwxyz1234567890";
    const tokenStorageKey =
      "secpal-android-push-token:" +
      encodeURIComponent("https://customer-api.example");
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" +
      encodeURIComponent("https://customer-api.example");
    const { listeners, plugin, sandbox, sessionStorage } =
      await createAndroidPushLifecycleSandbox();
    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
      currentTokenSourceAppName: string | null;
    };

    pushSyncState.currentToken = retainedToken;
    pushSyncState.currentTokenSourceAppName = "secpal-runtime-push";
    sessionStorage.setItem(tokenStorageKey, retainedToken);
    sessionStorage.setItem(tokenAppStorageKey, "secpal-runtime-push");

    listeners.androidPushTokenReceived[0]?.({
      appName: "legacy-default-firebase",
      provider: "fcm",
      token: foreignToken,
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();
    expect(pushSyncState.currentToken).toBe(retainedToken);
    expect(pushSyncState.currentTokenSourceAppName).toBe("secpal-runtime-push");
    expect(sessionStorage.getItem(tokenStorageKey)).toBe(retainedToken);
    expect(sessionStorage.getItem(tokenAppStorageKey)).toBe(
      "secpal-runtime-push"
    );
  });

  it("retains Android push state when the runtime Firebase app emits a malformed token event", async () => {
    const retainedToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const tokenStorageKey =
      "secpal-android-push-token:" +
      encodeURIComponent("https://customer-api.example");
    const { listeners, plugin, sandbox, sessionStorage } =
      await createAndroidPushLifecycleSandbox();
    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      currentToken: string | null;
    };

    pushSyncState.currentToken = retainedToken;
    sessionStorage.setItem(tokenStorageKey, retainedToken);

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "apns",
      token: retainedToken,
    });
    await flushMicrotasks();

    expect(pushSyncState.currentToken).toBe(retainedToken);
    expect(sessionStorage.getItem(tokenStorageKey)).toBe(retainedToken);

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: "short-token",
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();
    expect(pushSyncState.currentToken).toBe(retainedToken);
    expect(sessionStorage.getItem(tokenStorageKey)).toBe(retainedToken);
  });

  it("ignores Android push token errors from unexpected Firebase app instances", async () => {
    const { listeners } = await createAndroidPushLifecycleSandbox();

    const warnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);

    listeners.androidPushTokenError[0]?.({
      appName: "legacy-default-firebase",
      error: "TOKEN_ERROR_UNKNOWN",
    });
    await flushMicrotasks();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logs a warning for Android push token errors from the runtime Firebase app", async () => {
    const { listeners } = await createAndroidPushLifecycleSandbox();

    const warnSpy = vi.spyOn(console, "warn").mockReturnValue(undefined);

    listeners.androidPushTokenError[0]?.({
      appName: "secpal-runtime-push",
      error: "TOKEN_ERROR_UNKNOWN",
    });
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("re-registers the push token after a session-expiry 401 during registration", async () => {
    // Scenario: push token arrives before login, first registration attempt gets 401
    // (session expired mid-sync). On next login with the same token, a fresh PUT must
    // be issued — not silently skipped by the dedup guard.
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const { bridge, installationId, listeners, plugin } =
      await createAndroidPushLifecycleSandbox();

    // Token arrives before the user logs in — no registration yet.
    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();

    // First login: registration PUT is sent and returns 401.
    plugin.request.mockResolvedValueOnce({
      status: 401,
      bodyBase64: "",
      contentType: "application/json",
    });

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledOnce();
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "PUT",
      path: `/v1/me/notification-installations/${installationId}`,
    });

    plugin.request.mockClear();
    // Restore the default 201 response for the next request.
    plugin.request.mockResolvedValue({
      status: 201,
      bodyBase64: encodeBase64(
        JSON.stringify({ data: { installation_id: installationId } })
      ),
      contentType: "application/json",
    });

    // Second login with the same push token: dedup guard must NOT suppress
    // the re-registration because the 401 cleared lastSyncedToken.
    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledOnce();
    const reRegistrationPayload = decodeBase64Json(
      String(
        (plugin.request.mock.calls[0]?.[0] as { bodyBase64?: string })
          .bodyBase64
      )
    );
    expect(reRegistrationPayload.lifecycle_event).toBe("registered");
    expect(getNotificationRegistrationPushToken(reRegistrationPayload)).toBe(
      pushToken
    );
  });

  it("decodes native JSON bodies as UTF-8 when TextDecoder is unavailable", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const instrumentedScript = buildNativeAuthBridgeBootstrapScript(
      runtimeBootstrapPlaceholderOrigin
    ).replace(
      "globalThis.SecPalNativeAuthBridge = bridge;",
      "globalThis.__testDecodeBase64Text = decodeBase64Text;\n  globalThis.SecPalNativeAuthBridge = bridge;"
    );
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
          },
        },
      },
      document: new MockDocument(),
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder: undefined,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(instrumentedScript, sandbox);

    const decodeBase64Text = sandbox.__testDecodeBase64Text as
      ((value: string) => string) | undefined;
    const messagePayload = JSON.stringify({ message: "Grüße aus Köln 🦊" });

    expect(typeof decodeBase64Text).toBe("function");
    expect(decodeBase64Text!(encodeBase64(messagePayload))).toBe(
      messagePayload
    );
  });

  it("clears the selected runtime when push registration reports stale notification metadata", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const encodedApiOrigin = encodeURIComponent(runtimeBootstrap.apiOrigin);
    const tokenStorageKey = "secpal-android-push-token:" + encodedApiOrigin;
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" + encodedApiOrigin;
    const tokenSavedAtStorageKey =
      "secpal-android-push-token-saved-at:" + encodedApiOrigin;
    const {
      bridge,
      installationId,
      listeners,
      localStorage,
      plugin,
      sandbox,
      sessionStorage,
    } = await createAndroidPushLifecycleSandbox({ runtimeBootstrap });
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
      pendingBootstrap: unknown;
    };

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    plugin.request.mockResolvedValueOnce({
      status: 409,
      bodyBase64: encodeBase64(
        JSON.stringify({
          message:
            "Notification runtime metadata changed; refresh bootstrap before retrying this installation update.",
          code: "NOTIFICATION_RUNTIME_STATE_INVALID",
          details: {
            bootstrap_version: "v1",
            schema_version: 4,
            channel: "android_fcm",
            provided_metadata_revision: 3,
            expected_metadata_revision: 4,
          },
        })
      ),
      contentType: "application/json",
    });

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks(16);

    expect(
      plugin.request.mock.calls.map(
        (call) => (call[0] as { method: string }).method
      )
    ).toEqual(["PUT"]);
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "PUT",
      path: `/v1/me/notification-installations/${installationId}`,
    });
    expect(plugin.logout).not.toHaveBeenCalled();
    expect(plugin.confirmRuntimeReset).toHaveBeenCalledWith({
      androidPushInstallationId: installationId,
    });
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(runtimeState.pendingBootstrap).toBeNull();
    expect(authState.active).toBe(false);
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(localStorage.getItem(tokenStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenStorageKey)).toBeNull();
    expect(localStorage.getItem(tokenAppStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenAppStorageKey)).toBeNull();
    expect(localStorage.getItem(tokenSavedAtStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenSavedAtStorageKey)).toBeNull();
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it("reloads into reset recovery when stale-push browser cleanup fails", async () => {
    const { bridge, listeners, localStorage, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    const logoutListener = vi.fn();
    sandbox.caches = {
      keys: vi.fn().mockResolvedValue(["tenant-cache"]),
      delete: vi.fn().mockResolvedValue(false),
    };
    (
      sandbox as {
        addEventListener(
          eventName: string,
          listener: (event: { type: string }) => void
        ): void;
      }
    ).addEventListener("secpal:native-auth-logout", logoutListener);

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz",
    });
    await flushMicrotasks();
    plugin.request.mockResolvedValueOnce({
      status: 409,
      bodyBase64: encodeBase64(
        JSON.stringify({
          message: "Notification runtime metadata changed.",
          code: "NOTIFICATION_RUNTIME_STATE_INVALID",
        })
      ),
      contentType: "application/json",
    });

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks(16);

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };
    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBe("1");
    expect(logoutListener).toHaveBeenCalledOnce();
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it("preserves the current session when a stale-push reset is not confirmed", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const { bridge, listeners, localStorage, plugin, sandbox, sessionStorage } =
      await createAndroidPushLifecycleSandbox({ runtimeBootstrap });
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };
    const cancelledConfirmation = Object.assign(
      new Error("Android runtime change was not confirmed"),
      { code: "RUNTIME_CONFIRMATION_CANCELLED" }
    );

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    plugin.request.mockResolvedValueOnce({
      status: 409,
      bodyBase64: encodeBase64(
        JSON.stringify({
          message: "Notification runtime metadata changed.",
          code: "NOTIFICATION_RUNTIME_STATE_INVALID",
        })
      ),
      contentType: "application/json",
    });
    plugin.confirmRuntimeReset.mockRejectedValueOnce(cancelledConfirmation);

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks(16);

    expect(plugin.request).toHaveBeenCalledOnce();
    expect(plugin.logout).not.toHaveBeenCalled();
    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe(runtimeBootstrap.apiOrigin);
    expect(authState.active).toBe(true);
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
    expect(localStorage.getItem("tenant-cache")).toBe("customer-a");
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).not.toHaveBeenCalled();
  });

  it("clears the selected runtime when push registration reports an unsupported notification channel", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const encodedApiOrigin = encodeURIComponent(runtimeBootstrap.apiOrigin);
    const tokenStorageKey = "secpal-android-push-token:" + encodedApiOrigin;
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" + encodedApiOrigin;
    const tokenSavedAtStorageKey =
      "secpal-android-push-token-saved-at:" + encodedApiOrigin;
    const {
      bridge,
      installationId,
      listeners,
      localStorage,
      plugin,
      sandbox,
      sessionStorage,
    } = await createAndroidPushLifecycleSandbox({ runtimeBootstrap });
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
      pendingBootstrap: unknown;
    };

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    plugin.request.mockResolvedValueOnce({
      status: 409,
      bodyBase64: encodeBase64(
        JSON.stringify({
          message:
            "Notification channel is no longer supported for this deployment.",
          code: "NOTIFICATION_CHANNEL_UNSUPPORTED",
          details: {
            bootstrap_version: "v1",
            schema_version: 4,
            channel: "android_fcm",
          },
        })
      ),
      contentType: "application/json",
    });

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks(16);

    expect(
      plugin.request.mock.calls.map(
        (call) => (call[0] as { method: string }).method
      )
    ).toEqual(["PUT"]);
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "PUT",
      path: `/v1/me/notification-installations/${installationId}`,
    });
    expect(plugin.logout).not.toHaveBeenCalled();
    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(runtimeState.pendingBootstrap).toBeNull();
    expect(authState.active).toBe(false);
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(localStorage.getItem(tokenStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenStorageKey)).toBeNull();
    expect(localStorage.getItem(tokenAppStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenAppStorageKey)).toBeNull();
    expect(localStorage.getItem(tokenSavedAtStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenSavedAtStorageKey)).toBeNull();
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it("clears the selected runtime on a 409 stale-metadata response when TextDecoder is unavailable", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const { bridge, listeners, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox({ runtimeBootstrap });

    // Remove TextDecoder to exercise the manual UTF-8 fallback path.
    delete (sandbox as Record<string, unknown>).TextDecoder;

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
    };

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    plugin.request.mockResolvedValueOnce({
      status: 409,
      bodyBase64: encodeBase64(
        JSON.stringify({
          message: "Notification runtime metadata changed.",
          code: "NOTIFICATION_RUNTIME_STATE_INVALID",
        })
      ),
      contentType: "application/json",
    });

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks(16);

    expect(
      plugin.request.mock.calls.map(
        (call) => (call[0] as { method: string }).method
      )
    ).toEqual(["PUT"]);
    expect(plugin.logout).not.toHaveBeenCalled();
    expect(runtimeState.configured).toBe(false);
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it("permanently disables Android push registration with a structured error when secure UUID APIs are unavailable", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { bridge, listeners, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox({ crypto: {} });
    const nativeBridge = bridge as typeof bridge & {
      getAndroidPushRegistrationState(): Promise<{
        disabledError: {
          apiOrigin: string | null;
          code: string;
          message: string;
          retryable: boolean;
        } | null;
      }>;
    };

    await expect(
      nativeBridge.getAndroidPushRegistrationState()
    ).resolves.toEqual({
      disabledError: null,
    });

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();

    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      disabledError: {
        apiOrigin: string;
        code: string;
        message: string;
        retryable: boolean;
      } | null;
    };
    const registrationState =
      await nativeBridge.getAndroidPushRegistrationState();

    expect(registrationState).toEqual({
      disabledError: {
        apiOrigin: "https://customer-api.example",
        code: "ANDROID_PUSH_INSTALLATION_ID_UNAVAILABLE",
        message:
          "Android push device registration is disabled because secure UUID generation is unavailable.",
        retryable: false,
      },
    });
    expect(pushSyncState.disabledError).toEqual(
      registrationState.disabledError
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Android push device registration is disabled.",
      registrationState.disabledError
    );

    errorSpy.mockClear();

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    expect(plugin.request).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    await expect(
      nativeBridge.getAndroidPushRegistrationState()
    ).resolves.toEqual(registrationState);

    errorSpy.mockRestore();
  });

  it("revokes the backend push-device registration before logout and re-registers it on the next login", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const { bridge, installationId, listeners, plugin } =
      await createAndroidPushLifecycleSandbox();

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    plugin.request.mockResolvedValue({
      status: 200,
      bodyBase64: encodeBase64(
        JSON.stringify({
          data: {
            installation_id: installationId,
            revoked_at: "2026-05-25T10:00:00Z",
          },
        })
      ),
      contentType: "application/json",
    });
    plugin.request.mockClear();

    await bridge.logout();
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledOnce();
    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(plugin.request.mock.invocationCallOrder[0]).toBeLessThan(
      plugin.logout.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "DELETE",
      path: `/v1/me/notification-installations/${installationId}`,
    });

    plugin.request.mockResolvedValue({
      status: 201,
      bodyBase64: encodeBase64(
        JSON.stringify({
          data: {
            installation_id: installationId,
          },
        })
      ),
      contentType: "application/json",
    });
    plugin.request.mockClear();

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledOnce();

    const reRegistrationPayload = decodeBase64Json(
      String(
        (
          plugin.request.mock.calls[0]?.[0] as {
            bodyBase64?: string;
          }
        ).bodyBase64
      )
    );

    expect(reRegistrationPayload.lifecycle_event).toBe("registered");
    expect(getNotificationRegistrationPushToken(reRegistrationPayload)).toBe(
      pushToken
    );
  });

  it("waits for an in-flight Android push registration before revoking it during logout", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const { bridge, installationId, listeners, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    type NativeRequestResponse = {
      bodyBase64: string;
      contentType: string;
      status: number;
    };
    const authState = sandbox.__SecPalNativeAuthState as { active: boolean };
    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      suspended: boolean;
    };
    let resolveRegistrationRequest: (
      value: NativeRequestResponse
    ) => void = () => {};
    const pendingRegistrationRequest = new Promise<NativeRequestResponse>(
      (resolve) => {
        resolveRegistrationRequest = resolve;
      }
    );

    await bridge.login({
      email: "worker@customer.example",
      password: "password123",
    });
    await flushMicrotasks();

    plugin.request
      .mockImplementationOnce(() => pendingRegistrationRequest)
      .mockResolvedValueOnce({
        status: 200,
        bodyBase64: encodeBase64(
          JSON.stringify({
            data: {
              installation_id: installationId,
              revoked_at: "2026-05-25T10:00:00Z",
            },
          })
        ),
        contentType: "application/json",
      });

    listeners.androidPushTokenReceived[0]?.({
      appName: "secpal-runtime-push",
      provider: "fcm",
      token: pushToken,
    });
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledTimes(1);
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "PUT",
      path: `/v1/me/notification-installations/${installationId}`,
    });

    const logoutPromise = bridge.logout();
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledTimes(1);

    resolveRegistrationRequest({
      status: 201,
      bodyBase64: encodeBase64(
        JSON.stringify({
          data: {
            installation_id: installationId,
          },
        })
      ),
      contentType: "application/json",
    });

    await logoutPromise;
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledTimes(2);
    expect(
      plugin.request.mock.calls.map(
        (call) => (call[0] as { method: string }).method
      )
    ).toEqual(["PUT", "DELETE"]);
    expect(plugin.request.mock.calls[1]?.[0]).toMatchObject({
      method: "DELETE",
      path: `/v1/me/notification-installations/${installationId}`,
    });
    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(authState.active).toBe(false);
    expect(pushSyncState.suspended).toBe(false);
  });

  it("dispatches a native logout event after the bridge completes logout", async () => {
    const { bridge, sandbox } = await createAndroidPushLifecycleSandbox();
    const logoutListener = vi.fn();
    const pushSyncState = sandbox.__SecPalAndroidPushSyncState as {
      suspended: boolean;
    };

    (
      sandbox as {
        addEventListener(
          eventName: string,
          listener: (event: { type: string }) => void
        ): void;
      }
    ).addEventListener("secpal:native-auth-logout", (event) => {
      logoutListener({
        event,
        suspended: pushSyncState.suspended,
      });
    });

    await bridge.logout();
    await flushMicrotasks();

    expect(logoutListener).toHaveBeenCalledOnce();
    expect(logoutListener).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: "secpal:native-auth-logout" }),
        suspended: false,
      })
    );
  });

  it("does not dispatch the native logout event when the plugin logout call throws", async () => {
    const { bridge, sandbox, plugin } =
      await createAndroidPushLifecycleSandbox();
    const logoutListener = vi.fn();

    plugin.logout.mockRejectedValueOnce(
      Object.assign(new Error("logout failed"), { code: "HTTP_500" })
    );

    (
      sandbox as {
        addEventListener(
          eventName: string,
          listener: (event: { type: string }) => void
        ): void;
      }
    ).addEventListener("secpal:native-auth-logout", logoutListener);

    await expect(bridge.logout()).rejects.toThrow("logout failed");
    await flushMicrotasks();

    expect(logoutListener).not.toHaveBeenCalled();
  });

  it("continues native logout and dispatches the logout event when push revocation fails", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const { bridge, listeners, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox();
    const logoutListener = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const revocationError = new Error("push revoke failed");

    try {
      (
        sandbox as {
          addEventListener(
            eventName: string,
            listener: (event: { type: string }) => void
          ): void;
        }
      ).addEventListener("secpal:native-auth-logout", logoutListener);

      await bridge.login({
        email: "worker@customer.example",
        password: "password123",
      });
      await flushMicrotasks();

      listeners.androidPushTokenReceived[0]?.({
        appName: "secpal-runtime-push",
        provider: "fcm",
        token: pushToken,
      });
      await flushMicrotasks();

      plugin.request.mockRejectedValueOnce(revocationError);

      await expect(bridge.logout()).resolves.toBeUndefined();
      await flushMicrotasks();

      expect(plugin.request).toHaveBeenCalledTimes(2);
      expect(plugin.request.mock.calls[1]?.[0]).toMatchObject({
        method: "DELETE",
      });
      expect(plugin.logout).toHaveBeenCalledOnce();
      expect(logoutListener).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to revoke Android push device registration.",
        revocationError
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not render the removed in-app dedicated-device launcher", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const enterprisePlugin = {
      getManagedState: vi.fn().mockResolvedValue({
        mode: "device_owner",
        kioskActive: true,
        allowedApps: [
          { packageName: "com.android.chrome", label: "Chrome" },
          { packageName: "com.android.settings", label: "Settings" },
        ],
        allowPhone: true,
        allowSms: true,
      }),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
            getRuntimeBootstrap: vi.fn().mockResolvedValue({
              configured: true,
              bootstrap: buildRuntimeBootstrapValue({
                apiOrigin: "https://api.secpal.dev",
                rawApiBaseUrl: "https://api.secpal.dev/v1",
              }),
            }),
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      document,
      sessionStorage: createMockStorage(),
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(enterprisePlugin.getManagedState).not.toHaveBeenCalled();
    expect(document.body.children).toHaveLength(0);
  });

  it("does not retry a removed in-app launcher when the enterprise plugin appears later", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const enterprisePlugin = {
      getManagedState: vi.fn().mockResolvedValue({
        mode: "device_owner",
        kioskActive: true,
        allowedApps: [
          { packageName: "com.android.settings", label: "Settings" },
        ],
        allowPhone: false,
        allowSms: false,
      }),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const capacitor: { Plugins: Record<string, unknown> } = {
      Plugins: {
        SecPalNativeAuth: {
          login: vi.fn(),
          logout: vi.fn(),
          getCurrentUser: vi.fn(),
          isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
          request: vi.fn(),
        },
      },
    };
    const sandbox = {
      Capacitor: capacitor,
      document,
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    capacitor.Plugins.SecPalEnterprise = enterprisePlugin;
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(enterprisePlugin.getManagedState).not.toHaveBeenCalled();
    expect(document.getElementById("secpal-system-app-launcher")).toBeNull();
  });

  it("does not call the enterprise plugin during bootstrap just to render a removed launcher", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const enterprisePlugin = {
      getManagedState: vi
        .fn()
        .mockRejectedValueOnce(new Error("bridge not ready"))
        .mockResolvedValue({
          mode: "device_owner",
          kioskActive: true,
          allowedApps: [{ packageName: "com.android.chrome", label: "Chrome" }],
          allowPhone: false,
          allowSms: false,
        }),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      document,
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(enterprisePlugin.getManagedState).not.toHaveBeenCalled();
    expect(document.getElementById("secpal-system-app-launcher")).toBeNull();
  });

  it("preserves pending managed distribution state through the enterprise bridge", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const enterprisePlugin = {
      getManagedState: vi.fn().mockResolvedValue({
        managed: true,
        mode: "device_owner",
        kioskActive: true,
        lockTaskEnabled: true,
        gestureNavigationEnabled: true,
        gestureNavigationSettingsAvailable: true,
        allowPhone: false,
        allowSms: false,
        allowedApps: [],
      }),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
    };
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const bridge = sandbox.SecPalEnterpriseBridge as {
      getManagedState(): Promise<unknown>;
    };

    await expect(bridge.getManagedState()).resolves.toEqual({
      managed: true,
      mode: "device_owner",
      kioskActive: true,
      lockTaskEnabled: true,
      gestureNavigationEnabled: true,
      gestureNavigationSettingsAvailable: true,
      allowPhone: false,
      allowSms: false,
      allowedApps: [],
    });
  });

  it("preserves failed managed distribution state through the enterprise bridge", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const enterprisePlugin = {
      getManagedState: vi.fn().mockResolvedValue({
        managed: true,
        mode: "device_owner",
        kioskActive: true,
        lockTaskEnabled: true,
        gestureNavigationEnabled: false,
        gestureNavigationSettingsAvailable: true,
        allowPhone: false,
        allowSms: false,
        allowedApps: [],
      }),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
    };
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            login: vi.fn(),
            logout: vi.fn(),
            getCurrentUser: vi.fn(),
            isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
            request: vi.fn(),
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      fetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );

    const bridge = sandbox.SecPalEnterpriseBridge as {
      getManagedState(): Promise<unknown>;
    };

    await expect(bridge.getManagedState()).resolves.toEqual({
      managed: true,
      mode: "device_owner",
      kioskActive: true,
      lockTaskEnabled: true,
      gestureNavigationEnabled: false,
      gestureNavigationSettingsAvailable: true,
      allowPhone: false,
      allowSms: false,
      allowedApps: [],
    });
  });

  it("routes authenticated fetch to exact /v1 path through the native bridge", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 1 } }),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockResolvedValue({
        status: 200,
        bodyBase64: encodeBase64('{"ok":true}'),
        contentType: "application/json",
      }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue({
          apiOrigin: "https://api.secpal.dev",
          rawApiBaseUrl: "https://api.secpal.dev/v1",
        }),
      }),
    };
    const browserFetch = vi
      .fn()
      .mockResolvedValue(new Response("browser", { status: 200 }));

    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage(),
      fetch: browserFetch,
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      login(credentials: { email: string; password: string }): Promise<unknown>;
    };

    await bridge.login({ email: "worker@secpal.dev", password: "pass" });

    const response = await (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1",
      { method: "GET" }
    );

    expect(plugin.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/v1" })
    );
    expect(browserFetch).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe('{"ok":true}');
  });

  it("exposes runtime bootstrap methods on the injected bridge for the shared frontend facade", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const runtimeBootstrap = {
      ...buildRuntimeBootstrapValue({
        apiOrigin: "https://customer-api.example",
        instanceDisplayName: "Customer Example",
      }),
      minimumSupportedAppVersion: "0.0.1",
      minimumSupportedAppBuild: 1,
    };
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeInfo: vi.fn().mockResolvedValue({
        clientPlatform: "android",
        appVersion: "0.0.1",
        appBuild: 1,
      }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: false,
      }),
      confirmRuntimeBootstrap: vi
        .fn()
        .mockResolvedValue({ bootstrap: runtimeBootstrap }),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
    };
    const localStorage = createMockStorage({
      "secpal-locale": "de",
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      localStorage,
      sessionStorage,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      getRuntimeInfo(): Promise<unknown>;
      getRuntimeBootstrap(): Promise<unknown>;
      setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
      clearRuntimeBootstrap(): Promise<void>;
    };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
      bootstrap: unknown;
    };

    await expect(bridge.getRuntimeInfo()).resolves.toEqual({
      clientPlatform: "android",
      appVersion: "0.0.1",
      appBuild: 1,
    });
    await expect(bridge.getRuntimeBootstrap()).resolves.toEqual({
      configured: false,
    });
    await expect(
      bridge.setRuntimeBootstrap({ apiOrigin: "http://invalid.example" })
    ).rejects.toThrow();
    await expect(
      bridge.setRuntimeBootstrap({
        apiOrigin: "https://customer-api.example",
      })
    ).rejects.toThrow("Android runtime bootstrap is incompatible.");
    expect(plugin.confirmRuntimeBootstrap).not.toHaveBeenCalled();
    await expect(bridge.setRuntimeBootstrap(runtimeBootstrap)).resolves.toBe(
      "https://customer-api.example"
    );
    const normalizedRuntimeBootstrap = { ...runtimeBootstrap };
    Reflect.deleteProperty(normalizedRuntimeBootstrap, "androidPush");
    Reflect.deleteProperty(
      normalizedRuntimeBootstrap,
      "minimumSupportedAppVersion"
    );
    Reflect.deleteProperty(
      normalizedRuntimeBootstrap,
      "minimumSupportedAppBuild"
    );
    expect(plugin.confirmRuntimeBootstrap).toHaveBeenCalledWith(
      normalizedRuntimeBootstrap
    );
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");

    const cancelledConfirmation = Object.assign(
      new Error("Android runtime change was not confirmed"),
      { code: "RUNTIME_CONFIRMATION_CANCELLED" }
    );
    plugin.confirmRuntimeBootstrap.mockRejectedValueOnce(cancelledConfirmation);
    await expect(
      bridge.setRuntimeBootstrap(
        buildRuntimeBootstrapValue({
          apiOrigin: "https://other-customer.example",
          instanceDisplayName: "Other Customer",
        })
      )
    ).rejects.toThrow("Android runtime change was not confirmed");
    expect(plugin.confirmRuntimeReset).not.toHaveBeenCalled();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");

    const nativeFormattedRuntimeBootstrap = {
      ...runtimeBootstrap,
      androidPush: {
        provider: "fcm",
        metadata_revision: 3,
        public_client_metadata: {
          api_key: "public-client-api-key-demo-1234567890",
          project_id: "secpal-demo-push",
          application_id: "1:1234567890:android:abcdef1234567890",
          sender_id: "1234567890",
        },
      },
    };
    await expect(
      bridge.setRuntimeBootstrap(nativeFormattedRuntimeBootstrap)
    ).resolves.toBe("https://customer-api.example");
    expect(runtimeState.bootstrap).toEqual(
      expect.objectContaining({
        androidPush: {
          provider: "fcm",
          metadataRevision: 3,
          publicClientMetadata: {
            apiKey: "public-client-api-key-demo-1234567890",
            projectId: "secpal-demo-push",
            applicationId: "1:1234567890:android:abcdef1234567890",
            senderId: "1234567890",
          },
        },
      })
    );
    expect(plugin.confirmRuntimeBootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        androidPush: {
          provider: "fcm",
          metadataRevision: 3,
          publicClientMetadata: {
            apiKey: "public-client-api-key-demo-1234567890",
            projectId: "secpal-demo-push",
            applicationId: "1:1234567890:android:abcdef1234567890",
            senderId: "1234567890",
          },
        },
      })
    );

    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    await expect(bridge.clearRuntimeBootstrap()).resolves.toBeUndefined();
    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(
      (sandbox.__SecPalNativeAuthState as { active: boolean }).active
    ).toBe(false);
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();

    Reflect.deleteProperty(plugin, "confirmRuntimeReset");
    await expect(bridge.clearRuntimeBootstrap()).rejects.toThrow(
      /native-confirmed runtime reset is unavailable/i
    );
  });

  it("keeps an in-flight native restore from reconfiguring the runtime after the shared frontend clears it", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    let resolveRestore!: (value: unknown) => void;
    const restorePromise = new Promise((resolve) => {
      resolveRestore = resolve;
    });
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockReturnValue(restorePromise),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage: createMockStorage({
        [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      }),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      clearRuntimeBootstrap(): Promise<void>;
    };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };

    await expect(bridge.clearRuntimeBootstrap()).resolves.toBeUndefined();
    resolveRestore({
      configured: true,
      bootstrap: buildRuntimeBootstrapValue({
        apiOrigin: "https://stale-api.example",
        rawApiBaseUrl: "https://stale-api.example/v1",
      }),
    });
    await flushMicrotasks();

    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();
  });

  it("preserves an incompatible vault and configured runtime when startup reset is not confirmed", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const runtimeBootstrap = buildRuntimeBootstrapValue({
      apiOrigin: "https://customer-api.example",
      instanceDisplayName: "Customer Example",
    });
    const cancelledConfirmation = Object.assign(
      new Error("Android runtime change was not confirmed"),
      { code: "RUNTIME_CONFIRMATION_CANCELLED" }
    );
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: runtimeBootstrap,
      }),
      confirmRuntimeReset: vi.fn().mockRejectedValue(cancelledConfirmation),
    };
    const localStorage = createMockStorage({
      auth_vault_state: JSON.stringify({
        wrapper: { kind: "native-device-bound" },
      }),
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
      "tenant-session": "customer-a-session",
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document: new MockDocument(),
      localStorage,
      sessionStorage,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console: { ...console, warn: vi.fn() },
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );
    await flushMicrotasks();

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };
    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(plugin.getRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(localStorage.getItem("tenant-cache")).toBe("customer-a-cache");
    expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
  });

  it("completes an accepted incompatible-vault reset before allowing a runtime rebind", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const currentBootstrap = buildRuntimeBootstrapValue({
      apiOrigin: "https://customer-api.example",
      instanceDisplayName: "Customer Example",
    });
    const replacementBootstrap = buildRuntimeBootstrapValue({
      apiOrigin: "https://replacement-api.example",
      instanceDisplayName: "Replacement Example",
    });
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: currentBootstrap,
      }),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
      confirmRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const localStorage = createMockStorage({
      auth_vault_state: JSON.stringify({
        wrapper: { kind: "native-device-bound" },
      }),
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(currentBootstrap),
      "tenant-session": "customer-a-session",
    });
    const reload = vi.fn();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document: new MockDocument(),
      localStorage,
      sessionStorage,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      nativeConfigPromise: Promise<void>;
      configured: boolean;
    };
    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();

    const bridge = sandbox.SecPalNativeAuthBridge as {
      setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
    };
    await expect(
      bridge.setRuntimeBootstrap(replacementBootstrap)
    ).resolves.toBe("https://replacement-api.example");

    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(plugin.confirmRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
    expect(runtimeState.configured).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("completes browser teardown after an interrupted native runtime reset", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({ configured: false }),
      confirmRuntimeReset: vi.fn(),
    };
    const localStorage = createMockStorage({
      [runtimeResetPendingStorageKey]: "1",
      "secpal-locale": "de",
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document: new MockDocument(),
      localStorage,
      sessionStorage,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );
    await flushMicrotasks();

    expect(plugin.getRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(plugin.confirmRuntimeReset).not.toHaveBeenCalled();
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
  });

  it("retries interrupted-reset recovery before leaving the recovery path", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      getRuntimeBootstrap: vi
        .fn()
        .mockRejectedValueOnce(new Error("transient native read failure"))
        .mockResolvedValue({ configured: false }),
    };
    const localStorage = createMockStorage({
      [runtimeResetPendingStorageKey]: "1",
      "secpal-locale": "de",
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document: new MockDocument(),
      localStorage,
      sessionStorage,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      nativeConfigPromise: Promise<void>;
    };
    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();

    expect(plugin.getRuntimeBootstrap).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
  });

  it("contains interrupted-reset cleanup failure without a startup reload loop", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({ configured: false }),
      confirmRuntimeReset: vi.fn(),
    };
    const localStorage = createMockStorage({
      [runtimeResetPendingStorageKey]: "1",
      "tenant-cache": "customer-a-cache",
    });
    const reload = vi.fn();
    const dispatchEvent = vi.fn();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document: new MockDocument(),
      localStorage,
      sessionStorage: createMockStorage({
        [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
        "tenant-session": "customer-a-session",
      }),
      caches: {
        keys: vi.fn().mockResolvedValue(["tenant-cache"]),
        delete: vi.fn().mockResolvedValue(false),
      },
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Event,
      dispatchEvent,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console: { ...console, warn: vi.fn() },
      location: { href: "https://app.secpal.dev/login", reload },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      nativeConfigPromise: Promise<void>;
      configured: boolean;
      apiOrigin: string | null;
    };
    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();

    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBe("1");
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect((dispatchEvent.mock.calls[0]?.[0] as Event).type).toBe(
      "secpal:native-auth-logout"
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps startup runtime initialization bound to interrupted-reset cleanup", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    let finishCacheDeletion!: () => void;
    const cacheDeletion = new Promise<boolean>((resolve) => {
      finishCacheDeletion = () => resolve(true);
    });
    const sandbox = {
      Capacitor: {
        Plugins: {
          SecPalNativeAuth: {
            getRuntimeBootstrap: vi
              .fn()
              .mockResolvedValue({ configured: false }),
          },
        },
      },
      document: new MockDocument(),
      localStorage: createMockStorage({
        [runtimeResetPendingStorageKey]: "1",
      }),
      sessionStorage: createMockStorage(),
      caches: {
        keys: vi.fn().mockResolvedValue(["tenant-cache"]),
        delete: vi.fn().mockReturnValue(cacheDeletion),
      },
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      nativeConfigPromise: Promise<void>;
    };
    const startupInitialization = runtimeState.nativeConfigPromise;
    await flushMicrotasks();

    expect(runtimeState.nativeConfigPromise).toBe(startupInitialization);

    finishCacheDeletion();
    await expect(startupInitialization).resolves.toBeUndefined();
  });

  it("discards a stale reset marker when the native runtime remains configured", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const runtimeBootstrap = buildRuntimeBootstrapValue({
      apiOrigin: "https://customer-api.example",
      instanceDisplayName: "Customer Example",
    });
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: runtimeBootstrap,
      }),
      confirmRuntimeReset: vi.fn(),
    };
    const localStorage = createMockStorage({
      [runtimeResetPendingStorageKey]: "1",
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document: new MockDocument(),
      localStorage,
      sessionStorage,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );
    await flushMicrotasks();

    expect(plugin.getRuntimeBootstrap).toHaveBeenCalledTimes(2);
    expect(plugin.confirmRuntimeReset).not.toHaveBeenCalled();
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
    expect(localStorage.getItem("tenant-cache")).toBe("customer-a-cache");
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
  });

  it("serializes a shared frontend clear after an in-flight runtime bootstrap apply", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const runtimeBootstrap = buildRuntimeBootstrapValue({
      apiOrigin: "https://customer-api.example",
      instanceDisplayName: "Customer Example",
    });
    let resolvePersist!: () => void;
    const persistPromise = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({ configured: false }),
      confirmRuntimeBootstrap: vi.fn().mockReturnValue(persistPromise),
      confirmRuntimeReset: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );
    await flushMicrotasks();

    const bridge = sandbox.SecPalNativeAuthBridge as {
      setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
      clearRuntimeBootstrap(): Promise<void>;
    };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };

    const apply = bridge.setRuntimeBootstrap(runtimeBootstrap);
    await flushMicrotasks();
    const clear = bridge.clearRuntimeBootstrap();
    await flushMicrotasks();
    expect(plugin.confirmRuntimeReset).not.toHaveBeenCalled();

    resolvePersist();
    await expect(apply).resolves.toBe("https://customer-api.example");
    await expect(clear).resolves.toBeUndefined();

    expect(plugin.confirmRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();
  });

  it("keeps the confirmed runtime when a queued reset is cancelled", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const runtimeBootstrap = buildRuntimeBootstrapValue({
      apiOrigin: "https://customer-api.example",
      instanceDisplayName: "Customer Example",
    });
    let resolvePersist!: () => void;
    const persistPromise = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });
    const resetCancelled = new Error("runtime reset cancelled");
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({ configured: false }),
      confirmRuntimeBootstrap: vi.fn().mockReturnValue(persistPromise),
      confirmRuntimeReset: vi.fn().mockRejectedValue(resetCancelled),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage: createMockStorage(),
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );
    await flushMicrotasks();

    const bridge = sandbox.SecPalNativeAuthBridge as {
      setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
      clearRuntimeBootstrap(): Promise<void>;
    };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };

    const apply = bridge.setRuntimeBootstrap(runtimeBootstrap);
    await flushMicrotasks();
    const clear = bridge.clearRuntimeBootstrap();
    resolvePersist();

    await expect(apply).resolves.toBe("https://customer-api.example");
    await expect(clear).rejects.toBe(resetCancelled);

    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
  });

  it("keeps the reset marker until asynchronous tenant cleanup completes", async () => {
    let resolveCacheDeletion!: (deleted: boolean) => void;
    const cacheDeletion = new Promise<boolean>((resolve) => {
      resolveCacheDeletion = resolve;
    });
    const { bridge, localStorage, sandbox } =
      await createAndroidPushLifecycleSandbox();
    sandbox.caches = {
      keys: vi.fn().mockResolvedValue(["tenant-cache"]),
      delete: vi.fn().mockReturnValue(cacheDeletion),
    };

    const clear = (
      bridge as typeof bridge & { clearRuntimeBootstrap(): Promise<void> }
    ).clearRuntimeBootstrap();
    await flushMicrotasks();

    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBe("1");

    resolveCacheDeletion(true);
    await expect(clear).resolves.toBeUndefined();
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
  });

  it("keeps reset recovery pending when tenant cleanup is incomplete", async () => {
    const cleanupFailures: Array<{
      name: string;
      configure(sandbox: Record<string, unknown>): void;
    }> = [
      {
        name: "cache deletion",
        configure(sandbox) {
          sandbox.caches = {
            keys: vi.fn().mockResolvedValue(["tenant-cache"]),
            delete: vi.fn().mockResolvedValue(false),
          };
        },
      },
      {
        name: "blocked IndexedDB deletion",
        configure(sandbox) {
          sandbox.indexedDB = {
            databases: vi.fn().mockResolvedValue([{ name: "tenant-db" }]),
            deleteDatabase: vi.fn(() => {
              const request: { onblocked?: () => void } = {};
              void Promise.resolve().then(() => request.onblocked?.());
              return request;
            }),
          };
        },
      },
      {
        name: "service-worker removal",
        configure(sandbox) {
          sandbox.navigator = {
            serviceWorker: {
              getRegistrations: vi
                .fn()
                .mockResolvedValue([
                  { unregister: vi.fn().mockResolvedValue(false) },
                ]),
            },
          };
        },
      },
    ];

    for (const cleanupFailure of cleanupFailures) {
      const { bridge, localStorage, plugin, sandbox } =
        await createAndroidPushLifecycleSandbox();
      const logoutListener = vi.fn();
      cleanupFailure.configure(sandbox);
      (
        sandbox as {
          addEventListener(
            eventName: string,
            listener: (event: { type: string }) => void
          ): void;
        }
      ).addEventListener("secpal:native-auth-logout", logoutListener);
      const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
        configured: boolean;
        apiOrigin: string | null;
      };

      await expect(
        (
          bridge as typeof bridge & { clearRuntimeBootstrap(): Promise<void> }
        ).clearRuntimeBootstrap(),
        cleanupFailure.name
      ).rejects.toThrow(/cleanup|blocked/i);

      expect(
        localStorage.getItem(runtimeResetPendingStorageKey),
        cleanupFailure.name
      ).toBe("1");
      expect(runtimeState.configured, cleanupFailure.name).toBe(false);
      expect(runtimeState.apiOrigin, cleanupFailure.name).toBeNull();
      expect(logoutListener, cleanupFailure.name).toHaveBeenCalledOnce();
      expect(
        (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload,
        cleanupFailure.name
      ).toHaveBeenCalledOnce();
      await expect(
        (
          bridge as typeof bridge & {
            setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
          }
        ).setRuntimeBootstrap(
          buildRuntimeBootstrapValue({
            apiOrigin: "https://other-customer.example",
            instanceDisplayName: "Other Customer",
          })
        ),
        cleanupFailure.name
      ).rejects.toThrow(/reset recovery.*pending/i);
      expect(plugin.confirmRuntimeBootstrap).not.toHaveBeenCalled();
    }
  });

  it("preserves tenant browser state when native runtime-bootstrap clearing fails", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const runtimeBootstrap = buildRuntimeBootstrapValue({
      apiOrigin: "https://customer-api.example",
      instanceDisplayName: "Customer Example",
    });
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({ configured: false }),
      confirmRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
      confirmRuntimeReset: vi
        .fn()
        .mockRejectedValue(new Error("native clear failed")),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage({
      "secpal-locale": "de",
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage,
      fetch: vi.fn(),
      Request,
      Response,
      Headers,
      URL,
      Uint8Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
      atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
      console,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
      clearRuntimeBootstrap(): Promise<void>;
    };
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };

    await expect(bridge.setRuntimeBootstrap(runtimeBootstrap)).resolves.toBe(
      "https://customer-api.example"
    );
    await expect(bridge.clearRuntimeBootstrap()).rejects.toThrow(
      "native clear failed"
    );

    expect(plugin.confirmRuntimeReset).toHaveBeenCalledOnce();
    expect(localStorage.getItem(runtimeResetPendingStorageKey)).toBeNull();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(localStorage.getItem("tenant-cache")).toBe("customer-a-cache");
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();
  });
});
