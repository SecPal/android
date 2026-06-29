/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const webviewScripts = [
  "webview-clear-runtime-bootstrap.mjs",
  "webview-go-home.mjs",
  "webview-login.mjs",
  "webview-open-about.mjs",
  "webview-set-locale.mjs",
] as const;

describe("WebView CDP helper scripts", () => {
  it("centralizes WebSocket request handling with close, error, and timeout rejection", () => {
    const helperPath = resolve(repoRoot, "scripts", "webview-cdp-client.mjs");

    expect(existsSync(helperPath)).toBe(true);

    const helper = readFileSync(helperPath, "utf8");
    expect(helper).toContain("setTimeout");
    expect(helper).toContain('addEventListener("close"');
    expect(helper).toContain('addEventListener("error"');

    for (const scriptName of webviewScripts) {
      const script = readFileSync(
        resolve(repoRoot, "scripts", scriptName),
        "utf8"
      );

      expect(script).toContain("connectToWebViewTarget");
      expect(script).not.toContain("new WebSocket");
      expect(script).not.toContain("let nextId");
    }
  });
});
