#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { connectToWebViewTarget } from "./webview-cdp-client.mjs";

const debuggerListUrl =
  process.env.SECPAL_WEBVIEW_DEVTOOLS_URL ?? "http://127.0.0.1:9223/json/list";
const targetPattern = new RegExp(
  process.env.SECPAL_WEBVIEW_TARGET_PATTERN ?? "app\\.secpal\\.dev"
);

const webView = await connectToWebViewTarget({
  debuggerListUrl,
  targetPattern,
});

try {
  await webView.send("Runtime.enable");

  const result = await webView.send("Runtime.evaluate", {
    expression: `(() => {
    const candidates = [...document.querySelectorAll('button,[role="button"],a')];
    const target = candidates.find((element) =>
      /^(Back to Home|Zurück zur Startseite|Zur Startseite)$/.test(
        (element.textContent ?? '').trim()
      )
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
} finally {
  webView.close();
}
