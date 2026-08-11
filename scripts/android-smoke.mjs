#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  connectToWebViewTarget,
  unwrapEvaluationResult,
} from "./webview-cdp-client.mjs";
import {
  buildDocumentCallExpression,
  ensureLoginFormRoute,
} from "./webview-live-auth-smoke.mjs";

const defaultDebuggerListUrl =
  process.env.SECPAL_WEBVIEW_DEVTOOLS_URL ?? "http://127.0.0.1:9223/json/list";
const defaultRuntimeUrl =
  process.env.SECPAL_RUNTIME_URL ?? "https://api.secpal.dev";
const defaultTargetPattern = new RegExp(
  process.env.SECPAL_WEBVIEW_TARGET_PATTERN ?? "app\\.secpal\\.dev"
);
const defaultAttempts = 90;
const defaultDelayMs = 500;
const defaultWaitTimeoutMs = 45_000;

const smokeStateFields = [
  "href",
  "runtimeConfigured",
  "runtimeApiOrigin",
  "nativeAuthActive",
  "protectedUserEmail",
  "hasLoginForm",
  "hasDiscovery",
  "hasAuthenticatedShell",
  "hasUserMenu",
  "hasProfileAction",
  "hasSignOutAction",
  "hasSwitchDialogAction",
  "profileHeadingVisible",
  "profileEmailVisible",
  "tenantBrowserStateCleared",
  "loginError",
  "discoveryError",
];

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function sanitizeSmokeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    smokeStateFields
      .filter((field) => Object.hasOwn(value, field))
      .map((field) => [field, value[field]])
  );
}

export function sanitizeDiagnosticText(value, secrets = []) {
  let sanitized = String(value)
    .replace(
      /(Authorization\s*[:=]\s*)(?!\[REDACTED\])[^\r\n]+/gi,
      "$1[REDACTED]"
    )
    .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:^|[?&,\s{])["']?(?:[a-z0-9_-]*token|password|client[_-]?secret)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^&,\s}\]\r\n]+)/gim,
      (_match, prefix, secretValue) => {
        const quote = /^["']/.test(secretValue) ? secretValue[0] : "";
        return `${prefix}${quote}[REDACTED]${quote}`;
      }
    );

  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
  }

  return sanitized;
}

