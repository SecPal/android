/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

class MockElement {
  id = "";
  textContent = "";
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

  click() {
    for (const listener of this.listeners.get("click") ?? []) {
      listener({
        preventDefault() {
          // no-op
        },
      });
    }
  }

  remove() {
    this.ownerDocument?.unregister(this.id);
  }
}

class MockDocument {
  readonly body = new MockElement("body");
  readyState = "complete";
  private readonly elementsById = new Map<string, MockElement>();

  constructor() {
    this.body.ownerDocument = this;
  }

  createElement(tagName: string) {
    const element = new MockElement(tagName);

    element.ownerDocument = this;
    return element;
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
    ).resolves.toBe("https://api.secpal.dev");
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

  it("installs the native bridge and routes authenticated /v1/ fetch traffic through the native plugin", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const plugin = {
      login: vi.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: vi.fn().mockResolvedValue(undefined),
      getCurrentUser: vi.fn().mockResolvedValue({ id: 7 }),
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
    };

    await bridge.login({ email: "worker@secpal.dev", password: "password123" });

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
    const listenerHandle = { remove: vi.fn() };
    const hardwareButtonListeners: Array<(payload: unknown) => void> = [];
    const hardwareButtonShortPressListeners: Array<(payload: unknown) => void> = [];
    const hardwareButtonLongPressListeners: Array<(payload: unknown) => void> = [];
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
      addListener: vi.fn((eventName: string, listener: (payload: unknown) => void) => {
        if (eventName === "hardwareButtonPressed") {
          hardwareButtonListeners.push(listener);
        }

        if (eventName === "hardwareButtonShortPressed") {
          hardwareButtonShortPressListeners.push(listener);
        }

        if (eventName === "hardwareButtonLongPressed") {
          hardwareButtonLongPressListeners.push(listener);
        }

        return listenerHandle;
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
      addHardwareButtonListener(listener: (payload: unknown) => void): unknown;
      addHardwareButtonShortPressListener(
        listener: (payload: unknown) => void
      ): unknown;
      addHardwareButtonLongPressListener(
        listener: (payload: unknown) => void
      ): unknown;
    };
    const hardwareButtonListener = vi.fn();
    const hardwareButtonShortPressListener = vi.fn();
    const hardwareButtonLongPressListener = vi.fn();

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
    expect(bridge.addHardwareButtonListener(hardwareButtonListener)).toBe(
      listenerHandle
    );
    expect(
      bridge.addHardwareButtonShortPressListener(hardwareButtonShortPressListener)
    ).toBe(listenerHandle);
    expect(
      bridge.addHardwareButtonLongPressListener(hardwareButtonLongPressListener)
    ).toBe(listenerHandle);

    hardwareButtonListeners.at(-1)?.({
      action: "down",
      origin: "activity_dispatch",
      keyCode: 286,
      keyName: "KEYCODE_STEM_PRIMARY",
      scanCode: 703,
      repeatCount: 0,
      deviceId: 9,
      source: 257,
    });
    hardwareButtonShortPressListeners.at(-1)?.({
      action: "short_press",
      origin: "activity_dispatch",
      keyCode: 286,
      keyName: "KEYCODE_STEM_PRIMARY",
      scanCode: 703,
      repeatCount: 0,
      holdDurationMs: 1200,
      deviceId: 9,
      source: 257,
    });
    hardwareButtonLongPressListeners.at(-1)?.({
      action: "long_press",
      origin: "activity_dispatch",
      keyCode: 286,
      keyName: "KEYCODE_STEM_PRIMARY",
      scanCode: 703,
      repeatCount: 0,
      holdDurationMs: 5000,
      deviceId: 9,
      source: 257,
    });

    expect(enterprisePlugin.getManagedState).toHaveBeenCalledOnce();
    expect(
      enterprisePlugin.openGestureNavigationSettings
    ).toHaveBeenCalledOnce();
    expect(enterprisePlugin.addListener).toHaveBeenNthCalledWith(
      1,
      "hardwareButtonPressed",
      expect.any(Function)
    );
    expect(enterprisePlugin.addListener).toHaveBeenNthCalledWith(
      2,
      "hardwareButtonShortPressed",
      expect.any(Function)
    );
    expect(enterprisePlugin.addListener).toHaveBeenNthCalledWith(
      3,
      "hardwareButtonLongPressed",
      expect.any(Function)
    );
    expect(enterprisePlugin.addListener).toHaveBeenNthCalledWith(
      4,
      "hardwareButtonPressed",
      hardwareButtonListener
    );
    expect(enterprisePlugin.addListener).toHaveBeenNthCalledWith(
      5,
      "hardwareButtonShortPressed",
      hardwareButtonShortPressListener
    );
    expect(enterprisePlugin.addListener).toHaveBeenNthCalledWith(
      6,
      "hardwareButtonLongPressed",
      hardwareButtonLongPressListener
    );
    expect(hardwareButtonListener).toHaveBeenCalledWith({
      action: "down",
      origin: "activity_dispatch",
      keyCode: 286,
      keyName: "KEYCODE_STEM_PRIMARY",
      scanCode: 703,
      repeatCount: 0,
      deviceId: 9,
      source: 257,
    });
    expect(hardwareButtonShortPressListener).toHaveBeenCalledWith({
      action: "short_press",
      origin: "activity_dispatch",
      keyCode: 286,
      keyName: "KEYCODE_STEM_PRIMARY",
      scanCode: 703,
      repeatCount: 0,
      holdDurationMs: 1200,
      deviceId: 9,
      source: 257,
    });
    expect(hardwareButtonLongPressListener).toHaveBeenCalledWith({
      action: "long_press",
      origin: "activity_dispatch",
      keyCode: 286,
      keyName: "KEYCODE_STEM_PRIMARY",
      scanCode: 703,
      repeatCount: 0,
      holdDurationMs: 5000,
      deviceId: 9,
      source: 257,
    });
  });

