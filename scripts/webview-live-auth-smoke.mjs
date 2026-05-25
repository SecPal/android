#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultDebuggerListUrl =
  process.env.SECPAL_WEBVIEW_DEVTOOLS_URL ?? "http://127.0.0.1:9223/json/list";
const defaultRuntimeUrl =
  process.env.SECPAL_RUNTIME_URL ?? "https://api.secpal.dev";
const defaultTargetPattern =
  process.env.SECPAL_WEBVIEW_TARGET_PATTERN ?? "app\\.secpal\\.dev";
const defaultCdpRequestTimeoutMs = 5000;

function getRequiredElement(documentLike, elementId) {
  const element = documentLike?.getElementById?.(elementId) ?? null;

  if (!element) {
    throw new Error(`Required element not found: ${elementId}`);
  }

  return element;
}

function getNativeValueSetter(element) {
  const defaultView = element?.ownerDocument?.defaultView ?? globalThis;
  const constructorList = [
    defaultView.HTMLInputElement,
    defaultView.HTMLTextAreaElement,
    defaultView.HTMLSelectElement,
  ].filter(Boolean);

  for (const constructor of constructorList) {
    const descriptor = Object.getOwnPropertyDescriptor(
      constructor.prototype,
      "value"
    );

    if (typeof descriptor?.set === "function") {
      return descriptor.set;
    }
  }

  throw new Error("Unable to resolve a native value setter for the control.");
}

export function setFormControlValue(element, value) {
  if (!element) {
    throw new Error("Cannot set a value on a missing form control.");
  }

  const defaultView = element.ownerDocument?.defaultView ?? globalThis;
  const EventConstructor = defaultView.Event ?? Event;
  const setter = getNativeValueSetter(element);

  if (typeof element.focus === "function") {
    element.focus();
  }

  setter.call(element, value);
  element.dispatchEvent(new EventConstructor("input", { bubbles: true }));
  element.dispatchEvent(new EventConstructor("change", { bubbles: true }));
}

export function submitLoginForm(documentLike, credentials) {
  const emailInput = getRequiredElement(documentLike, "email");
  const passwordInput = getRequiredElement(documentLike, "password");

  setFormControlValue(emailInput, credentials.email);
  setFormControlValue(passwordInput, credentials.password);

  const form = emailInput.closest?.("form") ?? null;

  if (!form) {
    throw new Error("Could not find the enclosing login form.");
  }

  const submitButton = form.querySelector?.('button[type="submit"]') ?? null;

  if (submitButton?.disabled) {
    throw new Error("The login submit button is currently disabled.");
  }

  if (typeof form.requestSubmit === "function") {
    form.requestSubmit(submitButton ?? undefined);
    return { submitMethod: "requestSubmit" };
  }

  if (typeof submitButton?.click === "function") {
    submitButton.click();
    return { submitMethod: "click" };
  }

  throw new Error("Could not submit the login form.");
}

export function startRuntimeDiscovery(documentLike, runtimeUrl) {
  const runtimeInput = getRequiredElement(
    documentLike,
    "secpal-instance-discovery-url"
  );
  const validateButton = getRequiredElement(
    documentLike,
    "secpal-instance-discovery-validate"
  );

  setFormControlValue(runtimeInput, runtimeUrl);

  if (validateButton.disabled) {
    throw new Error("The runtime validation button is currently disabled.");
  }

  if (typeof validateButton.click !== "function") {
    throw new Error("The runtime validation button is not clickable.");
  }

  validateButton.click();

  return { action: "validate" };
}

export function confirmRuntimeDiscovery(documentLike) {
  const confirmButton = getRequiredElement(
    documentLike,
    "secpal-instance-discovery-confirm"
  );

  if (confirmButton.disabled) {
    throw new Error("The runtime confirmation button is currently disabled.");
  }

  if (typeof confirmButton.click !== "function") {
    throw new Error("The runtime confirmation button is not clickable.");
  }

  confirmButton.click();

  return { action: "confirm" };
}

export function ensureLoginFormRoute(globalLike) {
  const documentLike = globalLike?.document ?? null;
  const locationLike = globalLike?.location ?? null;
  const hasLoginForm =
    Boolean(documentLike?.getElementById?.("email")) &&
    Boolean(documentLike?.getElementById?.("password"));

  if (hasLoginForm) {
    return {
      navigated: false,
      hasLoginForm: true,
      href: locationLike?.href ?? "",
    };
  }

  if (typeof locationLike?.assign === "function") {
    locationLike.assign("/login");
  } else {
    throw new Error("The current WebView location is not navigable.");
  }

  return {
    navigated: true,
    hasLoginForm: false,
    href: locationLike?.href ?? "",
  };
}

