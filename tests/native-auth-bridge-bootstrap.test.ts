/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

/// <reference types="node" />
/// <reference lib="dom" />

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const CANONICAL_API_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DEFAULT_ATTRIBUTION_TERMS_URL =
  "https://github.com/SecPal/android/blob/main/LICENSES/LicenseRef-SecPal-Attribution.txt";

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
      pushState: vi.fn(
        (_state: unknown, _unused: string, url?: string | URL | null) => {
          location.href = resolveHref(url);
        }
      ),
      replaceState: vi.fn(
        (_state: unknown, _unused: string, url?: string | URL | null) => {
          location.href = resolveHref(url);
        }
      ),
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
    androidPush: null,
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
    const footerLicenseLink = document.getElementById(
      "secpal-instance-discovery-footer-license"
    ) as MockElement | null;
    const footerAttributionLink = document.getElementById(
      "secpal-instance-discovery-footer-attribution"
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
      "Powered by SecPal – A guard's best friend"
    );
    expect(footerPoweredLink?.attributes.href).toBe("https://secpal.app");
    expect(footerLicenseLink?.textContent).toBe("AGPL v3+");
    expect(footerLicenseLink?.attributes.href).toBe(
      "https://www.gnu.org/licenses/agpl-3.0.html"
    );
    expect(footerAttributionLink?.textContent).toBe("Attributionsbedingungen");
    expect(footerAttributionLink?.attributes.href).toBe(
      DEFAULT_ATTRIBUTION_TERMS_URL
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
    expect(footerPoweredLink?.attributes.href).toBe("https://secpal.app");
    expect(footerLicenseLink?.textContent).toBe("AGPL v3+");
    expect(footerLicenseLink?.attributes.href).toBe(
      "https://www.gnu.org/licenses/agpl-3.0.html"
    );
    expect(footerAttributionLink?.textContent).toBe("Attribution terms");
    expect(footerAttributionLink?.attributes.href).toBe(
      DEFAULT_ATTRIBUTION_TERMS_URL
    );

    localeSelect!.value = "de";
    localeSelect!.change();
    expect(footerLicenseLink?.textContent).toBe("AGPL v3+");
    expect(footerAttributionLink?.textContent).toBe("Attributionsbedingungen");
  });

  it("uses a configured attribution terms URL without breaking the injected bootstrap script", async () => {
    const configuredAttributionTermsUrl =
      "https://example.com/terms?</script><script>globalThis.__broken = true</script>";
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule({
      attributionTermsUrl: configuredAttributionTermsUrl,
    });
    const script = buildNativeAuthBridgeBootstrapScript(
      runtimeBootstrapPlaceholderOrigin
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
          },
        },
      },
      document,
      localStorage: createMockStorage(),
      sessionStorage: createMockStorage(),
      navigator: { language: "en-US" },
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

    expect(script).not.toContain("</script><script>");

    expect(() => vm.runInNewContext(script, sandbox)).not.toThrow();

    const footerAttributionLink = document.getElementById(
      "secpal-instance-discovery-footer-attribution"
    ) as MockElement | null;

    expect(footerAttributionLink?.attributes.href).toBe(
      configuredAttributionTermsUrl
    );
    expect((sandbox as { __broken?: boolean }).__broken).toBeUndefined();
  });

  it("escapes script end tags with whitespace in configured attribution URLs", async () => {
    const configuredAttributionTermsUrl =
      "https://example.com/terms?</script ><script>globalThis.__brokenWhitespace = true</script>";
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule({
      attributionTermsUrl: configuredAttributionTermsUrl,
    });
    const script = buildNativeAuthBridgeBootstrapScript(
      runtimeBootstrapPlaceholderOrigin
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
          },
        },
      },
      document,
      localStorage: createMockStorage(),
      sessionStorage: createMockStorage(),
      navigator: { language: "en-US" },
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

    expect(script).not.toContain("</script ><script>");

    expect(() => vm.runInNewContext(script, sandbox)).not.toThrow();

    const footerAttributionLink = document.getElementById(
      "secpal-instance-discovery-footer-attribution"
    ) as MockElement | null;

    expect(footerAttributionLink?.attributes.href).toBe(
      configuredAttributionTermsUrl
    );
    expect(
      (sandbox as { __brokenWhitespace?: boolean }).__brokenWhitespace
    ).toBeUndefined();
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
                schema_version: 3,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: true,
                managed_android_enrollment: false,
                notification_channels: {
                  android_fcm: true,
                  web_push: false,
                },
              },
              notification_channels: {
                android_fcm: {
                  channel: "android_fcm",
                  metadata_revision: 3,
                  public_runtime_metadata: {
                    api_key: "public-client-api-key-demo-1234567890",
                    project_id: "secpal-demo-push",
                    application_id: "1:1234567890:android:abcdef1234567890",
                    sender_id: "1234567890",
                  },
                },
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

  it("keeps runtime bootstrap confirmation working when the deployment disables Android push", async () => {
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
                schema_version: 3,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: true,
                managed_android_enrollment: false,
                notification_channels: {
                  android_fcm: false,
                  web_push: false,
                },
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
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
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

  it("clears incompatible native-device-bound offline vault state before restoring the runtime bootstrap", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn(),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
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
    const localStorage = createMockStorage({
      "secpal-locale": "de",
      auth_vault_state: JSON.stringify({
        wrapper: {
          kind: "native-device-bound",
        },
        encryptedRootKey: "wrapped-root-key",
      }),
      auth_vault_lock: "locked",
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

    await flushMicrotasks();
    await flushMicrotasks();

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      apiOrigin: string | null;
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(plugin.getRuntimeBootstrap).not.toHaveBeenCalled();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(localStorage.getItem("auth_vault_state")).toBeNull();
    expect(localStorage.getItem("auth_vault_lock")).toBeNull();
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
  });

  it("restores persisted Android push metadata without relying on a stored feature flag", async () => {
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
        }),
      }),
    };
    const document = new MockDocument();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
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

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      bootstrap: {
        androidPush?: {
          provider: string;
          metadataRevision: number;
          publicClientMetadata: {
            apiKey: string;
            projectId: string;
            applicationId: string;
            senderId: string;
          };
        };
      } | null;
      nativeConfigPromise: Promise<void>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.bootstrap?.androidPush).toEqual({
      provider: "fcm",
      metadataRevision: 3,
      publicClientMetadata: {
        apiKey: "public-client-api-key-demo-1234567890",
        projectId: "secpal-demo-push",
        applicationId: "1:1234567890:android:abcdef1234567890",
        senderId: "1234567890",
      },
    });
  });

  it("reopens discovery when the native plugin only returns a legacy api origin", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: vi.fn(),
      getCurrentUser: vi.fn(),
      isNetworkAvailable: vi.fn().mockResolvedValue({ available: true }),
      request: vi.fn(),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: true,
        apiOrigin: "https://api.secpal.dev",
      }),
    };
    const document = new MockDocument();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
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
    const bridge = sandbox.SecPalNativeAuthBridge as {
      login(credentials: { email: string; password: string }): Promise<unknown>;
    };

    await expect(runtimeState.nativeConfigPromise).resolves.toBeUndefined();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
    await expect(
      bridge.login({ email: "worker@secpal.dev", password: "password123" })
    ).rejects.toThrow(/not configured/i);
    expect(plugin.login).not.toHaveBeenCalled();
  });

  it("shows the configured instance action below the passkey button and clears the instance after confirmation", async () => {
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
    const { form, passkeyButton, sloganLink } = appendMockLoginFooter(document);
    const localStorage = createMockStorage({
      "secpal-locale": "de",
      auth_vault_state: "encrypted-user-state",
      auth_vault_lock: "locked",
      "tenant-cache": "customer-a-cache",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const confirm = vi.fn().mockReturnValue(true);
    const reload = vi.fn();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage,
      caches: cacheStorage,
      indexedDB,
      confirm,
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
      location: { href: "https://app.secpal.dev/login", reload },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeInfoEntry = document.getElementById(
      "secpal-instance-runtime-info"
    ) as MockElement | null;
    const runtimeInfoSummary = document.getElementById(
      "secpal-instance-runtime-summary"
    ) as MockElement | null;

    expect(sloganLink.textContent).toBe(
      "Powered by SecPal – A guard's best friend"
    );
    expect(runtimeInfoSummary?.textContent).toBe(
      "Instanz: Configured Example · https://api.secpal.dev"
    );
    expect(runtimeInfoEntry).not.toBeNull();
    expect(form.children[1]).toBe(passkeyButton);
    expect(form.children[2]).toBe(runtimeInfoEntry);

    runtimeInfoSummary!.click();

    await flushMicrotasks();
    await flushMicrotasks();

    expect(confirm).toHaveBeenCalledWith(
      "Von Configured Example wegwechseln? Dabei werden lokale Anmeldung, Offline-Daten und zwischengespeicherte Instanzdaten auf diesem Gerät gelöscht."
    );
    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(localStorage.getItem("auth_vault_state")).toBeNull();
    expect(localStorage.getItem("auth_vault_lock")).toBeNull();
    expect(localStorage.getItem("tenant-cache")).toBeNull();
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
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps the configured instance when the login reset confirmation is cancelled", async () => {
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
    appendMockLoginFooter(document);
    const localStorage = createMockStorage({
      "secpal-locale": "de",
      auth_vault_state: "encrypted-user-state",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const confirm = vi.fn().mockReturnValue(false);
    const reload = vi.fn();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage,
      confirm,
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
      location: { href: "https://app.secpal.dev/login", reload },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeInfoSummary = document.getElementById(
      "secpal-instance-runtime-summary"
    ) as MockElement | null;

    runtimeInfoSummary!.click();

    await flushMicrotasks();

    expect(confirm).toHaveBeenCalledOnce();
    expect(plugin.logout).not.toHaveBeenCalled();
    expect(plugin.clearRuntimeBootstrap).not.toHaveBeenCalled();
    expect(localStorage.getItem("auth_vault_state")).toBe(
      "encrypted-user-state"
    );
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBe("customer-a-session");
    expect(reload).not.toHaveBeenCalled();
  });

  it("disables the destructive instance-switch reset when confirm prompts are unavailable", async () => {
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
    appendMockLoginFooter(document);
    const localStorage = createMockStorage({
      "secpal-locale": "en",
      auth_vault_state: "encrypted-user-state",
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
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const runtimeInfoSummary = document.getElementById(
      "secpal-instance-runtime-summary"
    ) as MockElement | null;

    expect(runtimeInfoSummary?.textContent).toContain(
      "Instance switching is unavailable because this device cannot show confirmation prompts."
    );
    expect(runtimeInfoSummary?.disabled).toBe(true);

    runtimeInfoSummary!.click();
    await flushMicrotasks();

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
    appendMockLoginFooter(document);
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
    const logoutListener = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const windowEventListeners = new Map<
      string,
      Array<(event: { type: string }) => void>
    >();
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

    try {
      vm.runInNewContext(
        buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
        sandbox
      );

      await flushMicrotasks();

      const runtimeInfoSummary = document.getElementById(
        "secpal-instance-runtime-summary"
      ) as MockElement | null;
      const authState = sandbox.__SecPalNativeAuthState as { active: boolean };

      expect(runtimeInfoSummary).not.toBeNull();
      authState.active = true;
      (
        sandbox as {
          addEventListener(
            eventName: string,
            listener: (event: { type: string }) => void
          ): void;
        }
      ).addEventListener("secpal:native-auth-logout", logoutListener);

      runtimeInfoSummary!.click();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(confirm).toHaveBeenCalledOnce();
      expect(plugin.logout).toHaveBeenCalledOnce();
      expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
      expect(logoutListener).toHaveBeenCalledOnce();
      expect(logoutListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "secpal:native-auth-logout" })
      );
      expect(localStorage.getItem("auth_vault_state")).toBe(
        "encrypted-user-state"
      );
      expect(localStorage.getItem("tenant-cache")).toBe("customer-a");
      expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).not.toBeNull();
      expect(sessionStorage.getItem("tenant-session")).toBe(
        "customer-a-session"
      );
      expect(
        (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
      ).not.toHaveBeenCalled();
      expect(
        document.getElementById("secpal-instance-runtime-summary")
      ).not.toBeNull();
      expect(authState.active).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        "Failed to clear the current SecPal instance.",
        expect.objectContaining({
          code: "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED",
        })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("clears tenant-scoped browser state even when clearPersistedBootstrap throws a non-persistence error", async () => {
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
      clearRuntimeBootstrap: vi
        .fn()
        .mockRejectedValue(new Error("unexpected plugin error")),
    };
    const document = new MockDocument();
    appendMockLoginFooter(document);
    const localStorage = createMockStorage({
      "secpal-locale": "en",
      auth_vault_state: "encrypted-user-state",
      "tenant-cache": "customer-a",
    });
    const sessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]: buildStoredRuntimeBootstrap(),
      "tenant-session": "customer-a-session",
    });
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(["runtime-cache"]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const confirm = vi.fn().mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage,
      sessionStorage,
      caches: cacheStorage,
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
        "secpal-instance-runtime-summary"
      ) as MockElement | null;

      expect(runtimeResetButton).not.toBeNull();

      runtimeResetButton!.click();
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();

      expect(confirm).toHaveBeenCalledOnce();
      expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
      expect(localStorage.getItem("auth_vault_state")).toBeNull();
      expect(localStorage.getItem("tenant-cache")).toBeNull();
      expect(sessionStorage.getItem("tenant-session")).toBeNull();
      expect(cacheStorage.delete).toHaveBeenCalledWith("runtime-cache");
      expect(
        (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
      ).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        "Failed to clear persisted bootstrap before resetting the configured SecPal runtime.",
        expect.any(Error)
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
    const { form, passkeyButton } = appendMockLoginFooter(document);
    const navigation = createMockNavigation("https://app.secpal.dev/");
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

    expect(document.getElementById("secpal-instance-runtime-info")).toBeNull();

    navigation.history.pushState({}, "", "/login");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(
      document.getElementById("secpal-instance-runtime-info")
    ).not.toBeNull();
    expect(
      document.getElementById("secpal-instance-runtime-attribution")
    ).not.toBeNull();
    expect(
      document.getElementById("secpal-instance-runtime-attribution")?.attributes
        .href
    ).toBe(DEFAULT_ATTRIBUTION_TERMS_URL);
    expect(form.children[1]).toBe(passkeyButton);
    expect(form.children[2]).toBe(
      document.getElementById("secpal-instance-runtime-info")
    );

    navigation.history.replaceState({}, "", "/");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(document.getElementById("secpal-instance-runtime-info")).toBeNull();

    navigation.location.href = "https://app.secpal.dev/login";
    navigation.dispatchEvent("popstate");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(
      document.getElementById("secpal-instance-runtime-info")
    ).not.toBeNull();
  });

  it("exposes the attribution terms link on the configured about route", async () => {
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
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
      localStorage: createMockStorage({ "secpal-locale": "en" }),
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
      location: { href: "https://app.secpal.dev/about" },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();

    const aboutAttributionLink = document.getElementById(
      "secpal-about-attribution-link"
    ) as MockElement | null;

    expect(aboutAttributionLink).not.toBeNull();
    expect(aboutAttributionLink?.textContent).toBe("Attribution terms");
    expect(aboutAttributionLink?.attributes.href).toBe(
      DEFAULT_ATTRIBUTION_TERMS_URL
    );
  });

  it("does not restore a legacy configured API origin from the native plugin on startup", async () => {
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
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.bootstrap).toBeNull();
    expect(runtimeState.apiOrigin).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();

    const response = await (sandbox.fetch as typeof fetch)(
      `${runtimeBootstrapPlaceholderOrigin}/health/ready`
    );

    const rewrittenRequest = browserFetch.mock.calls.at(-1)?.[0] as Request;
    expect(rewrittenRequest.url).toBe(
      `${runtimeBootstrapPlaceholderOrigin}/health/ready`
    );
    await expect(response.text()).resolves.toBe(
      `${runtimeBootstrapPlaceholderOrigin}/health/ready`
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
              schema_version: 3,
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

  it("confirms a deployment whose bootstrap matches the current notification channel schema", async () => {
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
                schema_version: 3,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: true,
                managed_android_enrollment: false,
                notification_channels: {
                  android_fcm: true,
                  web_push: false,
                },
              },
              notification_channels: {
                android_fcm: {
                  channel: "android_fcm",
                  metadata_revision: 4,
                  public_runtime_metadata: {
                    api_key: "public-client-api-key-demo-1234567890",
                    project_id: "secpal-demo-push",
                    application_id: "1:1234567890:android:abcdef1234567890",
                    sender_id: "1234567890",
                  },
                },
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

    expect(plugin.setRuntimeBootstrap).toHaveBeenCalledWith({
      instanceDisplayName: "Customer Example",
      apiOrigin: "https://customer-api.example",
      rawApiBaseUrl: "https://customer-api.example/v1",
      minimumSupportedAppVersion: "0.0.1",
      minimumSupportedAppBuild: 1,
      androidPush: {
        provider: "fcm",
        metadataRevision: 4,
        publicClientMetadata: {
          apiKey: "public-client-api-key-demo-1234567890",
          projectId: "secpal-demo-push",
          applicationId: "1:1234567890:android:abcdef1234567890",
          senderId: "1234567890",
        },
      },
      features: {
        passwordLoginEnabled: true,
        passkeyLoginEnabled: true,
        managedAndroidEnrollment: false,
      },
    });
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it("confirms a deployment whose bootstrap omits notification_channels entirely", async () => {
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
                schema_version: 3,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: true,
                managed_android_enrollment: false,
                // notification_channels intentionally absent — pre-channel server shape
              },
              // notification_channels intentionally absent at top level
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
    expect(plugin.setRuntimeBootstrap.mock.calls[0]?.[0]).not.toHaveProperty(
      "androidPush"
    );
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).toHaveBeenCalledOnce();
  });

  it("fails before confirmation when Android push metadata is advertised but incomplete", async () => {
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
      setRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
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
              bootstrap_version: "v1",
              schema_version: 3,
              minimum_supported_app_version: "0.0.1",
              minimum_supported_app_build: 1,
            },
            features: {
              password_login: true,
              passkey_login: true,
              managed_android_enrollment: false,
              notification_channels: {
                android_fcm: true,
                web_push: false,
              },
            },
            notification_channels: {
              android_fcm: {
                channel: "android_fcm",
                metadata_revision: 3,
                public_runtime_metadata: {
                  api_key: "public-client-api-key-demo-1234567890",
                  project_id: "secpal-demo-push",
                  application_id: "1:1234567890:android:abcdef1234567890",
                },
              },
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
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
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

    expect(error.textContent).toMatch(/push|bootstrap|metadata/i);
    expect(confirmButton.disabled).toBe(true);
    expect(plugin.setRuntimeBootstrap).not.toHaveBeenCalled();
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).not.toHaveBeenCalled();
  });

  it("fails before confirmation when Android push metadata revision exceeds native limits", async () => {
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
      setRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
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
              bootstrap_version: "v1",
              schema_version: 3,
              minimum_supported_app_version: "0.0.1",
              minimum_supported_app_build: 1,
            },
            features: {
              password_login: true,
              passkey_login: true,
              managed_android_enrollment: false,
              notification_channels: {
                android_fcm: true,
                web_push: false,
              },
            },
            notification_channels: {
              android_fcm: {
                channel: "android_fcm",
                metadata_revision: 9999999999,
                public_runtime_metadata: {
                  api_key: "public-client-api-key-demo-1234567890",
                  project_id: "secpal-demo-push",
                  application_id: "1:1234567890:android:abcdef1234567890",
                  sender_id: "1234567890",
                },
              },
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
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
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

    expect(error.textContent).toMatch(/push|bootstrap|metadata/i);
    expect(confirmButton.disabled).toBe(true);
    expect(plugin.setRuntimeBootstrap).not.toHaveBeenCalled();
    expect(
      (sandbox.location as { reload: ReturnType<typeof vi.fn> }).reload
    ).not.toHaveBeenCalled();
  });

  it("installs the native bridge, keeps the vault wrapper methods off the bootstrap bridge, and routes authenticated /v1/ fetch traffic through the native plugin", async () => {
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
        distributionState: {
          bootstrapStatus: "completed",
          updateChannel: null,
          releaseMetadataUrl: "https://apk.secpal.app/android/latest.json",
          bootstrapLastErrorCode: null,
        },
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

    expect(enterprisePlugin.getManagedState).not.toHaveBeenCalled();

    const bridge = sandbox.SecPalEnterpriseBridge as {
      getManagedState(): Promise<unknown>;
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
      distributionState: {
        bootstrapStatus: "completed",
        updateChannel: null,
        releaseMetadataUrl: "https://apk.secpal.app/android/latest.json",
        bootstrapLastErrorCode: null,
      },
      allowedApps: [],
    });
    expect(enterprisePlugin.getManagedState).toHaveBeenCalledOnce();
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
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
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
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
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
        schema_version: 3,
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

  it("registers a retained Android push token after a reload and login", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const firstInstallationId = "11111111-1111-4111-8111-111111111111";
    const secondInstallationId = "22222222-2222-4222-8222-222222222222";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
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
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
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
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
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

  it("removes the savedAt storage key from both localStorage and sessionStorage when the push token state is destructively cleared", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const runtimeBootstrap = createCustomerAndroidPushBootstrap();
    const encodedApiOrigin = encodeURIComponent(runtimeBootstrap.apiOrigin);
    const tokenStorageKey = "secpal-android-push-token:" + encodedApiOrigin;
    const tokenAppStorageKey =
      "secpal-android-push-token-app:" + encodedApiOrigin;
    const tokenSavedAtStorageKey =
      "secpal-android-push-token-saved-at:" + encodedApiOrigin;
    const sharedLocalStorage = createMockStorage();
    const sharedSessionStorage = createMockStorage({
      [runtimeBootstrapStorageKey]:
        buildStoredRuntimeBootstrap(runtimeBootstrap),
      "tenant-session": "customer-a-session",
    });

    const {
      bridge,
      document,
      handles,
      installationId,
      listeners,
      localStorage,
      plugin,
      sessionStorage,
    } = await createAndroidPushLifecycleSandbox({
      includeResetUi: true,
      localStorage: sharedLocalStorage,
      sessionStorage: sharedSessionStorage,
      runtimeBootstrap,
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

    expect(localStorage.getItem(tokenStorageKey)).toBe(pushToken);
    expect(sessionStorage.getItem(tokenStorageKey)).toBe(pushToken);
    expect(localStorage.getItem(tokenSavedAtStorageKey)).not.toBeNull();
    expect(sessionStorage.getItem(tokenSavedAtStorageKey)).not.toBeNull();
    expect(localStorage.getItem(tokenAppStorageKey)).toBe(
      "secpal-runtime-push"
    );
    expect(sessionStorage.getItem(tokenAppStorageKey)).toBe(
      "secpal-runtime-push"
    );

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

    const runtimeInfoSummary = document.getElementById(
      "secpal-instance-runtime-summary"
    ) as MockElement | null;

    runtimeInfoSummary!.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(localStorage.getItem(tokenStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenStorageKey)).toBeNull();
    expect(localStorage.getItem(tokenSavedAtStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenSavedAtStorageKey)).toBeNull();
    expect(localStorage.getItem(tokenAppStorageKey)).toBeNull();
    expect(sessionStorage.getItem(tokenAppStorageKey)).toBeNull();

    expect(handles).toHaveLength(2);
    for (const handle of handles) {
      expect(typeof (handle.remove as unknown as () => void)).toBe("function");
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

    plugin.request
      .mockResolvedValueOnce({
        status: 409,
        bodyBase64: encodeBase64(
          JSON.stringify({
            message:
              "Notification runtime metadata changed; refresh bootstrap before retrying this installation update.",
            code: "NOTIFICATION_RUNTIME_STATE_INVALID",
            details: {
              bootstrap_version: "v1",
              schema_version: 3,
              channel: "android_fcm",
              provided_metadata_revision: 3,
              expected_metadata_revision: 4,
            },
          })
        ),
        contentType: "application/json",
      })
      .mockResolvedValueOnce({
        status: 200,
        bodyBase64: encodeBase64(
          JSON.stringify({
            data: {
              installation_id: installationId,
              revoked_at: "2026-05-26T10:00:00Z",
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
    ).toEqual(["PUT", "DELETE"]);
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "PUT",
      path: `/v1/me/notification-installations/${installationId}`,
    });
    expect(plugin.request.mock.calls[1]?.[0]).toMatchObject({
      method: "DELETE",
      path: `/v1/me/notification-installations/${installationId}`,
    });
    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
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

    plugin.request
      .mockResolvedValueOnce({
        status: 409,
        bodyBase64: encodeBase64(
          JSON.stringify({
            message:
              "Notification channel is no longer supported for this deployment.",
            code: "NOTIFICATION_CHANNEL_UNSUPPORTED",
            details: {
              bootstrap_version: "v1",
              schema_version: 3,
              channel: "android_fcm",
            },
          })
        ),
        contentType: "application/json",
      })
      .mockResolvedValueOnce({
        status: 404,
        bodyBase64: encodeBase64(JSON.stringify({ message: "Not found." })),
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
    ).toEqual(["PUT", "DELETE"]);
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "PUT",
      path: `/v1/me/notification-installations/${installationId}`,
    });
    expect(plugin.request.mock.calls[1]?.[0]).toMatchObject({
      method: "DELETE",
      path: `/v1/me/notification-installations/${installationId}`,
    });
    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
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

    plugin.request
      .mockResolvedValueOnce({
        status: 409,
        bodyBase64: encodeBase64(
          JSON.stringify({
            message: "Notification runtime metadata changed.",
            code: "NOTIFICATION_RUNTIME_STATE_INVALID",
          })
        ),
        contentType: "application/json",
      })
      .mockResolvedValueOnce({
        status: 204,
        bodyBase64: encodeBase64(""),
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
    ).toEqual(["PUT", "DELETE"]);
    expect(plugin.logout).toHaveBeenCalledOnce();
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

  it("dispatches the native logout event during destructive runtime reset", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const { bridge, document, listeners, plugin, sandbox } =
      await createAndroidPushLifecycleSandbox({ includeResetUi: true });
    const logoutListener = vi.fn();
    const runtimeState = sandbox.__SecPalRuntimeDiscoveryState as {
      configured: boolean;
      bootstrap: { apiOrigin: string } | null;
      apiOrigin: string | null;
      pendingBootstrap: unknown;
    };
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
        configured: runtimeState.configured,
        bootstrap: runtimeState.bootstrap,
        apiOrigin: runtimeState.apiOrigin,
        pendingBootstrap: runtimeState.pendingBootstrap,
        suspended: pushSyncState.suspended,
      });
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

    plugin.request.mockResolvedValue({
      status: 200,
      bodyBase64: encodeBase64(
        JSON.stringify({
          data: {
            installation_id: "11111111-1111-4111-8111-111111111111",
            revoked_at: "2026-05-25T10:00:00Z",
          },
        })
      ),
      contentType: "application/json",
    });

    const runtimeInfoSummary = document.getElementById(
      "secpal-instance-runtime-summary"
    ) as MockElement | null;

    runtimeInfoSummary!.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(logoutListener).toHaveBeenCalledOnce();
    expect(logoutListener).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: "secpal:native-auth-logout" }),
        configured: false,
        bootstrap: null,
        apiOrigin: null,
        pendingBootstrap: null,
        suspended: false,
      })
    );
    expect(plugin.logout.mock.invocationCallOrder[0]).toBeLessThan(
      logoutListener.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it("revokes the backend push-device registration during destructive runtime reset", async () => {
    const pushToken = "fcm-token-1234567890abcdefghijklmnopqrstuvwxyz";
    const { bridge, document, installationId, listeners, plugin } =
      await createAndroidPushLifecycleSandbox({ includeResetUi: true });

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

    const runtimeInfoSummary = document.getElementById(
      "secpal-instance-runtime-summary"
    ) as MockElement | null;

    runtimeInfoSummary!.click();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(plugin.request).toHaveBeenCalledOnce();
    expect(plugin.logout).toHaveBeenCalledOnce();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(plugin.request.mock.invocationCallOrder[0]).toBeLessThan(
      plugin.logout.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
    expect(plugin.request.mock.calls[0]?.[0]).toMatchObject({
      method: "DELETE",
      path: `/v1/me/notification-installations/${installationId}`,
    });
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
      getRuntimeInfo: vi.fn().mockResolvedValue({
        clientPlatform: "android",
        appVersion: "0.0.1",
        appBuild: 1,
      }),
      getRuntimeBootstrap: vi.fn().mockResolvedValue({
        configured: false,
      }),
      setRuntimeBootstrap: vi
        .fn()
        .mockResolvedValue({ bootstrap: runtimeBootstrap }),
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
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
    };

    await expect(bridge.getRuntimeInfo()).resolves.toEqual({
      clientPlatform: "android",
      appVersion: "0.0.1",
      appBuild: 1,
    });
    await expect(bridge.getRuntimeBootstrap()).resolves.toEqual({
      configured: false,
    });
    await expect(bridge.setRuntimeBootstrap(runtimeBootstrap)).resolves.toBe(
      "https://customer-api.example"
    );
    expect(plugin.setRuntimeBootstrap).toHaveBeenCalledWith(runtimeBootstrap);
    expect(runtimeState.configured).toBe(true);
    expect(runtimeState.apiOrigin).toBe("https://customer-api.example");

    await expect(bridge.clearRuntimeBootstrap()).resolves.toBeUndefined();
    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
  });

  it("removes the injected discovery gate after the shared frontend applies a runtime bootstrap", async () => {
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
      setRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
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
      location: { href: "https://app.secpal.dev/login", reload: vi.fn() },
    } as Record<string, unknown>;
    sandbox.globalThis = sandbox;

    vm.runInNewContext(
      buildNativeAuthBridgeBootstrapScript(runtimeBootstrapPlaceholderOrigin),
      sandbox
    );

    await flushMicrotasks();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();

    const bridge = sandbox.SecPalNativeAuthBridge as {
      setRuntimeBootstrap(bootstrap: unknown): Promise<unknown>;
    };

    await expect(bridge.setRuntimeBootstrap(runtimeBootstrap)).resolves.toBe(
      "https://customer-api.example"
    );

    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).toBeNull();
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
      clearRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const document = new MockDocument();
    const sandbox = {
      Capacitor: { Plugins: { SecPalNativeAuth: plugin } },
      document,
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

    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
  });

  it("clears tenant browser state when native runtime-bootstrap clearing fails", async () => {
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
      setRuntimeBootstrap: vi.fn().mockResolvedValue(undefined),
      clearRuntimeBootstrap: vi
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

    expect(plugin.clearRuntimeBootstrap).toHaveBeenCalledOnce();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(localStorage.getItem("secpal-locale")).toBe("de");
    expect(localStorage.getItem("tenant-cache")).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
    expect(sessionStorage.getItem("tenant-session")).toBeNull();
    expect(
      document.getElementById("secpal-instance-discovery-gate")
    ).not.toBeNull();
  });

  it("rejects runtime confirmation when the native runtime-bootstrap method is missing", async () => {
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
                schema_version: 3,
                minimum_supported_app_version: "0.0.1",
                minimum_supported_app_build: 1,
              },
              features: {
                password_login: true,
                passkey_login: false,
                managed_android_enrollment: false,
                notification_channels: {
                  android_fcm: false,
                  web_push: false,
                },
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
    await flushMicrotasks();

    expect(plugin.setApiBaseUrl).not.toHaveBeenCalled();
    expect(runtimeState.configured).toBe(false);
    expect(runtimeState.apiOrigin).toBeNull();
    expect(sessionStorage.getItem(runtimeBootstrapStorageKey)).toBeNull();
  });
});