  it("opens the profile page on short press and the about page on long press", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const hardwareButtonListeners: Array<(payload: unknown) => void> = [];
    const hardwareButtonShortPressListeners: Array<(payload: unknown) => void> = [];
    const hardwareButtonLongPressListeners: Array<(payload: unknown) => void> = [];
    const enterprisePlugin = {
      getManagedState: vi.fn(),
      launchPhone: vi.fn(),
      launchSms: vi.fn(),
      launchAllowedApp: vi.fn(),
      openGestureNavigationSettings: vi.fn(),
      addListener: vi.fn((eventName: string, listener: (payload: unknown) => void) => {
        if (eventName === "hardwareButtonPressed") {
          hardwareButtonListeners.push(listener);
        }

        if (eventName === "hardwareButtonShortPressed") {
          hardwareButtonShortPressListeners.push(listener);
        }

        if (eventName === "hardwareButtonLongPressed") {
          hardwareButtonLongPressListeners.push(listener);
        }

        return { remove: vi.fn() };
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

    expect(enterprisePlugin.addListener).toHaveBeenCalledTimes(3);
    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/" });

    hardwareButtonListeners[0]?.({
      action: "down",
      origin: "activity_dispatch",
      keyCode: 1015,
      keyName: "1015",
      scanCode: 252,
      repeatCount: 0,
      deviceId: 2,
      source: 257,
    });

    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/" });

    hardwareButtonShortPressListeners[0]?.({
      action: "short_press",
      origin: "activity_dispatch",
      keyCode: 1015,
      keyName: "1015",
      scanCode: 252,
      repeatCount: 0,
      holdDurationMs: 1200,
      deviceId: 2,
      source: 257,
    });

    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/profile" });

    sandbox.location = { href: "https://app.secpal.dev/" };

    hardwareButtonLongPressListeners[0]?.({
      action: "long_press",
      origin: "activity_dispatch",
      keyCode: 1015,
      keyName: "1015",
      scanCode: 252,
      repeatCount: 0,
      holdDurationMs: 5000,
      deviceId: 2,
      source: 257,
    });

    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/about" });
  });

  it("opens the profile page on Samsung Knox press fallback and refines long reports to the about page", async () => {
    const { buildNativeAuthBridgeBootstrapScript } = await loadInjectorModule();
    const hardwareButtonListeners: Array<(payload: unknown) => void> = [];
    const hardwareButtonShortPressListeners: Array<(payload: unknown) => void> = [];
    const hardwareButtonLongPressListeners: Array<(payload: unknown) => void> = [];
    const enterprisePlugin = {
      getManagedState: vi.fn(),
      launchPhone: vi.fn(),
      launchSms: vi.fn(),
      launchAllowedApp: vi.fn(),
      openGestureNavigationSettings: vi.fn(),
      addListener: vi.fn((eventName: string, listener: (payload: unknown) => void) => {
        if (eventName === "hardwareButtonPressed") {
          hardwareButtonListeners.push(listener);
        }

        if (eventName === "hardwareButtonShortPressed") {
          hardwareButtonShortPressListeners.push(listener);
        }

        if (eventName === "hardwareButtonLongPressed") {
          hardwareButtonLongPressListeners.push(listener);
        }

        return { remove: vi.fn() };
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

    expect(enterprisePlugin.addListener).toHaveBeenCalledTimes(3);
    expect(hardwareButtonShortPressListeners).toHaveLength(1);
    expect(hardwareButtonLongPressListeners).toHaveLength(1);
    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/" });

    hardwareButtonListeners[0]?.({
      action: "down",
      origin: "samsung_knox_broadcast",
      keyCode: 1015,
      keyName: "KEYCODE_XCOVER_TOP",
      scanCode: -1,
      repeatCount: 0,
      deviceId: -1,
      source: 0,
    });

    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/profile" });

    sandbox.location = { href: "https://app.secpal.dev/" };

    hardwareButtonShortPressListeners[0]?.({
      action: "short_press",
      origin: "samsung_knox_broadcast",
      keyCode: 1015,
      keyName: "KEYCODE_XCOVER_TOP",
      scanCode: -1,
      repeatCount: 0,
      holdDurationMs: 1200,
      deviceId: -1,
      source: 0,
    });

    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/profile" });

    sandbox.location = { href: "https://app.secpal.dev/" };

    hardwareButtonLongPressListeners[0]?.({
      action: "long_press",
      origin: "samsung_knox_broadcast",
      keyCode: 1015,
      keyName: "KEYCODE_XCOVER_TOP",
      scanCode: -1,
      repeatCount: 0,
      holdDurationMs: 5000,
      deviceId: -1,
      source: 0,
    });

    expect(sandbox.location).toEqual({ href: "https://app.secpal.dev/about" });
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
});
