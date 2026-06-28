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
      if (payload.id !== id) return;
      ws.removeEventListener("message", handler);
      if (payload.error) reject(new Error(payload.error.message || method));
      else resolve(payload.result);
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Runtime.enable");

const result = await send("Runtime.evaluate", {
  expression: `(() => {
    const candidates = [...document.querySelectorAll('button,[role="button"],a')];
    const target = candidates.find((element) =>
      /^(About|Über uns)$/.test((element.textContent ?? '').trim())
    );
    if (!target) {
      return {
        clicked: false,
        labels: candidates
          .map((element) => (element.textContent ?? '').trim())
          .filter(Boolean)
          .slice(0, 20),
      };
    }
    target.click();
    return { clicked: true, label: (target.textContent ?? '').trim() };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

console.log(JSON.stringify(result.result.value, null, 2));
ws.close();