export function buildDocumentCallExpression(functionName, ...args) {
  const helperMap = {
    getRequiredElement,
    submitLoginForm,
    startRuntimeDiscovery,
    confirmRuntimeDiscovery,
  };
  const helper = helperMap[functionName];

  if (typeof helper !== "function") {
    throw new Error(`Unknown browser helper: ${functionName}`);
  }

  const serializedHelpers = [
    getRequiredElement,
    getNativeValueSetter,
    setFormControlValue,
    submitLoginForm,
    startRuntimeDiscovery,
    confirmRuntimeDiscovery,
  ]
    .map((dependency) => `const ${dependency.name} = ${dependency.toString()};`)
    .join("\n");

  return `(() => {
${serializedHelpers}
return ${functionName}(document, ...${JSON.stringify(args)});
})()`;
}

const inspectStateExpression = `(async () => ({
  href: globalThis.location?.href ?? null,
  runtimeBootstrap: (await globalThis.Capacitor?.Plugins?.SecPalNativeAuth?.getRuntimeBootstrap?.()) ?? null,
  nativeAuthState: globalThis.__SecPalNativeAuthState ?? null,
  androidPushSyncState: globalThis.__SecPalAndroidPushSyncState ?? null,
  registrationState: (await globalThis.SecPalNativeAuthBridge?.getAndroidPushRegistrationState?.()) ?? null,
  loginErrorText: globalThis.document?.getElementById?.('login-error')?.innerText ?? null,
  discoveryErrorText: globalThis.document?.getElementById?.('secpal-instance-discovery-error')?.innerText ?? null,
  bodyText: globalThis.document?.body?.innerText?.slice(0, 400) ?? null,
}))()`;

const discoveryReadyExpression = `(() => {
  const confirmButton = globalThis.document?.getElementById?.('secpal-instance-discovery-confirm');
  const errorElement = globalThis.document?.getElementById?.('secpal-instance-discovery-error');

  return {
    confirmVisible: Boolean(confirmButton) && getComputedStyle(confirmButton).display !== 'none',
    confirmDisabled: Boolean(confirmButton?.disabled),
    error: errorElement?.innerText ?? '',
  };
})()`;

const loginFormReadyExpression = `(() => ({
  href: globalThis.location?.href ?? null,
  hasLoginForm: Boolean(globalThis.document?.getElementById?.('email')) && Boolean(globalThis.document?.getElementById?.('password')),
}))()`;

const preLoginPushReadyExpression = `(() => ({
  href: globalThis.location?.href ?? null,
  currentToken: globalThis.__SecPalAndroidPushSyncState?.currentToken ?? null,
  disabledError: globalThis.__SecPalAndroidPushSyncState?.disabledError ?? null,
}))()`;

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

async function getTargetWebSocketUrl(debuggerListUrl, targetPattern) {
  const response = await fetch(debuggerListUrl);

  if (!response.ok) {
    throw new Error(
      `Could not load WebView targets from ${debuggerListUrl}: ${response.status}`
    );
  }

  const targets = await response.json();
  const matcher = new RegExp(targetPattern);
  const target = targets.find(
    (entry) => entry?.type === "page" && matcher.test(entry.url ?? "")
  );

  if (!target?.webSocketDebuggerUrl) {
    throw new Error(
      `No inspectable WebView target matched ${targetPattern} at ${debuggerListUrl}.`
    );
  }

  return target.webSocketDebuggerUrl;
}

function getCdpRequestTimeoutMs(requestTimeoutMs) {
  if (Number.isInteger(requestTimeoutMs) && requestTimeoutMs > 0) {
    return requestTimeoutMs;
  }

  return defaultCdpRequestTimeoutMs;
}

function createCdpTimeoutError(method, timeoutMs) {
  return new Error(
    `Timed out waiting for CDP response to ${method} after ${timeoutMs}ms.`
  );
}

function createWebSocketOpenTimeoutError(timeoutMs) {
  return new Error(
    `Timed out waiting for WebView debugger WebSocket to open after ${timeoutMs}ms.`
  );
}

export function waitForWebSocketOpen(
  websocket,
  timeoutMs = defaultCdpRequestTimeoutMs
) {
  const openTimeoutMs = getCdpRequestTimeoutMs(timeoutMs);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      websocket.onopen = null;
      websocket.onerror = null;
      websocket.onclose = null;
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      websocket.close();
      reject(createWebSocketOpenTimeoutError(openTimeoutMs));
    }, openTimeoutMs);

    websocket.onopen = () => {
      cleanup();
      resolve();
    };
    websocket.onerror = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    websocket.onclose = () => {
      cleanup();
      reject(new Error("WebView debugger WebSocket closed before opening."));
    };
  });
}

