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
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
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

function runNativeBridgeInContext(
  source: string,
  sandbox: Record<string, unknown>
) {
  sandbox.setTimeout ??= setTimeout;
  sandbox.clearTimeout ??= clearTimeout;
  sandbox.Date ??= Date;
  return vm.runInNewContext(source, sandbox);
}

async function createNativeFetchSchedulerHarness({
  pluginOverrides = {},
  sandboxOverrides = {},
}: {
  pluginOverrides?: Record<string, unknown>;
  sandboxOverrides?: Record<string, unknown>;
} = {}) {
  const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
  const pendingNativeRequests = new Map<
    string,
    { reject: (error: Error) => void }
  >();
  const listeners = new Map<
    string,
    (payload: Record<string, unknown>) => void
  >();
  const plugin = {
    login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
    loginWithPasskey: vi.fn().mockResolvedValue({ user: { id: 7 } }),
    getPasskeyCapabilities: vi.fn().mockResolvedValue({
      passkeysAvailable: true,
    }),
    logout: vi.fn().mockResolvedValue(undefined),
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
      bootstrap: buildRuntimeBootstrapValue(),
    }),
    addListener: vi.fn(
      (
        eventName: string,
        listener: (payload: Record<string, unknown>) => void
      ) => {
        listeners.set(eventName, listener);
        return { remove: vi.fn() };
      }
    ),
    ...pluginOverrides,
  };
  const browserFetch = vi.fn().mockResolvedValue(new Response(null));
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
    setTimeout,
    clearTimeout,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    console,
    location: { href: "https://app.secpal.dev/" },
    ...sandboxOverrides,
  } as Record<string, unknown>;
  sandbox.globalThis = sandbox;
  runNativeBridgeInContext(
    buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
    sandbox
  );
  await flushMicrotasks();
  (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;

  return {
    bridge: sandbox.SecPalNativeAuthBridge as {
      login(credentials: { email: string; password: string }): Promise<unknown>;
      loginWithPasskey?(): Promise<unknown>;
    },
    browserFetch,
    listeners,
    plugin,
    sandbox,
  };
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

  it("does not queue browser-only API routes behind an active native request", async () => {
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
    const browserFetch = vi.fn().mockResolvedValue(
      new Response('{"status":"ready"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
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
    runNativeBridgeInContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );
    await flushMicrotasks();
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    const nativeAbort = new AbortController();
    const activeNativeFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me",
      { signal: nativeAbort.signal }
    );
    void activeNativeFetch.catch(() => undefined);
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(1));

    const publicResponse = await Promise.race([
      (sandbox.fetch as typeof fetch)("https://api.secpal.dev/v1/bootstrap"),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 100)
      ),
    ]);

    expect(publicResponse).not.toBe("timeout");
    expect(browserFetch).toHaveBeenCalledTimes(1);
    nativeAbort.abort();
    await Promise.allSettled([activeNativeFetch]);
  });

  it("snapshots intercepted fetch inputs before waiting in the native queue", async () => {
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
    runNativeBridgeInContext(
      buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
      sandbox
    );
    await flushMicrotasks();
    (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
    const activeAbort = new AbortController();
    const queuedAbort = new AbortController();
    const activeNativeFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me",
      { signal: activeAbort.signal }
    );
    void activeNativeFetch.catch(() => undefined);
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(1));
    const headers = new Headers({ "Content-Type": "application/json" });
    const body = new Uint8Array([1, 2, 3]);
    const queuedNativeFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/customers/import",
      {
        method: "POST",
        headers,
        body,
        signal: queuedAbort.signal,
      }
    );
    void queuedNativeFetch.catch(() => undefined);

    headers.set("Content-Type", "text/plain");
    body[0] = 9;
    activeAbort.abort();
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(2));

    expect(plugin.request.mock.calls[1][0]).toMatchObject({
      contentType: "application/json",
      bodyBase64: Buffer.from([1, 2, 3]).toString("base64"),
    });
    queuedAbort.abort();
    await Promise.allSettled([activeNativeFetch, queuedNativeFetch]);
  });

  it.each(["logout", "runtime switch"] as const)(
    "invalidates queued authenticated fetches during %s",
    async (transition) => {
      const { buildNativeAuthBridgeBootstrapScript } =
        await loadInjectorModule();
      const pendingNativeRequests = new Map<
        string,
        { reject: (error: Error) => void }
      >();
      const plugin = {
        login: vi.fn(),
        logout: vi.fn().mockResolvedValue(undefined),
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
          bootstrap: buildRuntimeBootstrapValue(),
        }),
        confirmRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
      };
      const browserFetch = vi.fn().mockResolvedValue(new Response(null));
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
        setTimeout,
        clearTimeout,
        btoa: (value: string) =>
          Buffer.from(value, "binary").toString("base64"),
        atob: (value: string) =>
          Buffer.from(value, "base64").toString("binary"),
        console,
        location: { href: "https://app.secpal.dev/" },
      } as Record<string, unknown>;
      sandbox.globalThis = sandbox;
      runNativeBridgeInContext(
        buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
        sandbox
      );
      await flushMicrotasks();
      (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
      const activeAbort = new AbortController();
      const queuedAbort = new AbortController();
      const activeFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/me",
        { signal: activeAbort.signal }
      );
      void activeFetch.catch(() => undefined);
      await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(1));
      const queuedFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/customers",
        { signal: queuedAbort.signal }
      );
      let queuedErrorCode: string | undefined;
      void queuedFetch.catch((error: Error & { code?: string }) => {
        queuedErrorCode = error.code;
      });
      const bridge = sandbox.SecPalNativeAuthBridge as {
        logout(): Promise<void>;
        setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
      };

      if (transition === "logout") {
        await bridge.logout();
      } else {
        await bridge.setRuntimeBootstrap(
          buildRuntimeBootstrapValue({
            apiOrigin: "https://other-api.secpal.dev",
            rawApiBaseUrl: "https://other-api.secpal.dev/v1",
          })
        );
      }
      await flushMicrotasks();

      expect(queuedErrorCode).toBe("SESSION_INVALIDATED");
      expect(plugin.request).toHaveBeenCalledTimes(1);
      expect(browserFetch).not.toHaveBeenCalled();
      activeAbort.abort();
      queuedAbort.abort();
      await Promise.allSettled([activeFetch, queuedFetch]);
    }
  );

  it.each(["password", "passkey"] as const)(
    "invalidates WebView-queued work before %s credential replacement starts",
    async (loginKind) => {
      let resolveLogin: ((value: { user: { id: number } }) => void) | undefined;
      const login = vi.fn(
        () =>
          new Promise<{ user: { id: number } }>((resolve) => {
            resolveLogin = resolve;
          })
      );
      const { bridge, browserFetch, plugin, sandbox } =
        await createNativeFetchSchedulerHarness({
          pluginOverrides:
            loginKind === "password" ? { login } : { loginWithPasskey: login },
        });
      const activeFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/me"
      );
      void activeFetch.catch(() => undefined);
      await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(1));
      const queuedFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/customers"
      );
      let queuedErrorCode: string | undefined;
      void queuedFetch.catch((error: Error & { code?: string }) => {
        queuedErrorCode = error.code;
      });

      const pendingLogin =
        loginKind === "password"
          ? bridge.login({
              email: "replacement@secpal.dev",
              password: "replacement-password",
            })
          : bridge.loginWithPasskey?.();
      await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
      await flushMicrotasks();

      expect(queuedErrorCode).toBe("SESSION_INVALIDATED");
      await expect(
        (sandbox.fetch as typeof fetch)("https://api.secpal.dev/v1/me")
      ).rejects.toMatchObject({ code: "SESSION_INVALIDATED" });
      expect(browserFetch).not.toHaveBeenCalled();

      resolveLogin?.({ user: { id: 8 } });
      await pendingLogin;
      await Promise.allSettled([activeFetch, queuedFetch]);
    }
  );

  it("invalidates WebView-queued work on background and does not resume it on foreground", async () => {
    const { browserFetch, listeners, plugin, sandbox } =
      await createNativeFetchSchedulerHarness();
    const activeFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me"
    );
    void activeFetch.catch(() => undefined);
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(1));
    const queuedFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/customers"
    );
    let queuedErrorCode: string | undefined;
    void queuedFetch.catch((error: Error & { code?: string }) => {
      queuedErrorCode = error.code;
    });
    const lifecycleListener = listeners.get("nativeAuthLifecycleChanged");

    expect(lifecycleListener).toBeTypeOf("function");
    lifecycleListener?.({ foreground: false });
    await flushMicrotasks();

    expect(queuedErrorCode).toBe("APP_BACKGROUNDED");
    await expect(
      (sandbox.fetch as typeof fetch)("https://api.secpal.dev/v1/me")
    ).rejects.toMatchObject({ code: "APP_BACKGROUNDED" });
    lifecycleListener?.({ foreground: true });
    const foregroundAbort = new AbortController();
    const foregroundFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me",
      { signal: foregroundAbort.signal }
    );
    void foregroundFetch.catch(() => undefined);
    await vi.waitFor(() => expect(plugin.request).toHaveBeenCalledTimes(2));

    expect(browserFetch).not.toHaveBeenCalled();
    foregroundAbort.abort();
    await Promise.allSettled([activeFetch, queuedFetch, foregroundFetch]);
  });

  it("rejects a native completion observed after the absolute WebView lifetime", async () => {
    let now = 0;
    let resolveNativeRequest:
      | ((response: {
          status: number;
          bodyBase64: string;
          contentType: string;
        }) => void)
      | undefined;
    class ControlledDate extends Date {
      static override now() {
        return now;
      }
    }
    const request = vi.fn(
      () =>
        new Promise<{
          status: number;
          bodyBase64: string;
          contentType: string;
        }>((resolve) => {
          resolveNativeRequest = resolve;
        })
    );
    const { sandbox } = await createNativeFetchSchedulerHarness({
      pluginOverrides: { request },
      sandboxOverrides: {
        Date: ControlledDate,
        setTimeout: vi.fn(() => 1),
        clearTimeout: vi.fn(),
      },
    });
    const pendingFetch = (sandbox.fetch as typeof fetch)(
      "https://api.secpal.dev/v1/me"
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    now = 30_001;
    resolveNativeRequest?.({
      status: 200,
      bodyBase64: encodeBase64('{"ok":true}'),
      contentType: "application/json",
    });

    await expect(pendingFetch).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
  });

  it("expires a small authenticated fetch while it waits in the WebView queue", async () => {
    vi.useFakeTimers();
    try {
      const { buildNativeAuthBridgeBootstrapScript } =
        await loadInjectorModule();
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
        cancelRequest: vi.fn().mockResolvedValue({ cancelled: true }),
        getRuntimeBootstrap: vi.fn().mockResolvedValue({
          configured: true,
          bootstrap: buildRuntimeBootstrapValue(),
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
        setTimeout,
        clearTimeout,
        btoa: (value: string) =>
          Buffer.from(value, "binary").toString("base64"),
        atob: (value: string) =>
          Buffer.from(value, "base64").toString("binary"),
        console,
        location: { href: "https://app.secpal.dev/" },
      } as Record<string, unknown>;
      sandbox.globalThis = sandbox;
      runNativeBridgeInContext(
        buildNativeAuthBridgeBootstrapScript("https://api.secpal.dev"),
        sandbox
      );
      await vi.advanceTimersByTimeAsync(0);
      (sandbox.__SecPalNativeAuthState as { active: boolean }).active = true;
      const activeAbort = new AbortController();
      const activeFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/customers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: new Uint8Array(1024 * 1024),
          signal: activeAbort.signal,
        }
      );
      void activeFetch.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(plugin.request).toHaveBeenCalledTimes(1);
      const queuedFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/me"
      );
      let queuedErrorCode: string | undefined;
      void queuedFetch.catch((error: Error & { code?: string }) => {
        queuedErrorCode = error.code;
      });
      const queuedWriteFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/customers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: new Uint8Array([2]),
        }
      );
      let queuedWriteErrorCode: string | undefined;
      void queuedWriteFetch.catch((error: Error & { code?: string }) => {
        queuedWriteErrorCode = error.code;
      });
      const oversizedLengthFetch = (sandbox.fetch as typeof fetch)(
        "https://api.secpal.dev/v1/customers",
        {
          method: "POST",
          headers: {
            "Content-Length": String(Number.MAX_SAFE_INTEGER),
            "Content-Type": "application/json",
          },
          body: new Uint8Array([3]),
        }
      );
      let oversizedLengthErrorCode: string | undefined;
      void oversizedLengthFetch.catch((error: Error & { code?: string }) => {
        oversizedLengthErrorCode = error.code;
      });

      await vi.advanceTimersByTimeAsync(30_000);

      expect(queuedErrorCode).toBe("REQUEST_TIMEOUT");
      expect(queuedWriteErrorCode).toBeUndefined();
      expect(plugin.request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_100);
      expect(queuedWriteErrorCode).toBe("REQUEST_TIMEOUT");
      expect(oversizedLengthErrorCode).toBeUndefined();
      await vi.advanceTimersByTimeAsync(191_899);
      expect(oversizedLengthErrorCode).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2);
      expect(oversizedLengthErrorCode).toBe("REQUEST_TIMEOUT");
      await Promise.allSettled([
        activeFetch,
        queuedFetch,
        queuedWriteFetch,
        oversizedLengthFetch,
      ]);
    } finally {
      vi.useRealTimers();
    }
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
    runNativeBridgeInContext(
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
    runNativeBridgeInContext(
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
    runNativeBridgeInContext(
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
    runNativeBridgeInContext(
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
    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

  async function createAndroidPushLifecycleSandbox(
    options: {
      includeResetUi?: boolean;
      legacyRetentionFailure?: Error;
      localStorage?: ReturnType<typeof createMockStorage>;
      sessionStorage?: ReturnType<typeof createMockStorage>;
      runtimeBootstrap?: ReturnType<typeof createCustomerAndroidPushBootstrap>;
    } = {}
  ) {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const runtimeBootstrap =
      options.runtimeBootstrap ?? createCustomerAndroidPushBootstrap();
    const browserFetch = vi.fn(
      async () => new Response("browser", { status: 200 })
    );
    const listeners: Record<
      string,
      Array<(payload: Record<string, unknown>) => void>
    > = {
      nativeAuthLifecycleChanged: [],
    };
    const handles: Array<{ remove: ReturnType<typeof vi.fn> }> = [];
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 7 }),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockResolvedValue({
        status: 200,
        bodyBase64: encodeBase64("{}"),
        contentType: "application/json",
      }),
      getAndroidPushRegistrationState: vi.fn().mockResolvedValue({
        state: "awaiting_auth",
        configured: true,
        retryable: false,
      }),
      retryAndroidPushRegistration: vi.fn().mockResolvedValue({
        state: "registered",
        configured: true,
        retryable: false,
      }),
      retainLegacyAndroidPushInstallation: vi.fn().mockResolvedValue(undefined),
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
    if (options.legacyRetentionFailure) {
      plugin.retainLegacyAndroidPushInstallation.mockRejectedValue(
        options.legacyRetentionFailure
      );
    }
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

    runNativeBridgeInContext(
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
        clearRuntimeBootstrap(): Promise<void>;
        getAndroidPushRegistrationState(): Promise<Record<string, unknown>>;
        retryAndroidPushRegistration(): Promise<Record<string, unknown>>;
      },
      browserFetch,
      document,
      handles,
      listeners,
      localStorage,
      plugin,
      sandbox,
      sessionStorage,
    };
  }

  it("retains legacy push identity natively before removing browser state", async () => {
    const legacyToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const legacyInstallationId = "11111111-1111-4111-8111-111111111111";
    const localStorage = createMockStorage({
      "secpal-android-push-token:https%3A%2F%2Fcustomer-api.example":
        legacyToken,
      "secpal-android-push-installation:https%3A%2F%2Fcustomer-api.example":
        legacyInstallationId,
    });
    const sessionStorage = createMockStorage({
      "secpal-android-push-token-app:https%3A%2F%2Fcustomer-api.example":
        "secpal-runtime-push",
      "secpal-android-push-token-saved-at:https%3A%2F%2Fcustomer-api.example":
        "2026-08-14T00:00:00Z",
    });

    const { bridge, plugin, sandbox } = await createAndroidPushLifecycleSandbox(
      { localStorage, sessionStorage }
    );

    expect(plugin.retainLegacyAndroidPushInstallation).toHaveBeenCalledOnce();
    expect(plugin.retainLegacyAndroidPushInstallation).toHaveBeenCalledWith({
      installationId: legacyInstallationId,
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(sandbox).not.toHaveProperty("__SecPalAndroidPushSyncState");
    expect(plugin.addListener).toHaveBeenCalledTimes(1);
    expect(plugin.addListener).toHaveBeenCalledWith(
      "nativeAuthLifecycleChanged",
      expect.any(Function)
    );

    const status = await bridge.getAndroidPushRegistrationState();
    expect(status).toEqual({
      state: "awaiting_auth",
      configured: true,
      retryable: false,
    });
    expect(JSON.stringify(status)).not.toContain(legacyToken);
    expect(JSON.stringify(status)).not.toContain(legacyInstallationId);
    expect(bridge).not.toHaveProperty("retainLegacyAndroidPushInstallation");
  });

  it("preserves the restored runtime when legacy push retention fails", async () => {
    const legacyInstallationId = "11111111-1111-4111-8111-111111111111";
    const localStorage = createMockStorage({
      "secpal-android-push-installation:https%3A%2F%2Fcustomer-api.example":
        legacyInstallationId,
      "tenant-cache": "customer-a",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(
        createCustomerAndroidPushBootstrap()
      ),
      "tenant-session": "customer-a-session",
    });

    const { plugin, sandbox } = await createAndroidPushLifecycleSandbox({
      legacyRetentionFailure: new Error("protected push storage unavailable"),
      localStorage,
      sessionStorage,
    });
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };

    expect(plugin.retainLegacyAndroidPushInstallation).toHaveBeenCalledOnce();
    expect(plugin.confirmRuntimeReset).not.toHaveBeenCalled();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(
      localStorage.getItem(
        "secpal-android-push-installation:https%3A%2F%2Fcustomer-api.example"
      )
    ).toBe(legacyInstallationId);
    expect(localStorage.getItem("tenant-cache")).toBe("customer-a");
    expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
  });

  it("exposes an intentional native retry without accepting identity input", async () => {
    const { bridge, plugin } = await createAndroidPushLifecycleSandbox();

    await expect(bridge.retryAndroidPushRegistration()).resolves.toEqual({
      state: "registered",
      configured: true,
      retryable: false,
    });
    expect(plugin.retryAndroidPushRegistration).toHaveBeenCalledOnce();
    expect(plugin.retryAndroidPushRegistration).toHaveBeenCalledWith();
  });

  it("fails fast when the packaged native push contract is incomplete", async () => {
    const { bridge, plugin } = await createAndroidPushLifecycleSandbox();

    Reflect.deleteProperty(plugin, "getAndroidPushRegistrationState");
    await expect(bridge.getAndroidPushRegistrationState()).rejects.toThrow(
      /not a function/i
    );

    Reflect.deleteProperty(plugin, "retryAndroidPushRegistration");
    await expect(bridge.retryAndroidPushRegistration()).rejects.toThrow(
      /not a function/i
    );
  });

  it("removes the native auth lifecycle listener when the WebView page is hidden", async () => {
    const { handles, sandbox } = await createAndroidPushLifecycleSandbox();

    expect(handles).toHaveLength(1);
    expect(handles[0]?.remove).not.toHaveBeenCalled();

    (sandbox.dispatchEvent as (event: { type: string }) => boolean)({
      type: "pagehide",
    });
    await flushMicrotasks();

    expect(handles[0]?.remove).toHaveBeenCalledOnce();
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

  it("dispatches a native logout event after the bridge completes logout", async () => {
    const { bridge, sandbox } = await createAndroidPushLifecycleSandbox();
    const logoutListener = vi.fn();

    (
      sandbox as {
        addEventListener(
          eventName: string,
          listener: (event: { type: string }) => void
        ): void;
      }
    ).addEventListener("secpal:native-auth-logout", (event) => {
      logoutListener(event);
    });

    await bridge.logout();
    await flushMicrotasks();

    expect(logoutListener).toHaveBeenCalledOnce();
    expect(logoutListener).toHaveBeenCalledWith(
      expect.objectContaining({ type: "secpal:native-auth-logout" })
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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

    runNativeBridgeInContext(
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
