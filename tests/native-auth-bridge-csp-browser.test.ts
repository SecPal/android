/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
// @ts-expect-error The bridge generator intentionally remains Node-executable JavaScript.
import { buildNativeAuthBridgeBootstrapScript } from "../scripts/inject-native-auth-bridge.mjs";
import {
  browserProcessTimeoutMs,
  browserTestTimeoutMs,
  cleanupBrowserSmoke,
  remainingBrowserProcessTimeout,
  waitForBrowserClose,
  waitForServerListening,
  type BrowserExit,
} from "./native-auth-bridge-csp-browser-lifecycle";

const browserPath = [
  process.env.CHROME_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].find((candidate): candidate is string =>
  Boolean(candidate && existsSync(candidate))
);
const browserRequired = process.env.SECPAL_REQUIRE_CSP_BROWSER === "1";

if (browserRequired && !browserPath) {
  throw new Error(
    "Strict-CSP native-auth bridge browser coverage is mandatory in this environment. Set CHROME_BIN or install Chromium at a supported path."
  );
}

describe("native-auth bridge strict CSP browser smoke", () => {
  it.skipIf(!browserPath)(
    "installs the bridge from its same-origin asset without CSP violations or API traffic",
    async () => {
      const browserProcessDeadline = Date.now() + browserProcessTimeoutMs;
      const bridge = buildNativeAuthBridgeBootstrapScript(
        "https://runtime-bootstrap-required.secpal.dev"
      );
      const bridgeName = `secpal-native-auth-bridge.${createHash("sha256")
        .update(bridge, "utf8")
        .digest("hex")}.js`;
      const responses = new Map([
        [
          "/",
          `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'none'"><script src="/browser-stub.js"></script><script id="secpal-native-auth-bridge-bootstrap" src="/${bridgeName}"></script><script type="module" src="/application.js"></script></head><body><pre id="result">pending</pre></body></html>`,
        ],
        [
          "/browser-stub.js",
          `globalThis.__cspViolations = [];
globalThis.__apiCalls = 0;
globalThis.addEventListener("securitypolicyviolation", (event) => {
  globalThis.__cspViolations.push(event.violatedDirective);
});
globalThis.fetch = () => {
  globalThis.__apiCalls += 1;
  return Promise.reject(new Error("Unexpected API call"));
};
globalThis.Capacitor = {
  Plugins: {
    SecPalNativeAuth: {
      getRuntimeBootstrap: async () => ({ configured: false }),
      getPasskeyCapabilities: async () => ({ passkeysAvailable: false }),
    },
    SecPalEnterprise: {
      addListener: async () => ({ remove: async () => {} }),
    },
  },
};`,
        ],
        [`/${bridgeName}`, bridge],
        [
          "/application.js",
          `setTimeout(() => {
  document.getElementById("result").textContent = JSON.stringify({
    bridgeType: typeof globalThis.SecPalNativeAuthBridge,
    bootstrapInstalled: globalThis.__SecPalNativeAuthBootstrapInstalled === true,
    cspViolations: globalThis.__cspViolations,
    apiCalls: globalThis.__apiCalls,
  });
}, 100);`,
        ],
      ]);
      const server = createServer((request, response) => {
        const body = responses.get(request.url ?? "");
        if (body === undefined) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          "Content-Type": request.url?.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/html; charset=utf-8",
        });
        response.end(body);
      });
      let browser: ChildProcessWithoutNullStreams | undefined;
      let browserClosed: Promise<BrowserExit> | undefined;

      try {
        server.listen(0, "127.0.0.1");
        await waitForServerListening(
          once(server, "listening"),
          remainingBrowserProcessTimeout(browserProcessDeadline)
        );
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Browser smoke server did not expose a TCP port.");
        }
        browser = spawn(browserPath!, [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-background-networking",
          "--disable-component-update",
          "--dump-dom",
          "--virtual-time-budget=1000",
          `http://127.0.0.1:${address.port}/`,
        ]);
        browserClosed = once(browser, "close") as Promise<BrowserExit>;
        let stdout = "";
        let stderr = "";
        browser.stdout.setEncoding("utf8");
        browser.stderr.setEncoding("utf8");
        browser.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        browser.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        const [exitCode] = await waitForBrowserClose(
          browser,
          browserClosed,
          remainingBrowserProcessTimeout(browserProcessDeadline)
        );

        expect(exitCode, stderr).toBe(0);
        expect(stdout).toContain('"bridgeType":"object"');
        expect(stdout).toContain('"bootstrapInstalled":true');
        expect(stdout).toContain('"cspViolations":[]');
        expect(stdout).toContain('"apiCalls":0');
      } finally {
        await cleanupBrowserSmoke(browser, browserClosed, server);
      }
    },
    browserTestTimeoutMs
  );
});