export async function resolveSessionWebSocketUrl(
  options,
  loadWebSocketUrl = getTargetWebSocketUrl
) {
  const resolvedOptions = options ?? {};
  const debuggerSession =
    resolvedOptions.debuggerSession &&
    typeof resolvedOptions.debuggerSession === "object"
      ? resolvedOptions.debuggerSession
      : {};

  resolvedOptions.debuggerSession = debuggerSession;

  if (
    typeof debuggerSession.webSocketUrl === "string" &&
    debuggerSession.webSocketUrl.length > 0
  ) {
    return debuggerSession.webSocketUrl;
  }

  const webSocketUrl = await loadWebSocketUrl(
    resolvedOptions.debuggerListUrl ?? defaultDebuggerListUrl,
    resolvedOptions.targetPattern ?? defaultTargetPattern
  );

  debuggerSession.webSocketUrl = webSocketUrl;

  return webSocketUrl;
}

export function createCdpCommandSender(websocket, options = {}) {
  const pendingRequests = new Map();
  let nextRequestId = 1;
  const requestTimeoutMs = getCdpRequestTimeoutMs(options.requestTimeoutMs);

  const clearPendingRequest = (requestId) => {
    const pendingRequest = pendingRequests.get(requestId) ?? null;

    if (!pendingRequest) {
      return null;
    }

    clearTimeout(pendingRequest.timeoutId);
    pendingRequests.delete(requestId);

    return pendingRequest;
  };

  const rejectPending = (reason) => {
    for (const requestId of pendingRequests.keys()) {
      const pendingRequest = clearPendingRequest(requestId);

      pendingRequest?.reject(reason);
    }
  };

  websocket.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    if (payload.id) {
      const pendingRequest = clearPendingRequest(payload.id);

      pendingRequest?.resolve(payload);
    }
  };

  websocket.onclose = () => {
    rejectPending(new Error("WebView debugger WebSocket closed unexpectedly."));
  };

  return {
    send(method, params = {}) {
      const requestId = nextRequestId;
      nextRequestId += 1;

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingRequests.delete(requestId);
          websocket.close();
          reject(createCdpTimeoutError(method, requestTimeoutMs));
        }, requestTimeoutMs);

        pendingRequests.set(requestId, { resolve, reject, timeoutId });

        try {
          websocket.send(JSON.stringify({ id: requestId, method, params }));
        } catch (error) {
          clearPendingRequest(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close() {
      rejectPending(
        new Error("WebView debugger WebSocket closed unexpectedly.")
      );
      websocket.onclose = null;
      websocket.close();
    },
  };
}

export function assertCdpCommandSucceeded(response, method) {
  if (response?.error && typeof response.error === "object") {
    const errorCode =
      typeof response.error.code === "number"
        ? ` (${response.error.code})`
        : "";
    const errorMessage =
      typeof response.error.message === "string" &&
      response.error.message.length > 0
        ? response.error.message
        : "Unknown CDP protocol error.";

    throw new Error(
      `CDP command ${method} failed${errorCode}: ${errorMessage}`
    );
  }

  if (response?.result?.exceptionDetails) {
    const description =
      response.result.exceptionDetails.exception?.description ??
      response.result.exceptionDetails.text ??
      `${method} failed`;

    throw new Error(description);
  }
}

async function evaluateInWebView(expression, options = {}) {
  const webSocketUrl = await resolveSessionWebSocketUrl(options);
  const websocket = new WebSocket(webSocketUrl);

  await waitForWebSocketOpen(
    websocket,
    options.connectTimeoutMs ?? options.requestTimeoutMs
  );
  const cdpClient = createCdpCommandSender(websocket, options);

  let response;

  try {
    const enableResponse = await cdpClient.send("Runtime.enable");
    assertCdpCommandSucceeded(enableResponse, "Runtime.enable");
    response = await cdpClient.send("Runtime.evaluate", {
      expression,
      awaitPromise: options.awaitPromise ?? true,
      returnByValue: options.returnByValue ?? true,
    });
    assertCdpCommandSucceeded(response, "Runtime.evaluate");
  } finally {
    cdpClient.close();
  }

  return response.result?.result?.value;
}

