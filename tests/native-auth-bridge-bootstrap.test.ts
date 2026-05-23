/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

class MockElement {
  id = "";
  className = "";
  textContent = "";
  value = "";
  disabled = false;
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
    this.children.push(child);
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

async function loadInjectorModule(): Promise<{
  buildNativeAuthBridgeBootstrapScript: (apiBaseUrl: string) => string;
  injectNativeAuthBridgeBootstrap: (html: string, apiBaseUrl: string) => string;
  readApiBaseUrlFromStringsXml: (stringsXml: string) => string;
}> {
  // @ts-expect-error The injector intentionally remains a Node-executable .mjs helper and is exercised directly here.
  return import("../scripts/inject-native-auth-bridge.mjs");
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

function createMockNavigation(initialHref: string) {
  const listeners = new Map<string, Array<() => void>>();
  const location = {
    href: initialHref,
    reload: vi.fn(),
  };
  const resolveHref = (nextUrl?: string | URL | null) => {
    if (nextUrl == null) {
      return location.href;
    }

    return new URL(String(nextUrl), location.href).toString();
  };

  return {
    location,
    addEventListener(eventName: string, listener: () => void) {
      const registeredListeners = listeners.get(eventName) ?? [];
      registeredListeners.push(listener);
      listeners.set(eventName, registeredListeners);
    },
    dispatchEvent(eventName: string) {
      for (const listener of listeners.get(eventName) ?? []) {
        listener();
      }
    },
    history: {
      pushState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
        location.href = resolveHref(url);
      }),
      replaceState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
        location.href = resolveHref(url);
      }),
    },
  };
}

const runtimeBootstrapPlaceholderOrigin =
  "https://runtime-bootstrap-required.secpal.dev";
const runtimeBootstrapStorageKey = "runtimeBootstrapState";

