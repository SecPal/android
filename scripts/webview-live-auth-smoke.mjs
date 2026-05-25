#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const defaultDebuggerListUrl =
  process.env.SECPAL_WEBVIEW_DEVTOOLS_URL ?? "http://127.0.0.1:9223/json/list";
const defaultRuntimeUrl =
  process.env.SECPAL_RUNTIME_URL ?? "https://api.secpal.dev";
const defaultTargetPattern =
  process.env.SECPAL_WEBVIEW_TARGET_PATTERN ?? "app\\.secpal\\.dev";

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
    getNativeValueSetter,
    setFormControlValue,
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

async function evaluateInWebView(expression, options = {}) {
  const webSocketUrl = await getTargetWebSocketUrl(
    options.debuggerListUrl ?? defaultDebuggerListUrl,
    options.targetPattern ?? defaultTargetPattern
  );
  const websocket = new WebSocket(webSocketUrl);
  const pendingRequests = new Map();
  let nextRequestId = 1;

  await new Promise((resolve, reject) => {
    websocket.onopen = resolve;
    websocket.onerror = reject;
  });

  websocket.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    if (payload.id && pendingRequests.has(payload.id)) {
      pendingRequests.get(payload.id)(payload);
      pendingRequests.delete(payload.id);
    }
  };

  const send = (method, params = {}) => {
    const requestId = nextRequestId;
    nextRequestId += 1;
    websocket.send(JSON.stringify({ id: requestId, method, params }));
    return new Promise((resolve) => pendingRequests.set(requestId, resolve));
  };

  await send("Runtime.enable");
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: options.awaitPromise ?? true,
    returnByValue: options.returnByValue ?? true,
  });

  websocket.close();

  if (response.result?.exceptionDetails) {
    const description =
      response.result.exceptionDetails.exception?.description ??
      response.result.exceptionDetails.text ??
      "Runtime.evaluate failed";

    throw new Error(description);
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
      value?.nativeAuthState?.active === true ||
      Boolean(value?.loginErrorText),
    options
  );
  console.log("POST_LOGIN_STATE");
  console.log(formatJson(postLoginState));

  if (postLoginState?.loginErrorText) {
    throw new Error(`Login failed in the WebView: ${postLoginState.loginErrorText}`);
  }

  const pushSyncState = await waitFor(
    "push registration sync",
    inspectStateExpression,
    (value) => {
      const syncState = value?.androidPushSyncState;
      return syncState?.lastSyncedToken != null || syncState?.disabledError != null;
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

function readRequiredEnv(name) {
  const value = process.env[name]?.trim() ?? "";

  if (!value) {
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

const isDirectExecution =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
