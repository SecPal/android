/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const webviewScripts = [
  "webview-clear-runtime-bootstrap.mjs",
  "webview-go-home.mjs",
  "webview-login.mjs",
  "webview-open-about.mjs",
  "webview-set-locale.mjs",
] as const;

describe("WebView CDP helper scripts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("centralizes WebSocket request handling with close, error, and timeout rejection", () => {
    const helperPath = resolve(repoRoot, "scripts", "webview-cdp-client.mjs");

    expect(existsSync(helperPath)).toBe(true);

    const helper = readFileSync(helperPath, "utf8");
    expect(helper).toContain("setTimeout");
    expect(helper).toContain('addEventListener("close"');
    expect(helper).toContain('addEventListener("error"');
    expect(helper).toContain("exceptionDetails");
    expect(helper).toContain("unwrapEvaluationResult");

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

  it("fails closed on debugger-list HTTP errors with a bounded fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const cdpModulePath = "../scripts/webview-cdp-client.mjs";
    const { connectToWebViewTarget } = await import(cdpModulePath);

    await expect(
      connectToWebViewTarget({
        debuggerListUrl: "http://127.0.0.1:9223/json/list",
        targetPattern: /app\.secpal\.dev/,
      })
    ).rejects.toThrow("HTTP 503");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9223/json/list",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("fails fast when CDP evaluation throws or required navigation targets are missing", () => {
    const loginScript = readFileSync(
      resolve(repoRoot, "scripts", "webview-login.mjs"),
      "utf8"
    );
    const aboutScript = readFileSync(
      resolve(repoRoot, "scripts", "webview-open-about.mjs"),
      "utf8"
    );

    expect(loginScript).toContain("unwrapEvaluationResult");
    expect(loginScript).toContain("Runtime.evaluate");
    expect(loginScript).toContain("throw new Error");
    expect(loginScript).toContain("login form submission");

    expect(aboutScript).toContain("unwrapEvaluationResult");
    expect(aboutScript).toContain("throw new Error");
    expect(aboutScript).toContain("clicked: false");
    expect(aboutScript).toContain("Missing About navigation target");
  });
});
