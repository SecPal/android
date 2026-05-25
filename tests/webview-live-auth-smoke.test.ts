/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from "vitest";

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

async function loadSmokeModule(): Promise<{
  setFormControlValue: (element: FakeInputElement, value: string) => void;
  submitLoginForm: (
    document: FakeDocument,
    credentials: { email: string; password: string }
  ) => { submitMethod: string };
  buildDocumentCallExpression: (
    functionName: string,
    ...args: unknown[]
  ) => string;
  ensureLoginFormRoute: (globalLike: {
    document: FakeDocument;
    location: FakeLocation;
  }) => { navigated: boolean; hasLoginForm: boolean; href: string };
}> {
  // @ts-expect-error This helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/webview-live-auth-smoke.mjs");
}

describe("WebView live auth smoke helpers", () => {
  afterEach(() => {
    // Remove the configurable value descriptor installed by individual tests so
    // each test starts from a clean prototype state.
    if (Object.getOwnPropertyDescriptor(FakeInputElement.prototype, "value")) {
      delete (FakeInputElement.prototype as unknown as Record<string, unknown>).value;
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
});