export async function inspectTenantBrowserState(globalLike) {
  try {
    const allowedLocalStorageKeys = new Set(["secpal-locale"]);
    const localStorage = globalLike.localStorage;
    if (
      !localStorage ||
      typeof localStorage.length !== "number" ||
      typeof localStorage.key !== "function"
    ) {
      return { cleared: false };
    }

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (typeof key !== "string" || !allowedLocalStorageKeys.has(key)) {
        return { cleared: false };
      }
    }

    if ((globalLike.sessionStorage?.length ?? 0) !== 0) {
      return { cleared: false };
    }

    if (
      globalLike.caches &&
      (typeof globalLike.caches.keys !== "function" ||
        (await globalLike.caches.keys()).length !== 0)
    ) {
      return { cleared: false };
    }

    if (
      globalLike.indexedDB &&
      (typeof globalLike.indexedDB.databases !== "function" ||
        (await globalLike.indexedDB.databases()).length !== 0)
    ) {
      return { cleared: false };
    }

    const serviceWorker = globalLike.navigator?.serviceWorker;
    if (
      serviceWorker &&
      (typeof serviceWorker.getRegistrations !== "function" ||
        (await serviceWorker.getRegistrations()).length !== 0)
    ) {
      return { cleared: false };
    }

    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

export function clickProfileMenuItem(globalLike) {
  const isVisible = (element) =>
    Boolean(element) &&
    element.getClientRects().length > 0 &&
    globalLike.getComputedStyle(element).visibility !== "hidden";
  const item = Array.from(
    globalLike.document?.querySelectorAll?.('[role="menuitem"]') ?? []
  ).find(
    (element) =>
      isVisible(element) && element.getAttribute?.("href") === "/profile"
  );
  if (!item) {
    throw new Error("Missing profile menu item.");
  }
  item.click();
  return { action: "open-profile" };
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoUiError(state) {
  requireCondition(
    !state.loginError,
    `Unexpected login error: ${state.loginError}`
  );
  requireCondition(
    !state.discoveryError,
    `Unexpected discovery error: ${state.discoveryError}`
  );
}

function assertConfiguredLoggedOut(state, expected, checkpoint) {
  requireCondition(
    state.runtimeConfigured === true,
    `${checkpoint}: runtime bootstrap is not configured.`
  );
  requireCondition(
    state.runtimeApiOrigin === expected.runtimeOrigin,
    `${checkpoint}: unexpected runtime API origin.`
  );
  requireCondition(
    state.nativeAuthActive !== true,
    `${checkpoint}: native auth unexpectedly remains active.`
  );
  requireCondition(
    state.protectedUserEmail === null,
    `${checkpoint}: the native session is still authenticated.`
  );
  requireCondition(
    state.hasLoginForm === true,
    `${checkpoint}: login form is not visible.`
  );
  requireCondition(
    state.hasDiscovery !== true,
    `${checkpoint}: instance discovery unexpectedly reappeared.`
  );
}

export function assertSmokeState(checkpoint, rawState, expected) {
  const state = sanitizeSmokeState(rawState);
  assertNoUiError(state);

  switch (checkpoint) {
    case "initial":
      requireCondition(
        state.runtimeConfigured === false,
        "initial: runtime bootstrap is already configured."
      );
      requireCondition(
        state.nativeAuthActive !== true,
        "initial: native auth is already active."
      );
      requireCondition(
        state.hasDiscovery === true,
        "initial: instance discovery is not visible."
      );
      requireCondition(
        state.hasLoginForm !== true,
        "initial: login form is visible before discovery."
      );
      break;
    case "configured":
    case "login-persisted":
    case "logout-persisted":
    case "final-login":
      assertConfiguredLoggedOut(state, expected, checkpoint);
      break;
    case "authenticated":
      requireCondition(
        state.runtimeConfigured === true &&
          state.runtimeApiOrigin === expected.runtimeOrigin,
        "authenticated: runtime bootstrap changed unexpectedly."
      );
      requireCondition(
        state.nativeAuthActive === true,
        "authenticated: native auth is not active."
      );
      requireCondition(
        state.protectedUserEmail === expected.email,
        "authenticated: protected user read returned an unexpected email."
      );
      requireCondition(
        state.hasAuthenticatedShell === true,
        "authenticated: application view is not visible."
      );
      break;
    case "protected-profile":
    case "lifecycle":
      requireCondition(
        state.runtimeConfigured === true &&
          state.runtimeApiOrigin === expected.runtimeOrigin,
        `${checkpoint}: runtime bootstrap changed unexpectedly.`
      );
      requireCondition(
        state.nativeAuthActive === true,
        `${checkpoint}: native auth is not active.`
      );
      requireCondition(
        state.protectedUserEmail === expected.email,
        `${checkpoint}: protected user read returned an unexpected email.`
      );
      requireCondition(
        state.href?.endsWith("/profile") === true,
        `${checkpoint}: protected profile route is not active.`
      );
      requireCondition(
        state.profileHeadingVisible === true &&
          state.profileEmailVisible === true,
        `${checkpoint}: protected profile view does not show the expected profile.`
      );
      break;
    case "logged-out":
      assertConfiguredLoggedOut(state, expected, checkpoint);
      requireCondition(
        state.href?.includes("/login") === true,
        "logged-out: protected route did not return to login."
      );
      break;
    case "switched":
      requireCondition(
        state.runtimeConfigured === false,
        "switched: runtime bootstrap was not cleared."
      );
      requireCondition(
        state.nativeAuthActive !== true,
        "switched: native auth unexpectedly remains active."
      );
      requireCondition(
        state.hasDiscovery === true,
        "switched: instance discovery did not reappear."
      );
      requireCondition(
        state.tenantBrowserStateCleared === true,
        "switched: tenant-scoped browser state was not cleared."
      );
      break;
    default:
      throw new Error(`Unknown Android smoke checkpoint: ${checkpoint}`);
  }

  return state;
}

function buildInspectStateExpression(expectedEmail) {
  return `(async () => {
    const runtime = (await globalThis.Capacitor?.Plugins?.SecPalNativeAuth?.getRuntimeBootstrap?.()) ?? null;
    const bodyText = globalThis.document?.body?.innerText ?? '';
    const normalizedBodyText = bodyText.toLocaleLowerCase();
    const inspectTenantBrowserState = ${inspectTenantBrowserState.toString()};
    const tenantBrowserState = await inspectTenantBrowserState(globalThis);
    const roleItems = Array.from(globalThis.document?.querySelectorAll?.('[role="menuitem"]') ?? []);
    const dialogButtons = Array.from(globalThis.document?.querySelectorAll?.('[role="alertdialog"] button') ?? []);
    const textMatches = (element, pattern) => pattern.test(element?.textContent?.trim?.() ?? '');
    const isVisible = (element) => Boolean(element) && element.getClientRects().length > 0 && globalThis.getComputedStyle(element).visibility !== 'hidden';
    return {
      href: globalThis.location?.href ?? null,
      runtimeConfigured: runtime?.configured === true,
      runtimeApiOrigin: runtime?.bootstrap?.apiOrigin ?? null,
      nativeAuthActive: globalThis.__SecPalNativeAuthState?.active === true,
      hasLoginForm: Boolean(globalThis.document?.getElementById?.('email')) && Boolean(globalThis.document?.getElementById?.('password')),
      hasDiscovery: Boolean(globalThis.document?.getElementById?.('secpal-instance-discovery-url')),
      hasAuthenticatedShell: Boolean(globalThis.document?.querySelector?.('[data-slot="sidebar-trigger"]')) || Array.from(globalThis.document?.querySelectorAll?.('button[aria-label="User menu"], button[aria-label="Benutzermenü"]') ?? []).some(isVisible),
      hasUserMenu: Array.from(globalThis.document?.querySelectorAll?.('button[aria-label="User menu"], button[aria-label="Benutzermenü"]') ?? []).some(isVisible),
      hasProfileAction: roleItems.some((element) => isVisible(element) && element?.getAttribute?.('href') === '/profile'),
      hasSignOutAction: roleItems.some((element) => isVisible(element) && textMatches(element, /^(Sign out|Abmelden)$/i)),
      hasSwitchDialogAction: dialogButtons.some((element) => isVisible(element) && textMatches(element, /^(Switch instance|Instanz wechseln)$/i)),
      profileHeadingVisible: Array.from(globalThis.document?.querySelectorAll?.('h1') ?? []).some((element) => isVisible(element) && textMatches(element, /^(My profile|Mein Profil)$/i)),
      profileEmailVisible: normalizedBodyText.includes(${JSON.stringify(expectedEmail.toLowerCase())}),
      tenantBrowserStateCleared: tenantBrowserState.cleared,
      loginError: globalThis.document?.getElementById?.('login-error')?.innerText?.trim?.() ?? '',
      discoveryError: globalThis.document?.getElementById?.('secpal-instance-discovery-error')?.innerText?.trim?.() ?? '',
    };
  })()`;
}

const discoveryReadyExpression = `(() => {
  const confirm = globalThis.document?.getElementById?.('secpal-instance-discovery-confirm');
  const error = globalThis.document?.getElementById?.('secpal-instance-discovery-error');
  return {
    ready: Boolean(confirm) && confirm.disabled === false,
    error: error?.innerText?.trim?.() ?? '',
  };
})()`;

const openUserMenuExpression = `(() => {
  const isVisible = (element) => Boolean(element) && element.getClientRects().length > 0 && globalThis.getComputedStyle(element).visibility !== 'hidden';
  const userMenu = Array.from(globalThis.document?.querySelectorAll?.('button[aria-label="User menu"], button[aria-label="Benutzermenü"]') ?? []).find(isVisible);
  if (userMenu) {
    userMenu.click();
    return { action: 'open-user-menu' };
  }
  const sidebarTrigger = globalThis.document?.querySelector?.('[data-slot="sidebar-trigger"]');
  if (!sidebarTrigger) {
    throw new Error('Missing mobile navigation trigger.');
  }
  sidebarTrigger.click();
  return { action: 'open-sidebar' };
})()`;

const clickUserMenuExpression = `(() => {
  const isVisible = (element) => Boolean(element) && element.getClientRects().length > 0 && globalThis.getComputedStyle(element).visibility !== 'hidden';
  const userMenu = Array.from(globalThis.document?.querySelectorAll?.('button[aria-label="User menu"], button[aria-label="Benutzermenü"]') ?? []).find(isVisible);
  if (!userMenu) {
    throw new Error('Missing user menu trigger.');
  }
  userMenu.click();
  return { action: 'open-user-menu' };
})()`;

const clickProfileExpression = `(${clickProfileMenuItem.toString()})(globalThis)`;

const clickSignOutExpression = `(() => {
  const isVisible = (element) => Boolean(element) && element.getClientRects().length > 0 && globalThis.getComputedStyle(element).visibility !== 'hidden';
  const item = Array.from(globalThis.document?.querySelectorAll?.('[role="menuitem"]') ?? [])
    .find((element) => isVisible(element) && /^(Sign out|Abmelden)$/i.test(element?.textContent?.trim?.() ?? ''));
  if (!item) {
    throw new Error('Missing sign-out menu item.');
  }
  item.click();
  return { action: 'sign-out' };
})()`;

const openSwitchDialogExpression = `(() => {
  const trigger = globalThis.document?.getElementById?.('secpal-runtime-switch-instance');
  if (!trigger) {
    throw new Error('Missing switch-instance trigger.');
  }
  trigger.click();
  return { action: 'open-switch-dialog' };
})()`;

const confirmSwitchExpression = `(() => {
  const isVisible = (element) => Boolean(element) && element.getClientRects().length > 0 && globalThis.getComputedStyle(element).visibility !== 'hidden';
  const action = Array.from(globalThis.document?.querySelectorAll?.('[role="alertdialog"] button') ?? [])
    .find((element) => isVisible(element) && /^(Switch instance|Instanz wechseln)$/i.test(element?.textContent?.trim?.() ?? ''));
  if (!action) {
    throw new Error('Missing switch-instance confirmation action.');
  }
  action.click();
  return { action: 'confirm-switch' };
})()`;

async function evaluateInWebView(expression, options) {
  const client = await connectToWebViewTarget({
    debuggerListUrl: options.debuggerListUrl,
    targetPattern: options.targetPattern,
  });

  try {
    await client.send("Runtime.enable");
    const result = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return unwrapEvaluationResult(result, "Android smoke evaluation");
  } finally {
    client.close();
  }
}

async function inspectState(options) {
  const state = await evaluateInWebView(
    buildInspectStateExpression(options.email),
    options
  );
  return sanitizeSmokeState(state);
}

async function readProtectedUserEmail(options) {
  return evaluateInWebView(
    `(async () => {
      try {
        const user = await globalThis.Capacitor?.Plugins?.SecPalNativeAuth?.getCurrentUser?.();
        return typeof user?.email === 'string' ? user.email : null;
      } catch {
        return null;
      }
    })()`,
    options
  );
}

async function waitFor(label, probe, predicate, options) {
  let lastValue = null;
  let lastError = null;
  const deadline = Date.now() + defaultWaitTimeoutMs;

  for (
    let attempt = 1;
    attempt <= defaultAttempts && Date.now() < deadline;
    attempt += 1
  ) {
    try {
      lastValue = await probe();
      lastError = null;
      if (predicate(lastValue)) {
        console.log(`WAIT_OK ${label} attempt=${attempt}`);
        return lastValue;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, Math.min(defaultDelayMs, remainingMs))
      );
    }
  }

  const detail = lastError ?? JSON.stringify(sanitizeSmokeState(lastValue));
  throw new Error(`Timed out waiting for ${label}: ${detail}`);
}

async function waitForState(label, predicate, options) {
  return waitFor(label, () => inspectState(options), predicate, options);
}

async function configureRuntime(options, checkpoint = "configured") {
  await evaluateInWebView(
    buildDocumentCallExpression("startRuntimeDiscovery", options.runtimeUrl),
    options
  );
  await waitFor(
    "runtime discovery validation",
    () => evaluateInWebView(discoveryReadyExpression, options),
    (value) => value?.ready === true || Boolean(value?.error),
    options
  ).then((value) => {
    requireCondition(
      !value?.error,
      `Unexpected discovery error: ${value.error}`
    );
  });
  await evaluateInWebView(
    buildDocumentCallExpression("confirmRuntimeDiscovery"),
    options
  );
  const state = await waitForState(
    "configured runtime and login form",
    (value) => value.runtimeConfigured === true && value.hasLoginForm === true,
    options
  );
  state.protectedUserEmail = await readProtectedUserEmail(options);
  return assertSmokeState(checkpoint, state, options.expected);
}

async function openAuthenticatedUserMenu(options) {
  const navigationAction = await evaluateInWebView(
    openUserMenuExpression,
    options
  );
  if (navigationAction?.action === "open-sidebar") {
    await waitForState(
      "mobile user menu trigger",
      (value) => value.hasUserMenu === true,
      options
    );
    await evaluateInWebView(clickUserMenuExpression, options);
  }
}

async function runAction(action, options) {
  let state;

  switch (action) {
    case "initial":
      state = await waitForState(
        "fresh instance discovery",
        (value) => value.hasDiscovery === true,
        options
      );
      return assertSmokeState("initial", state, options.expected);
    case "configure":
      return configureRuntime(options);
    case "login-persisted":
    case "logout-persisted":
      state = await waitForState(
        `${action} login form`,
        (value) => value.hasLoginForm === true,
        options
      );
      state.protectedUserEmail = await readProtectedUserEmail(options);
      return assertSmokeState(action, state, options.expected);
    case "login": {
      await evaluateInWebView(
        `(${ensureLoginFormRoute.toString()})(globalThis)`,
        options
      );
      await waitForState(
        "login form",
        (value) => value.hasLoginForm === true,
        options
      );
      await evaluateInWebView(
        buildDocumentCallExpression("submitLoginForm", {
          email: options.email,
          password: options.password,
        }),
        options
      );
      state = await waitForState(
        "authenticated application view",
        (value) =>
          (value.nativeAuthActive === true &&
            value.hasAuthenticatedShell === true) ||
          Boolean(value.loginError),
        options
      );
      assertNoUiError(state);
      state.protectedUserEmail = await readProtectedUserEmail(options);
      return assertSmokeState("authenticated", state, options.expected);
    }
    case "protected-profile":
      await openAuthenticatedUserMenu(options);
      await waitForState(
        "profile menu item",
        (value) => value.hasProfileAction === true,
        options
      );
      await evaluateInWebView(clickProfileExpression, options);
      state = await waitForState(
        "protected profile view",
        (value) =>
          value.href?.endsWith("/profile") === true &&
          value.profileHeadingVisible === true &&
          value.profileEmailVisible === true,
        options
      );
      state.protectedUserEmail = await readProtectedUserEmail(options);
      return assertSmokeState("protected-profile", state, options.expected);
    case "lifecycle":
      state = await waitForState(
        "authenticated foreground profile",
        (value) =>
          value.nativeAuthActive === true &&
          value.profileHeadingVisible === true &&
          value.profileEmailVisible === true,
        options
      );
      state.protectedUserEmail = await readProtectedUserEmail(options);
      return assertSmokeState("lifecycle", state, options.expected);
    case "logout":
      await openAuthenticatedUserMenu(options);
      await waitForState(
        "sign-out menu item",
        (value) => value.hasSignOutAction === true,
        options
      );
      await evaluateInWebView(clickSignOutExpression, options);
      await waitForState(
        "login after UI logout",
        (value) =>
          value.hasLoginForm === true && value.nativeAuthActive !== true,
        options
      );
      await evaluateInWebView(
        "globalThis.location.assign('/profile'); ({ action: 'probe-protected-route' })",
        options
      );
      state = await waitForState(
        "protected route rejection after logout",
        (value) =>
          value.hasLoginForm === true &&
          value.href?.includes("/login") === true,
        options
      );
      state.protectedUserEmail = await readProtectedUserEmail(options);
      return assertSmokeState("logged-out", state, options.expected);
    case "switch-instance":
      await evaluateInWebView(openSwitchDialogExpression, options);
      await waitForState(
        "switch-instance confirmation",
        (value) => value.hasSwitchDialogAction === true,
        options
      );
      await evaluateInWebView(confirmSwitchExpression, options);
      state = await waitForState(
        "instance discovery after switch",
        (value) =>
          value.runtimeConfigured === false && value.hasDiscovery === true,
        options
      );
      return assertSmokeState("switched", state, options.expected);
    case "final-configure":
      return configureRuntime(options, "final-login");
    case "inspect":
      return inspectState(options);
    default:
      throw new Error(`Unsupported Android smoke action: ${action}`);
  }
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const action = process.argv[2] ?? "";

  if (action === "sanitize") {
    const input = readFileSync(0, "utf8");
    process.stdout.write(
      sanitizeDiagnosticText(input, [
        process.env.SECPAL_TEST_PASSWORD ?? "",
        process.env.SECPAL_AUTH_TOKEN ?? "",
      ])
    );
    return;
  }

  const email = process.env.SECPAL_TEST_EMAIL ?? "test@example.com";
  const runtimeOrigin = normalizeOrigin(defaultRuntimeUrl);
  const options = {
    debuggerListUrl: defaultDebuggerListUrl,
    targetPattern: defaultTargetPattern,
    runtimeUrl: defaultRuntimeUrl,
    email,
    password: action === "login" ? readRequiredEnv("SECPAL_TEST_PASSWORD") : "",
    expected: { email, runtimeOrigin },
  };
  const result = await runAction(action, options);
  if (action === "inspect") {
    process.stdout.write(
      `${JSON.stringify(sanitizeSmokeState(result), null, 2)}\n`
    );
    return;
  }
  console.log(`ANDROID_SMOKE_OK action=${action}`);
  console.log(JSON.stringify(sanitizeSmokeState(result), null, 2));
}

export function isDirectExecutionPath(
  entryPointArg,
  moduleUrl = import.meta.url
) {
  return (
    Boolean(entryPointArg) &&
    pathToFileURL(resolve(entryPointArg)).href === moduleUrl
  );
}

if (isDirectExecutionPath(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
