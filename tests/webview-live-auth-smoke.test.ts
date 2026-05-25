/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

type BrowserEventInit = {
  bubbles?: boolean;
};

class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;

  constructor(type: string, init: BrowserEventInit = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
  }
}

class FakeFormElement {
  readonly requestSubmitCalls: unknown[] = [];
  submitButton: FakeButtonElement | null = null;

  requestSubmit(submitter?: unknown): void {
    this.requestSubmitCalls.push(submitter);
  }

  querySelector(selector: string): FakeButtonElement | null {
    if (selector === 'button[type="submit"]') {
      return this.submitButton;
    }

    return null;
  }
}

class FakeButtonElement {
  disabled = false;
  clicks = 0;

  click(): void {
    this.clicks += 1;
  }
}

class FakeInputElement {
  ownerDocument: {
    defaultView: {
      Event: typeof FakeEvent;
      HTMLInputElement: typeof FakeInputElement;
      HTMLTextAreaElement: typeof FakeTextAreaElement;
      HTMLSelectElement: typeof FakeSelectElement;
    };
  };
  form: FakeFormElement | null = null;
  focused = false;
  dispatchedEvents: FakeEvent[] = [];
  internalValue = "";

  constructor() {
    this.ownerDocument = {
      defaultView: {
        Event: FakeEvent,
        HTMLInputElement: FakeInputElement,
        HTMLTextAreaElement: FakeTextAreaElement,
        HTMLSelectElement: FakeSelectElement,
      },
    };
  }

  focus(): void {
    this.focused = true;
  }

  dispatchEvent(event: FakeEvent): boolean {
    this.dispatchedEvents.push(event);
    return true;
  }

  closest(selector: string): FakeFormElement | null {
    if (selector === "form") {
      return this.form;
    }

    return null;
  }
}

class FakeTextAreaElement extends FakeInputElement {}

class FakeSelectElement extends FakeInputElement {}

class FakeDocument {
  private readonly elements = new Map<string, unknown>();

  register(id: string, element: unknown): void {
    this.elements.set(id, element);
  }

  getElementById(id: string): unknown {
    return this.elements.get(id) ?? null;
  }
}

class FakeLocation {
  href: string;
  readonly assignCalls: string[] = [];

  constructor(href: string) {
    this.href = href;
  }

  assign(nextPath: string): void {
    this.assignCalls.push(nextPath);
    this.href = new URL(nextPath, this.href).toString();
  }
}

class FakeWebSocket {
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readonly sentPayloads: string[] = [];
  closeCalls = 0;

  send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  close(): void {
    this.closeCalls += 1;
  }

  dispatchMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

async function loadSmokeModule(): Promise<{
  setFormControlValue: (element: FakeInputElement, value: string) => void;
  submitLoginForm: (
    document: FakeDocument,
    credentials: { email: string; password: string }
  ) => { submitMethod: string };
  startRuntimeDiscovery: (
    document: FakeDocument,
    runtimeUrl: string
  ) => { action: string };
  confirmRuntimeDiscovery: (document: FakeDocument) => { action: string };
  buildDocumentCallExpression: (
    functionName: string,
    ...args: unknown[]
  ) => string;
  ensureLoginFormRoute: (globalLike: {
    document: FakeDocument;
    location: FakeLocation;
  }) => { navigated: boolean; hasLoginForm: boolean; href: string };
  isDirectExecutionPath: (
    entryPointArg: string | undefined,
    moduleUrl: string
  ) => boolean;
  resolveSessionWebSocketUrl: (
    options: {
      debuggerListUrl?: string;
      targetPattern?: string;
      debuggerSession?: { webSocketUrl?: string };
    },
    loadWebSocketUrl?: (
      debuggerListUrl: string,
      targetPattern: string
    ) => Promise<string>
  ) => Promise<string>;
  createCdpCommandSender: (
    websocket: FakeWebSocket,
    options?: { requestTimeoutMs?: number }
  ) => {
    send: (method: string, params?: unknown) => Promise<unknown>;
    close: () => void;
  };
  assertCdpCommandSucceeded: (response: unknown, method: string) => void;
}> {
  // @ts-expect-error This helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/webview-live-auth-smoke.mjs");
}

describe("WebView live auth smoke helpers", () => {
  afterEach(() => {
    vi.useRealTimers();

    // Remove the configurable value descriptor installed by individual tests so
    // each test starts from a clean prototype state.
    if (Object.getOwnPropertyDescriptor(FakeInputElement.prototype, "value")) {
      delete (FakeInputElement.prototype as unknown as Record<string, unknown>)
        .value;
    }
  });

  it("uses the native value setter and dispatches bubbling input events", async () => {
    const { setFormControlValue } = await loadSmokeModule();
    const input = new FakeInputElement();
    const setterCalls: string[] = [];

    Object.defineProperty(FakeInputElement.prototype, "value", {
      configurable: true,
      get() {
        return this.internalValue;
      },
      set(nextValue: string) {
        setterCalls.push(nextValue);
        this.internalValue = `${nextValue}:native`;
      },
    });

    setFormControlValue(input, "test@example.com");

    expect(setterCalls).toEqual(["test@example.com"]);
    expect(input.internalValue).toBe("test@example.com:native");
    expect(input.focused).toBe(true);
    expect(input.dispatchedEvents).toHaveLength(2);
    expect(input.dispatchedEvents.map((event) => event.type)).toEqual([
      "input",
      "change",
    ]);
    expect(input.dispatchedEvents.every((event) => event.bubbles)).toBe(true);
  });

  it("fills both login inputs and submits the enclosing form", async () => {
    const { submitLoginForm } = await loadSmokeModule();
    const document = new FakeDocument();
    const form = new FakeFormElement();
    const submitButton = new FakeButtonElement();
    const emailInput = new FakeInputElement();
    const passwordInput = new FakeInputElement();

    form.submitButton = submitButton;
    emailInput.form = form;
    passwordInput.form = form;

    document.register("email", emailInput);
    document.register("password", passwordInput);

    Object.defineProperty(FakeInputElement.prototype, "value", {
      configurable: true,
      get() {
        return this.internalValue;
      },
      set(nextValue: string) {
        this.internalValue = nextValue;
      },
    });

    const result = submitLoginForm(document, {
      email: "test@example.com",
      password: "password",
    });

    expect(emailInput.internalValue).toBe("test@example.com");
    expect(passwordInput.internalValue).toBe("password");
    expect(form.requestSubmitCalls).toEqual([submitButton]);
    expect(submitButton.clicks).toBe(0);
    expect(result).toEqual({ submitMethod: "requestSubmit" });
  });

  it("fills the discovery input and clicks the runtime validation button", async () => {
    const { startRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();
    const runtimeInput = new FakeInputElement();
    const validateButton = new FakeButtonElement();

    document.register("secpal-instance-discovery-url", runtimeInput);
    document.register("secpal-instance-discovery-validate", validateButton);

    Object.defineProperty(FakeInputElement.prototype, "value", {
      configurable: true,
      get() {
        return this.internalValue;
      },
      set(nextValue: string) {
        this.internalValue = nextValue;
      },
    });

    const result = startRuntimeDiscovery(document, "https://api.secpal.dev");

    expect(runtimeInput.internalValue).toBe("https://api.secpal.dev");
    expect(runtimeInput.dispatchedEvents.map((event) => event.type)).toEqual([
      "input",
      "change",
    ]);
    expect(validateButton.clicks).toBe(1);
    expect(result).toEqual({ action: "validate" });
  });

  it("rejects discovery confirmation when the button is disabled", async () => {
    const { confirmRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();
    const confirmButton = new FakeButtonElement();

    confirmButton.disabled = true;
    document.register("secpal-instance-discovery-confirm", confirmButton);

    expect(() => confirmRuntimeDiscovery(document)).toThrow(
      "The runtime confirmation button is currently disabled."
    );
  });

  it("returns the smoke run to /login when the login form is missing", async () => {
    const { ensureLoginFormRoute } = await loadSmokeModule();
    const document = new FakeDocument();
    const location = new FakeLocation("https://app.secpal.dev/");

    const result = ensureLoginFormRoute({ document, location });

    expect(location.assignCalls).toEqual(["/login"]);
    expect(result).toEqual({
      navigated: true,
      hasLoginForm: false,
      href: "https://app.secpal.dev/login",
    });
  });

  it("treats a relative entry path as direct execution for the script module", async () => {
    const { isDirectExecutionPath } = await loadSmokeModule();
    const moduleUrl = pathToFileURL(
      resolve("scripts/webview-live-auth-smoke.mjs")
    ).href;

    expect(
      isDirectExecutionPath("./scripts/webview-live-auth-smoke.mjs", moduleUrl)
    ).toBe(true);
  });

  it("pins a single matching CDP target for the entire smoke session", async () => {
    const { resolveSessionWebSocketUrl } = await loadSmokeModule();
    const options = {
      debuggerListUrl: "http://127.0.0.1:9223/json/list",
      targetPattern: "app\\.secpal\\.dev",
      debuggerSession: {},
    };
    const loadWebSocketUrl = vi
      .fn<(debuggerListUrl: string, targetPattern: string) => Promise<string>>()
      .mockResolvedValue("ws://target-1");

    await expect(
      resolveSessionWebSocketUrl(options, loadWebSocketUrl)
    ).resolves.toBe("ws://target-1");
    await expect(
      resolveSessionWebSocketUrl(options, loadWebSocketUrl)
    ).resolves.toBe("ws://target-1");
    expect(loadWebSocketUrl).toHaveBeenCalledOnce();
  });

  it("fails fast for protocol-level CDP command errors", async () => {
    const { assertCdpCommandSucceeded } = await loadSmokeModule();

    expect(() =>
      assertCdpCommandSucceeded(
        {
          error: {
            code: -32000,
            message: "Execution context was destroyed.",
          },
        },
        "Runtime.evaluate"
      )
    ).toThrow(
      "CDP command Runtime.evaluate failed (-32000): Execution context was destroyed."
    );
  });

  it("times out stalled CDP commands and closes the socket", async () => {
    const { createCdpCommandSender } = await loadSmokeModule();
    const websocket = new FakeWebSocket();
    const sender = createCdpCommandSender(websocket, { requestTimeoutMs: 25 });

    vi.useFakeTimers();

    const sendPromise = sender.send("Runtime.evaluate", {
      expression: "globalThis.location?.href",
    });
    const rejectionExpectation = expect(sendPromise).rejects.toThrow(
      "Timed out waiting for CDP response to Runtime.evaluate after 25ms."
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejectionExpectation;
    expect(websocket.closeCalls).toBe(1);
  });

  it("startRuntimeDiscovery fills the URL input and clicks the validate button", async () => {
    const { startRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();
    const urlInput = new FakeInputElement();
    const validateButton = new FakeButtonElement();

    Object.defineProperty(FakeInputElement.prototype, "value", {
      configurable: true,
      get() {
        return this.internalValue;
      },
      set(nextValue: string) {
        this.internalValue = nextValue;
      },
    });

    document.register("secpal-instance-discovery-url", urlInput);
    document.register("secpal-instance-discovery-validate", validateButton);

    const result = startRuntimeDiscovery(document, "https://api.secpal.dev");

    expect(urlInput.internalValue).toBe("https://api.secpal.dev");
    expect(validateButton.clicks).toBe(1);
    expect(result).toEqual({ action: "validate" });
  });

  it("startRuntimeDiscovery throws when the validate button is disabled", async () => {
    const { startRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();
    const urlInput = new FakeInputElement();
    const validateButton = new FakeButtonElement();
    validateButton.disabled = true;

    Object.defineProperty(FakeInputElement.prototype, "value", {
      configurable: true,
      get() {
        return this.internalValue;
      },
      set(nextValue: string) {
        this.internalValue = nextValue;
      },
    });

    document.register("secpal-instance-discovery-url", urlInput);
    document.register("secpal-instance-discovery-validate", validateButton);

    expect(() =>
      startRuntimeDiscovery(document, "https://api.secpal.dev")
    ).toThrow("The runtime validation button is currently disabled.");
  });

  it("startRuntimeDiscovery throws when the URL input element is missing", async () => {
    const { startRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();

    expect(() =>
      startRuntimeDiscovery(document, "https://api.secpal.dev")
    ).toThrow("Required element not found: secpal-instance-discovery-url");
  });

  it("confirmRuntimeDiscovery clicks the confirm button and returns the action", async () => {
    const { confirmRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();
    const confirmButton = new FakeButtonElement();

    document.register("secpal-instance-discovery-confirm", confirmButton);

    const result = confirmRuntimeDiscovery(document);

    expect(confirmButton.clicks).toBe(1);
    expect(result).toEqual({ action: "confirm" });
  });

  it("confirmRuntimeDiscovery throws when the confirm button is disabled", async () => {
    const { confirmRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();
    const confirmButton = new FakeButtonElement();
    confirmButton.disabled = true;

    document.register("secpal-instance-discovery-confirm", confirmButton);

    expect(() => confirmRuntimeDiscovery(document)).toThrow(
      "The runtime confirmation button is currently disabled."
    );
  });

  it("confirmRuntimeDiscovery throws when the confirm button element is missing", async () => {
    const { confirmRuntimeDiscovery } = await loadSmokeModule();
    const document = new FakeDocument();

    expect(() => confirmRuntimeDiscovery(document)).toThrow(
      "Required element not found: secpal-instance-discovery-confirm"
    );
  });

  it("serializes browser helper expressions with their local dependencies", async () => {
    const { buildDocumentCallExpression } = await loadSmokeModule();
    const document = new FakeDocument();
    const form = new FakeFormElement();
    const submitButton = new FakeButtonElement();
    const emailInput = new FakeInputElement();
    const passwordInput = new FakeInputElement();

    form.submitButton = submitButton;
    emailInput.form = form;
    passwordInput.form = form;

    document.register("email", emailInput);
    document.register("password", passwordInput);

    Object.defineProperty(FakeInputElement.prototype, "value", {
      configurable: true,
      get() {
        return this.internalValue;
      },
      set(nextValue: string) {
        this.internalValue = nextValue;
      },
    });

    const expression = buildDocumentCallExpression("submitLoginForm", {
      email: "test@example.com",
      password: "password",
    });
    const evaluateExpression = new Function(
      "document",
      `return ${expression};`
    ) as (document: FakeDocument) => { submitMethod: string };

    const result = evaluateExpression(document);

    expect(result).toEqual({ submitMethod: "requestSubmit" });
    expect(form.requestSubmitCalls).toEqual([submitButton]);
  });

  it("rejects element-scoped helpers as document call targets", async () => {
    const { buildDocumentCallExpression } = await loadSmokeModule();

    expect(() =>
      buildDocumentCallExpression("setFormControlValue", "value")
    ).toThrow("Unknown browser helper: setFormControlValue");
  });
});