async function waitFor(label, expression, predicate, options = {}) {
  const attempts = options.attempts ?? 60;
  const delayMs = options.delayMs ?? 250;
  let lastValue = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastValue = await evaluateInWebView(expression, options);

    if (predicate(lastValue)) {
      console.log(`WAIT_OK ${label} attempt=${attempt}`);
      return lastValue;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Timed out waiting for ${label}: ${formatJson(lastValue)}`);
}

async function ensureConfiguredRuntime(options) {
  const initialState = await evaluateInWebView(inspectStateExpression, options);

  if (initialState?.runtimeBootstrap?.configured === true) {
    return initialState;
  }

  const discoveryStart = await evaluateInWebView(
    buildDocumentCallExpression("startRuntimeDiscovery", options.runtimeUrl),
    options
  );
  console.log("DISCOVERY_START");
  console.log(formatJson(discoveryStart));

  await waitFor(
    "runtime discovery validation",
    discoveryReadyExpression,
    (value) =>
      Boolean(value?.confirmVisible) &&
      value?.confirmDisabled === false &&
      !value?.error,
    options
  );

  const discoveryConfirm = await evaluateInWebView(
    buildDocumentCallExpression("confirmRuntimeDiscovery"),
    options
  );
  console.log("DISCOVERY_CONFIRM");
  console.log(formatJson(discoveryConfirm));

  return waitFor(
    "configured runtime",
    inspectStateExpression,
    (value) => value?.runtimeBootstrap?.configured === true,
    options
  );
}

async function runLoginSmoke(options) {
  const configuredState = await ensureConfiguredRuntime(options);
  console.log("CONFIGURED_STATE");
  console.log(formatJson(configuredState));

  const loginRouteState = await evaluateInWebView(
    `(${ensureLoginFormRoute.toString()})(globalThis)`,
    options
  );
  console.log("LOGIN_ROUTE_STATE");
  console.log(formatJson(loginRouteState));

  await waitFor(
    "login form availability",
    loginFormReadyExpression,
    (value) => value?.hasLoginForm === true,
    options
  );

  const preLoginPushState = await waitFor(
    "pre-login push token readiness",
    preLoginPushReadyExpression,
    (value) => value?.currentToken != null || value?.disabledError != null,
    {
      ...options,
      attempts: 80,
      delayMs: 250,
    }
  );
  console.log("PRE_LOGIN_PUSH_STATE");
  console.log(formatJson(preLoginPushState));

  if (preLoginPushState?.disabledError) {
    throw new Error(
      `Push registration is disabled before login: ${preLoginPushState.disabledError}`
    );
  }

  const loginSubmitResult = await evaluateInWebView(
    buildDocumentCallExpression("submitLoginForm", {
      email: options.email,
      password: options.password,
    }),
    options
  );
  console.log("LOGIN_SUBMIT");
  console.log(formatJson(loginSubmitResult));

  const postLoginState = await waitFor(
    "native login completion",
    inspectStateExpression,
    (value) =>
      value?.nativeAuthState?.active === true || Boolean(value?.loginErrorText),
    options
  );
  console.log("POST_LOGIN_STATE");
  console.log(formatJson(postLoginState));

  if (postLoginState?.loginErrorText) {
    throw new Error(
      `Login failed in the WebView: ${postLoginState.loginErrorText}`
    );
  }

  const pushSyncState = await waitFor(
    "push registration sync",
    inspectStateExpression,
    (value) => {
      const syncState = value?.androidPushSyncState;
      return (
        syncState?.lastSyncedToken != null || syncState?.disabledError != null
      );
    },
    {
      ...options,
      attempts: 80,
      delayMs: 250,
    }
  );
  console.log("PUSH_SYNC_STATE");
  console.log(formatJson(pushSyncState));

  if (pushSyncState?.androidPushSyncState?.disabledError) {
    throw new Error(
      `Push sync disabled in the WebView: ${pushSyncState.androidPushSyncState.disabledError}`
    );
  }

  return {
    configuredState,
    postLoginState,
    pushSyncState,
  };
}

export function readRequiredEnv(name) {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main() {
  const action = process.argv[2] ?? "login";

  if (action !== "login") {
    throw new Error(`Unsupported action: ${action}`);
  }

  const result = await runLoginSmoke({
    debuggerListUrl: defaultDebuggerListUrl,
    targetPattern: defaultTargetPattern,
    runtimeUrl: defaultRuntimeUrl,
    email: readRequiredEnv("SECPAL_TEST_EMAIL"),
    password: readRequiredEnv("SECPAL_TEST_PASSWORD"),
  });

  console.log("SMOKE_OK");
  console.log(formatJson(result));
}

export function isDirectExecutionPath(
  entryPointArg,
  moduleUrl = import.meta.url
) {
  if (!entryPointArg) {
    return false;
  }

  return pathToFileURL(resolve(entryPointArg)).href === moduleUrl;
}

const isDirectExecution = isDirectExecutionPath(process.argv[1]);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