function buildRuntimeBootstrapValue(
  overrides: Partial<{
    instanceDisplayName: string;
    apiOrigin: string;
    rawApiBaseUrl: string;
    minimumSupportedAppVersion: string;
    minimumSupportedAppBuild: number;
    features: {
      passwordLoginEnabled: boolean;
      passkeyLoginEnabled: boolean;
      managedAndroidEnrollment: boolean;
    };
  }> = {}
) {
  return {
    instanceDisplayName: "Configured Example",
    apiOrigin: "https://api.secpal.dev",
    rawApiBaseUrl: "https://api.secpal.dev/v1",
    minimumSupportedAppVersion: "0.0.1",
    minimumSupportedAppBuild: 1,
    features: {
      passwordLoginEnabled: true,
      passkeyLoginEnabled: true,
      managedAndroidEnrollment: false,
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

  it("injects the bootstrap script before the first module script and stays idempotent", async () => {
    const { injectNativeAuthBridgeBootstrap } = await loadInjectorModule();
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

    expect(injectedHtml).toContain('id="secpal-native-auth-bridge-bootstrap"');
    expect(
      injectedHtml.indexOf('id="secpal-native-auth-bridge-bootstrap"')
    ).toBeLessThan(injectedHtml.indexOf('<script type="module"'));
    expect(
      injectNativeAuthBridgeBootstrap(injectedHtml, "https://api.secpal.dev")
    ).toBe(injectedHtml);
  });

  it("replaces an existing bootstrap script when reinjecting updated content", async () => {
    const { injectNativeAuthBridgeBootstrap } = await loadInjectorModule();
    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<script id="secpal-native-auth-bridge-bootstrap">window.__staleBootstrap = true;</script>',
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
    expect(reinjectedHtml).not.toContain("window.__staleBootstrap = true;");
    expect(
      reinjectedHtml.match(/id="secpal-native-auth-bridge-bootstrap"/g)
    ).toHaveLength(1);
  });

  it("renders a theme-aware translated discovery gate and persists locale changes", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const document = new MockDocument();
    const localStorage = createMockStorage({ "secpal-locale": "de" });
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
      document,
      localStorage,
      sessionStorage: createMockStorage(),
      navigator: { language: "de-DE" },
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const title = document.getElementById(
      "secpal-instance-discovery-title"
    ) as MockElement | null;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement | null;
    const localeSelect = document.getElementById(
      "secpal-instance-discovery-locale"
    ) as MockElement | null;
    const lightLogo = document.getElementById(
      "secpal-instance-discovery-logo-light"
    ) as MockElement | null;
    const darkLogo = document.getElementById(
      "secpal-instance-discovery-logo-dark"
    ) as MockElement | null;
    const footerPoweredLink = document.getElementById(
      "secpal-instance-discovery-footer-powered"
    ) as MockElement | null;
    const styles = document.getElementById(
      "secpal-instance-discovery-styles"
    ) as MockElement | null;
    const noteTitle = document.getElementById(
      "secpal-instance-discovery-note-title"
    ) as MockElement | null;
    const noteDescription = document.getElementById(
      "secpal-instance-discovery-note-description"
    ) as MockElement | null;

    expect(title?.textContent).toBe("Instanz-URL eingeben");
    expect(validateButton?.textContent).toBe("Instanz prüfen");
    expect(
      document.getElementById("secpal-instance-discovery-description")
        ?.textContent
    ).toBe(
      "Geben Sie die Instanz-URL ein, die Sie von Ihrem Vorgesetzten erhalten haben."
    );
    expect(noteTitle?.textContent).toBe("Noch keine Instanz-URL?");
    expect(noteDescription?.textContent).toBe(
      "Bitte wenden Sie sich an Ihren Vorgesetzten, um die Instanz-URL zu erhalten."
    );
    expect(document.documentElement.lang).toBe("de");
    expect(styles?.textContent).toContain(
      "@media (prefers-color-scheme: dark)"
    );
    expect(styles?.textContent).toContain("color-scheme: dark");
    expect(lightLogo?.attributes.src).toBe("/logo-light-48.png");
    expect(darkLogo?.attributes.src).toBe("/logo-dark-48.png");
    expect(footerPoweredLink?.textContent).toBe(
      "Powered by SecPal – Der beste Freund jeder Wache"
    );

    expect(localeSelect).not.toBeNull();
    localeSelect!.value = "en";
    localeSelect!.change();

    expect(title?.textContent).toBe("Enter your instance URL");
    expect(validateButton?.textContent).toBe("Check instance");
    expect(
      document.getElementById("secpal-instance-discovery-description")
        ?.textContent
    ).toBe("Enter the instance URL you received from your supervisor.");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("secpal-locale")).toBe("en");
    expect(footerPoweredLink?.textContent).toBe(
      "Powered by SecPal – A guard's best friend"
    );
  });

  it("keeps bootstrap initialization alive when locale persistence fails", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const document = new MockDocument();
    const localStorage = {
      getItem() {
        return "de";
      },
      setItem() {
        throw new Error("storage blocked");
      },
      removeItem() {
        // no-op
      },
      clear() {
        // no-op
      },
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
        },
      },
      document,
      localStorage,
      sessionStorage: createMockStorage(),
      navigator: { language: "de-DE" },
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    expect(() =>
      vm.runInNewContext(
        buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
        sandbox
      )
    ).not.toThrow();

    expect(document.documentElement.lang).toBe("de");
    expect(
      document.getElementById("secpal-instance-discovery-validate")?.textContent
    ).toBe("Instanz prüfen");
  });

  it("blocks native login until discovery validates a deployment and confirms the runtime bootstrap", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 7 }),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn().mockResolvedValue({
        status: 200,
        bodyBase64: encodeBase64('{"status":"ready"}'),
        contentType: "application/json",
      }),
      getRuntimeInfo: vi.fn().mockResolvedValue({
        clientPlatform: "android",
        appVersion: "0.0.1",
        appBuild: 1,
      }),
      setRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const browserFetch = vi.fn(async (input: Request | string | URL) => {
      const request =
        input instanceof Request ? input : new Request(String(input));
      const url = new URL(request.url);

      if (
        url.origin === "https://customer.example" &&
        url.pathname === "/v1/bootstrap"
      ) {
        return new Response(
          JSON.stringify({
            data: {
              client_platform: "android",
              api_base_url: "https://customer-api.example/v1",
              instance: {
                display_name: "Customer Example",
              },
              compatibility: {
                bootstrap_version: "v1",
                schema_version: 1,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: true,
                managed_android_enrollment: false,
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response('{"status":"ready"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const document = new MockDocument();
    const sessionStorage = createMockStorage();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
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
      location: {
        href: "https://app.secpal.dev/login",
        reload: vi.fn(),
      },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const bridge = sandbox.SecPalNativeAuthBridge as {
      login(credentials: { email: string; password: string }): Promise<unknown>;
    };

    await expect(
      bridge.login({ email: "worker@secpal.dev", password: "password123" })
    ).rejects.toThrow(/not configured/i);
    expect(plugin.login).not.toHaveBeenCalled();

    const input = document.getElementById(
      "secpal-instance-discovery-url"
    ) as MockElement | null;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement | null;
    const confirmButton = document.getElementById(
      "secpal-instance-discovery-confirm"
    ) as MockElement | null;
    const summary = document.getElementById(
      "secpal-instance-discovery-summary"
    ) as MockElement | null;

    expect(input).not.toBeNull();
    expect(validateButton).not.toBeNull();
    expect(confirmButton).not.toBeNull();
    expect(summary).not.toBeNull();

    input!.value = "https://customer.example";
    validateButton!.click();
    await flushMicrotasks();

    expect(plugin.getRuntimeInfo).toHaveBeenCalledOnce();
    expect(browserFetch).toHaveBeenCalledOnce();
    expect(
      (browserFetch.mock.calls[0]?.[0] as Request).headers.get(
        "Accept-Language"
      )
    ).toBe("en");
    expect(summary?.children[1]?.textContent).toBe(
      "Instance: Customer Example"
    );
    expect(confirmButton?.disabled).toBe(false);

    confirmButton!.click();
    await flushMicrotasks();

    expect(plugin.setRuntimeBootstrap).toHaveBeenCalledWith({
      instanceDisplayName: "Customer Example",
      apiOrigin: "https://customer-api.example",
      rawApiBaseUrl: "https://customer-api.example/v1",
      minimumSupportedAppVersion: "0.0.1",
      minimumSupportedAppBuild: 1,
      features: {
        passwordLoginEnabled: true,
        passkeyLoginEnabled: true,
        managedAndroidEnrollment: false,
      },
    });
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();

    await (sandbox.fetch as typeof fetch)(
      `${runtimeBootstrapPlaceholderOrigin}/health/ready`
    );

    const rewrittenRequest = browserFetch.mock.calls.at(-1)?.[0] as Request;
    expect(rewrittenRequest.url).toBe(
      "https://customer-api.example/health/ready"
    );
  });

  it("restores a persisted runtime bootstrap from the native plugin on startup", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue({
          instanceDisplayName: "Customer Example",
          apiOrigin: "https://customer-api.example",
          rawApiBaseUrl: "https://customer-api.example/v1",
        }),
      }),
    };
    const document = new MockDocument();
    const browserFetch = vi.fn(async (input: Request | string | URL) => {
      const request =
        input instanceof Request ? input : new Request(String(input));

      return new Response(request.url, { status: 200 });
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
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
      location: { href: "https://app.secpal.dev/login" },
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
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(plugin.getRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();

    const response = await (sandbox.fetch as typeof fetch)(
      `${runtimeBootstrapPlaceholderOrigin}/health/ready`
    );

    const rewrittenRequest = browserFetch.mock.calls.at(-1)?.[0] as Request;
    expect(rewrittenRequest.url).toBe(
      "https://customer-api.example/health/ready"
    );
    await expect(response.text()).resolves.toBe(
      "https://customer-api.example/health/ready"
    );
  });

  it("offers a destructive instance-switch reset on the login page and clears tenant-scoped browser state", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue(),
      }),
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(["runtime-cache", "offline-cache"]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const deletedDatabases: string[] = [];
    const indexedDB = {
      databases: vi
        .fn()
        .mockResolvedValue([
          { name: "secpal-offline-vault" },
          { name: "tenant-cache-db" },
        ]),
      deleteDatabase: vi.fn((name: string) => {
        deletedDatabases.push(name);

        const request: {
          onsuccess?: () => void;
          onerror?: () => void;
          onblocked?: () => void;
        } = {};

        setTimeout(() => {
          request.onsuccess?.();
        }, 0);

        return request;
      }),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage({
      "secpal-locale": "de",
      auth_vault_state: "encrypted-user-state",
      auth_vault_lock: "1",
      "tenant-cache": "customer-a",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const confirm = vi.fn().mockReturnValue(true);
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage,
      caches: cacheStorage,
      indexedDB,
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
      confirm,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeResetSummary = document.getElementById(
      "secpal-instance-reset-summary"
    ) as MockElement | null;
    const runtimeResetButton = document.getElementById(
      "secpal-instance-reset-button"
    ) as MockElement | null;

    expect(runtimeResetSummary?.textContent).toContain("Configured Example");
    expect(runtimeResetButton).not.toBeNull();

    runtimeResetButton!.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(confirm).toHaveBeenCalledOnce();
    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(localStorage.getItem("auth_vault_state")).toBeNull();
    expect(localStorage.getItem("auth_vault_lock")).toBeNull();
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
    expect(cacheStorage.keys).toHaveBeenCalledOnce();
    expect(cacheStorage.delete).toHaveBeenCalledWith("runtime-cache");
    expect(cacheStorage.delete).toHaveBeenCalledWith("offline-cache");
    expect(indexedDB.databases).toHaveBeenCalledOnce();
    expect(deletedDatabases).toEqual([
      "secpal-offline-vault",
      "tenant-cache-db",
    ]);
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it("does not clear the configured runtime when the destructive instance-switch reset is cancelled", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue(),
      }),
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage({
      "secpal-locale": "en",
      auth_vault_state: "encrypted-user-state",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const confirm = vi.fn().mockReturnValue(false);
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
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
      console,
      confirm,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeResetButton = document.getElementById(
      "secpal-instance-reset-button"
    ) as MockElement | null;

    expect(runtimeResetButton).not.toBeNull();

    runtimeResetButton!.click();
    await flushMicrotasks();

    expect(confirm).toHaveBeenCalledOnce();
    expect(plugin.logout).not.toHaveBeenCalled();
    expect(plugin.clearRuntimeBootstrap).not.toHaveBeenCalled();
    expect(localStorage.getItem("auth_vault_state")).toBe(
      "encrypted-user-state"
    );
    expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).not.toHaveBeenCalled();
  });

  it("keeps the configured runtime when native reset persistence fails", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue(),
      }),
      clearRuntimeBootstrap: vi.fn().mockRejectedValue({
        code: "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED",
      }),
    };
    const document = new MockDocument();
    const localStorage = createMockStorage({
      "secpal-locale": "en",
      auth_vault_state: "encrypted-user-state",
      "tenant-cache": "customer-a",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const confirm = vi.fn().mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
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
      console,
      confirm,
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    try {
      vm.runInNewContext(
        buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
        sandbox
      );

      await flushMicrotasks();

      const runtimeResetButton = document.getElementById(
        "secpal-instance-reset-button"
      ) as MockElement | null;

      expect(runtimeResetButton).not.toBeNull();

      runtimeResetButton!.click();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(confirm).toHaveBeenCalledOnce();
      expect(plugin.logout).toHaveBeenCalledOnce();
      expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
      expect(localStorage.getItem("auth_vault_state")).toBe("encrypted-user-state");
      expect(localStorage.getItem("tenant-cache")).toBe("customer-a");
      expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).not.toBeNull();
      expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
      expect(
        (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
      ).not.toHaveBeenCalled();
      expect(document.getElementById("secpal-instance-reset-button")).not.toBeNull();
      expect(warn).toHaveBeenCalledWith(
        "Failed to reset the configured SecPal runtime.",
        expect.objectContaining({
          code: "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED",
        })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("updates the destructive instance-switch reset entry on SPA route changes", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        bootstrap: buildRuntimeBootstrapValue(),
      }),
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const navigation = createMockNavigation("https://app.secpal.dev/");
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      sessionStorage: createMockStorage({
        [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      }),
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
      location: navigation.location,
      history: navigation.history,
      addEventListener: navigation.addEventListener,
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    expect(document.getElementById("secpal-instance-reset-entry")).toBeNull();

    navigation.history.pushState({}, "", "/login");
    await flushMicrotasks();

    expect(document.getElementById("secpal-instance-reset-entry")).not.toBeNull();

    navigation.history.replaceState({}, "", "/");
    await flushMicrotasks();

    expect(document.getElementById("secpal-instance-reset-entry")).toBeNull();

    navigation.location.href = "https://app.secpal.dev/login";
    navigation.dispatchEvent("popstate");
    await flushMicrotasks();

    expect(document.getElementById("secpal-instance-reset-entry")).not.toBeNull();
  });

  it("restores a legacy configured API origin from the native plugin on startup", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        apiOrigin: "https://customer-api.example",
      }),
    };
    const document = new MockDocument();
    const browserFetch = vi.fn(async (input: Request | string | URL) => {
      const request =
        input instanceof Request ? input : new Request(String(input));

      return new Response(request.url, { status: 200 });
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      bootstrap: unknown;
      apiOrigin: string | null;
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(plugin.getRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.bootstrap).toBeNull();
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();

    const response = await (sandbox.fetch as typeof fetch)(
      `${runtimeBootstrapPlaceholderOrigin}/health/ready`
    );

    const rewrittenRequest = browserFetch.mock.calls.at(-1)?.[0] as Request;
    expect(rewrittenRequest.url).toBe(
      "https://customer-api.example/health/ready"
    );
    await expect(response.text()).resolves.toBe(
      "https://customer-api.example/health/ready"
    );
  });

  it("mounts the discovery gate when the native plugin throws synchronously during bootstrap restore", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const document = new MockDocument();

    // Plugin is present for bridge setup but getRuntimeBootstrap throws synchronously,
    // simulating a plugin proxy that is not fully initialized at restore time.
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
    };

    // Intercept the plugin object so that accessing getRuntimeBootstrap throws.
    const pluginProxy = new Proxy(plugin, {
      get(target, prop) {
        if (prop === "getRuntimeBootstrap") {
          throw new Error("Plugin not ready");
        }
        return (target as Record<string | symbol, unknown>)[prop as string];
      },
    });
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: pluginProxy } },
      document,
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    expect(() => {
      vm.runInNewContext(
        buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
        sandbox
      );
    }).not.toThrow();

    await flushMicrotasks();

    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
    expect(sandbox.__SecPalNativeAuthBootstrapInstalled).toBe(true);
  });

  it("reopens discovery when native bootstrap restore cleanup fails", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const warn = vi.fn();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi
        .fn()
        .mockRejectedValue(new Error("native bridge unavailable")),
      clearRuntimeBootstrap: vi.fn().mockRejectedValue({
        code: "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED",
      }),
    };
    const document = new MockDocument();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
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
      console: { ...console, warn },
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      bootstrap: unknown;
      apiOrigin: string | null;
      pendingBootstrap: unknown;
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(plugin.getRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.bootstrap).toBeNull();
    expect(runtimeState.apiOrigin).toBeNull();
    expect(runtimeState.pendingBootstrap).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Failed to restore persisted SecPal bootstrap.",
      expect.any(Error)
    );
  });

  it("shows a hard failure for insecure instance URLs before any bootstrap fetch", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const browserFetch = vi.fn();
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
            getRuntimeInfo: vi.fn().mockResolvedValue({
              clientPlatform: "android",
              appVersion: "0.0.1",
              appBuild: 1,
            }),
          },
        },
      },
      document,
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const input = document.getElementById(
      "secpal-instance-discovery-url"
    ) as MockElement;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement;
    const error = document.getElementById(
      "secpal-instance-discovery-error"
    ) as MockElement;

    input.value = "http://customer.example";
    validateButton.click();
    await flushMicrotasks();

    expect(browserFetch).not.toHaveBeenCalled();
    expect(error.textContent).toMatch(/https/i);
    expect(error.textContent).toMatch(/secure/i);
  });

  it("rejects discovery URLs that smuggle userinfo or extra URL parts", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const browserFetch = vi.fn();
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
            getRuntimeInfo: vi.fn().mockResolvedValue({
              clientPlatform: "android",
              appVersion: "0.0.1",
              appBuild: 1,
            }),
          },
        },
      },
      document,
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const input = document.getElementById(
      "secpal-instance-discovery-url"
    ) as MockElement;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement;
    const error = document.getElementById(
      "secpal-instance-discovery-error"
    ) as MockElement;

    input.value = "https://customer.example@evil.example/path?tenant=1#frag";
    validateButton.click();
    await flushMicrotasks();

    expect(browserFetch).not.toHaveBeenCalled();
    expect(error.textContent).toMatch(/valid/i);
    expect(error.textContent).toMatch(/https/i);
  });

  it("surfaces unreachable bootstrap targets as actionable discovery errors", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const browserFetch = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
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
            getRuntimeInfo: vi.fn().mockResolvedValue({
              clientPlatform: "android",
              appVersion: "0.0.1",
              appBuild: 1,
            }),
          },
        },
      },
      document,
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const input = document.getElementById(
      "secpal-instance-discovery-url"
    ) as MockElement;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement;
    const error = document.getElementById(
      "secpal-instance-discovery-error"
    ) as MockElement;

    input.value = "https://customer.example";
    validateButton.click();
    await flushMicrotasks();

    expect(error.textContent).toMatch(/reach/i);
    expect(error.textContent).toMatch(/url|supervisor/i);
  });

  it("rejects incompatible bootstrap payloads before confirming the deployment", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const browserFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            client_platform: "android",
            api_base_url: "https://customer-api.example/v1",
            instance: {
              display_name: "Customer Example",
            },
            compatibility: {
              bootstrap_version: "v2",
              schema_version: 2,
              minimum_supported_app_version: "0.0.1",
              minimum_supported_app_build: 1,
            },
            features: {
              password_login: true,
              passkey_login: true,
              managed_android_enrollment: false,
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
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
            getRuntimeInfo: vi.fn().mockResolvedValue({
              clientPlatform: "android",
              appVersion: "0.0.1",
              appBuild: 1,
            }),
          },
        },
      },
      document,
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
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const input = document.getElementById(
      "secpal-instance-discovery-url"
    ) as MockElement;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement;
    const confirmButton = document.getElementById(
      "secpal-instance-discovery-confirm"
    ) as MockElement;
    const error = document.getElementById(
      "secpal-instance-discovery-error"
    ) as MockElement;

    input.value = "https://customer.example";
    validateButton.click();
    await flushMicrotasks();

    expect(error.textContent).toMatch(/verified|administrator/i);
    expect(confirmButton.disabled).toBe(true);
  });

  it("installs the native bridge and routes authenticated /v1/ fetch traffic through the native plugin", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      loginWithPasskey: vi.fn().mockResolvedValue({ user: { id: 7 } }),
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
    };
    const browserFetch = vi
      .fn()
      .mockResolvedValue(new Response("browser", { status: 200 }));

    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage({
        [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      }),
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
      loginWithPasskey?(): Promise<unknown>;
      createPasskeyAttestation?(options: {
        challenge: string;
        rp: { id: string; name: string };
        user: { id: string; name: string; display_name: string };
        pub_key_cred_params: Array<{ type: "public-key"; alg: number }>;
      }): Promise<unknown>;
      isVaultDeviceBoundWrapperAvailable?(): Promise<boolean>;
      wrapVaultRootKey?(options: {
        rootKeyBase64: string;
        subjectHash: string;
      }): Promise<{ wrappedRootKey: string; metadata?: string }>;
      unwrapVaultRootKey?(options: {
        wrappedRootKey: string;
        subjectHash: string;
        metadata?: string;
      }): Promise<{ rootKeyBase64: string }>;
    };

    await bridge.login({ email: "worker@secpal.dev", password: "password123" });
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
    await expect(bridge.isVaultDeviceBoundWrapperAvailable?.()).resolves.toBe(
      true
    );
    await expect(
      bridge.wrapVaultRootKey?.({
        rootKeyBase64: "cm9vdC1rZXk=",
        subjectHash: "subject-hash",
      })
    ).resolves.toEqual({ wrappedRootKey: "wrapped-root-key" });
    await expect(
      bridge.unwrapVaultRootKey?.({
        wrappedRootKey: "wrapped-root-key",
        subjectHash: "subject-hash",
      })
    ).resolves.toEqual({ rootKeyBase64: "cm9vdC1rZXk=" });

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
    expect(plugin.isVaultDeviceBoundWrapperAvailable).toHaveBeenCalledOnce();
    expect(plugin.wrapVaultRootKey).toHaveBeenCalledWith({
      rootKeyBase64: "cm9vdC1rZXk=",
      subjectHash: "subject-hash",
    });
    expect(plugin.unwrapVaultRootKey).toHaveBeenCalledWith({
      wrappedRootKey: "wrapped-root-key",
      subjectHash: "subject-hash",
      metadata: undefined,
    });
    expect(plugin.request).toHaveBeenCalledWith({
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

  it("exposes an enterprise bridge for managed-state reads and gesture-navigation settings", async () => {
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
        distributionState: {
          bootstrapStatus: "completed",
          updateChannel: "managed_device",
          releaseMetadataUrl:
            "https://apk.secpal.app/android/channels/managed_device/latest.json",
          bootstrapLastErrorCode: null,
        },
        allowedApps: [],
      }),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
      openGestureNavigationSettings: vi.fn().mockResolvedValue({
        opened: true,
        gestureNavigationEnabled: false,
        willReenterLockTaskOnResume: true,
      }),
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
      openGestureNavigationSettings(): Promise<unknown>;
    };

    await expect(bridge.getManagedState()).resolves.toEqual({
      managed: true,
      mode: "device_owner",
      kioskActive: true,
      lockTaskEnabled: true,
      gestureNavigationEnabled: false,
      gestureNavigationSettingsAvailable: true,
      allowPhone: true,
      allowSms: true,
      distributionState: {
        bootstrapStatus: "completed",
        updateChannel: "managed_device",
        releaseMetadataUrl:
          "https://apk.secpal.app/android/channels/managed_device/latest.json",
        bootstrapLastErrorCode: null,
      },
      allowedApps: [],
    });
    await expect(bridge.openGestureNavigationSettings()).resolves.toEqual({
      opened: true,
      gestureNavigationEnabled: false,
      willReenterLockTaskOnResume: true,
    });
    expect(enterprisePlugin.getManagedState).toHaveBeenCalledOnce();
    expect(
      enterprisePlugin.openGestureNavigationSettings
    ).toHaveBeenCalledOnce();
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

    expect(plugin.request).not.toHaveBeenCalled();
    expect(browserFetch).toHaveBeenCalledOnce();
    await expect(response.text()).resolves.toBe('{"status":"ready"}');
  });

  it("reopens discovery when restoring a persisted bootstrap fails in the native runtime", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      setApiBaseUrl: vi
        .fn()
        .mockRejectedValue(new Error("native bridge unavailable")),
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

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(runtimeState.configured).toBe(false);
    expect(plugin.setApiBaseUrl).toHaveBeenCalledWith({
      apiBaseUrl: "https://api.secpal.dev",
    });
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
  });

  it("reopens discovery when native cleanup fails after setApiBaseUrl restore errors", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const warn = vi.fn();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      setApiBaseUrl: vi
        .fn()
        .mockRejectedValue(new Error("native bridge unavailable")),
      clearRuntimeBootstrap: vi.fn().mockRejectedValue({
        code: "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED",
      }),
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
      console: { ...console, warn },
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      bootstrap: unknown;
      apiOrigin: string | null;
      pendingBootstrap: unknown;
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(plugin.setApiBaseUrl).toHaveBeenCalledWith({
      apiBaseUrl: "https://api.secpal.dev",
    });
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.bootstrap).toBeNull();
    expect(runtimeState.apiOrigin).toBeNull();
    expect(runtimeState.pendingBootstrap).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Failed to restore persisted SecPal bootstrap.",
      expect.any(Error)
    );
  });

  it("reopens discovery when persisted bootstrap cleanup hits storage errors", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      setApiBaseUrl: vi
        .fn()
        .mockRejectedValue(new Error("native bridge unavailable")),
    };
    const document = new MockDocument();
    const baseStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
    });
    const sessionStorage = {
      ...baseStorage,
      removeItem: vi.fn(() => {
        throw new Error("Storage disabled");
      }),
    };
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

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(runtimeState.configured).toBe(false);
    expect(plugin.setApiBaseUrl).toHaveBeenCalledWith({
      apiBaseUrl: "https://api.secpal.dev",
    });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      runtimeBootstrapStorageKey
    );
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
  });

  it("removes the discovery gate after restoring a persisted bootstrap", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    let resolveSetApiBaseUrl!: (value: unknown) => void;
    const setApiBaseUrlPromise = new Promise((resolve) => {
      resolveSetApiBaseUrl = resolve;
    });
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      setApiBaseUrl: vi.fn().mockReturnValue(setApiBaseUrlPromise),
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
      console,
      location: { href: "https://app.secpal.dev/login" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      nativeConfigPromise: Promise<void>;
    };

    expect(runtimeState.configured).toBe(false);
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();

    resolveSetApiBaseUrl({ apiBaseUrl: "https://api.secpal.dev" });
    await flushMicrotasks();

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(runtimeState.configured).toBe(true);
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();
  });

  it("blocks logout when the runtime bootstrap restore failed", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      setApiBaseUrl: vi
        .fn()
        .mockRejectedValue(new Error("native bridge unavailable")),
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
          },
          SecPalEnterprise: enterprisePlugin,
        },
      },
      document,
      sessionStorage: createMockStorage({
        [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      }),
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
        distributionState: {
          bootstrapStatus: "pending",
          updateChannel: null,
          releaseMetadataUrl: null,
          bootstrapLastErrorCode: null,
        },
        allowedApps: [],
      }),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
      openGestureNavigationSettings: vi.fn().mockResolvedValue({
        opened: true,
        gestureNavigationEnabled: true,
        willReenterLockTaskOnResume: true,
      }),
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
      distributionState: {
        bootstrapStatus: "pending",
        updateChannel: null,
        releaseMetadataUrl: null,
        bootstrapLastErrorCode: null,
      },
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
        distributionState: {
          bootstrapStatus: "failed",
          updateChannel: null,
          releaseMetadataUrl: null,
          bootstrapLastErrorCode: "TOKEN_STORAGE_UNAVAILABLE",
        },
        allowedApps: [],
      }),
      launchPhone: vi.fn().mockResolvedValue(undefined),
      launchSms: vi.fn().mockResolvedValue(undefined),
      launchAllowedApp: vi.fn().mockResolvedValue(undefined),
      openGestureNavigationSettings: vi.fn().mockResolvedValue({
        opened: true,
        gestureNavigationEnabled: false,
        willReenterLockTaskOnResume: true,
      }),
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
      distributionState: {
        bootstrapStatus: "failed",
        updateChannel: null,
        releaseMetadataUrl: null,
        bootstrapLastErrorCode: "TOKEN_STORAGE_UNAVAILABLE",
      },
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
    };
    const browserFetch = vi
      .fn()
      .mockResolvedValue(new Response("browser", { status: 200 }));

    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      sessionStorage: createMockStorage({
        [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      }),
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

  it("does not mark runtime as configured until setApiBaseUrl resolves during bootstrap confirmation", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    let resolveSetApiBaseUrl!: (value: unknown) => void;
    const setApiBaseUrlPromise = new Promise((resolve) => {
      resolveSetApiBaseUrl = resolve;
    });
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
      setApiBaseUrl: vi.fn().mockReturnValue(setApiBaseUrlPromise),
    };
    const browserFetch = vi.fn(async (input: Request | string | URL) => {
      const request =
        input instanceof Request ? input : new Request(String(input));
      const url = new URL(request.url);
      if (url.pathname === "/v1/bootstrap") {
        return new Response(
          JSON.stringify({
            data: {
              client_platform: "android",
              api_base_url: "https://customer-api.example/v1",
              instance: { display_name: "Customer Example" },
              compatibility: {
                bootstrap_version: "v1",
                schema_version: 1,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: false,
                managed_android_enrollment: false,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("browser", { status: 200 });
    });
    const document = new MockDocument();
    const sessionStorage = createMockStorage();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
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
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };

    const input = document.getElementById(
      "secpal-instance-discovery-url"
    ) as MockElement | null;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement | null;
    const confirmButton = document.getElementById(
      "secpal-instance-discovery-confirm"
    ) as MockElement | null;

    input!.value = "https://customer.example";
    validateButton!.click();
    await flushMicrotasks();

    confirmButton!.click();
    await flushMicrotasks(2);

    expect(plugin.setApiBaseUrl).toHaveBeenCalledWith({
      apiBaseUrl: "https://customer-api.example",
    });
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();

    resolveSetApiBaseUrl({ apiBaseUrl: "https://customer-api.example" });
    await flushMicrotasks();

    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toContain(
      "Customer Example"
    );
  });

  it("keeps bootstrap confirmation successful when sessionStorage persistence fails", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
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
      setApiBaseUrl: vi.fn().mockResolvedValue({
        apiBaseUrl: "https://customer-api.example",
      }),
    };
    const browserFetch = vi.fn(async (input: Request | string | URL) => {
      const request =
        input instanceof Request ? input : new Request(String(input));
      const url = new URL(request.url);
      if (url.pathname === "/v1/bootstrap") {
        return new Response(
          JSON.stringify({
            data: {
              client_platform: "android",
              api_base_url: "https://customer-api.example/v1",
              instance: { display_name: "Customer Example" },
              compatibility: {
                bootstrap_version: "v1",
                schema_version: 1,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: false,
                managed_android_enrollment: false,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("browser", { status: 200 });
    });
    const document = new MockDocument();
    const baseStorage = createMockStorage();
    const sessionStorage = {
      ...baseStorage,
      setItem: vi.fn(() => {
        throw new Error("Storage disabled");
      }),
    };
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
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
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
    };
    const input = document.getElementById(
      "secpal-instance-discovery-url"
    ) as MockElement | null;
    const validateButton = document.getElementById(
      "secpal-instance-discovery-validate"
    ) as MockElement | null;
    const confirmButton = document.getElementById(
      "secpal-instance-discovery-confirm"
    ) as MockElement | null;

    input!.value = "https://customer.example";
    validateButton!.click();
    await flushMicrotasks();

    confirmButton!.click();
    await flushMicrotasks();

    expect(plugin.setApiBaseUrl).toHaveBeenCalledWith({
      apiBaseUrl: "https://customer-api.example",
    });
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      runtimeBootstrapStorageKey,
      expect.stringContaining("Customer Example")
    );
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();
    expect(baseStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
  });
});
