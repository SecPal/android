#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const debuggerListUrl =
  process.env.SECPAL_WEBVIEW_DEVTOOLS_URL ?? "http://127.0.0.1:9223/json/list";
const targetPattern = new RegExp(
  process.env.SECPAL_WEBVIEW_TARGET_PATTERN ?? "app\\.secpal\\.dev"
);
const email = process.env.SECPAL_TEST_EMAIL ?? "test@example.com";
const password = process.env.SECPAL_TEST_PASSWORD ?? "password";

const list = await fetch(debuggerListUrl).then((response) => response.json());
const target = list.find(
  (entry) => entry?.type === "page" && targetPattern.test(entry.url ?? "")
);

if (!target?.webSocketDebuggerUrl) {
  throw new Error("No WebView target found");
}

const ws = new WebSocket(target.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const handler = (event) => {
      const payload = JSON.parse(event.data);

      if (payload.id !== id) {
        return;
      }

      ws.removeEventListener("message", handler);

      if (payload.error) {
        reject(new Error(payload.error.message || method));
        return;
      }

      resolve(payload.result);
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Runtime.enable");

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

const result = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});

console.log(JSON.stringify(result.result.value, null, 2));
ws.close();
