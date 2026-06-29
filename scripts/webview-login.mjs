#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  connectToWebViewTarget,
  unwrapEvaluationResult,
} from "./webview-cdp-client.mjs";

const debuggerListUrl =
  process.env.SECPAL_WEBVIEW_DEVTOOLS_URL ?? "http://127.0.0.1:9223/json/list";
const targetPattern = new RegExp(
  process.env.SECPAL_WEBVIEW_TARGET_PATTERN ?? "app\\.secpal\\.dev"
);
const email = process.env.SECPAL_TEST_EMAIL ?? "test@example.com";
const password = process.env.SECPAL_TEST_PASSWORD ?? "password";

const expression = `(() => {
  const getRequiredElement = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing element: ' + id);
    return element;
  };
  const getNativeValueSetter = (element) => {
    const candidates = [];
    let prototype = Object.getPrototypeOf(element);
    while (prototype && prototype !== Object.prototype) {
      candidates.push(prototype);
      prototype = Object.getPrototypeOf(prototype);
    }
    candidates.push(window.HTMLInputElement.prototype, window.HTMLTextAreaElement.prototype, window.HTMLSelectElement.prototype);
    for (const candidate of candidates) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, 'value');
      if (typeof descriptor?.set === 'function') return descriptor.set;
    }
    throw new Error('No setter');
  };
  const setFormControlValue = (element, value) => {
    const setter = getNativeValueSetter(element);
    element.focus?.();
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const emailInput = getRequiredElement('email');
  const passwordInput = getRequiredElement('password');
  setFormControlValue(emailInput, ${JSON.stringify(email)});
  setFormControlValue(passwordInput, ${JSON.stringify(password)});
  const form = emailInput.closest('form');
  if (!form) throw new Error('No form');
  const submitButton = form.querySelector('button[type="submit"]');
  form.requestSubmit?.(submitButton ?? undefined);
  return {
    href: location.href,
    emailValue: emailInput.value,
    passwordLength: passwordInput.value.length,
    submitted: true,
  };
})()`;

const webView = await connectToWebViewTarget({
  debuggerListUrl,
  targetPattern,
});

try {
  await webView.send("Runtime.enable");

  const result = await webView.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  const value = unwrapEvaluationResult(result, "login form submission");
  console.log(JSON.stringify(value, null, 2));
} finally {
  webView.close();
}
