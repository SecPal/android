/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Node-executable project helper.
import * as nativeAuthBridgeInjector from "../scripts/inject-native-auth-bridge.mjs";
import { runChromiumBrowserSmoke } from "./android-runtime-browser-smoke-process";

const { buildNativeAuthBridgeAsset, injectNativeAuthBridgeBootstrap } =
  nativeAuthBridgeInjector;

const chromiumPath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium"].find(
  (candidate): candidate is string =>
    typeof candidate === "string" && existsSync(candidate)
);
const activeServers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...activeServers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  activeServers.clear();
});

describe.skipIf(!chromiumPath)("Android runtime browser smoke", () => {
  it("installs the external bridge without strict-CSP violations", async () => {
    const bridgeAsset = buildNativeAuthBridgeAsset(
      "https://runtime-bootstrap-required.secpal.dev"
    );
    const baseHtml = [
      "<!doctype html>",
      "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'self'; script-src 'self'; script-src-attr 'none'; object-src 'none'\">",
      '<script src="/mock-capacitor.js"></script>',
      '<script type="module" src="/probe.js"></script>',
      "</head><body></body></html>",
    ].join("");
    const indexHtml = injectNativeAuthBridgeBootstrap(
      baseHtml,
      bridgeAsset.sourcePath
    );
    const assets = new Map<string, { content: string; type: string }>([
      ["/", { content: indexHtml, type: "text/html; charset=utf-8" }],
      [
        "/mock-capacitor.js",
        {
          content: `
globalThis.__cspViolations = [];
globalThis.addEventListener("securitypolicyviolation", (event) => {
  globalThis.__cspViolations.push({
    blockedURI: event.blockedURI,
    directive: event.effectiveDirective,
  });
});
const listenerHandle = Promise.resolve({ remove() {} });
globalThis.Capacitor = {
  Plugins: {
    SecPalNativeAuth: {
      addListener() { return listenerHandle; },
      getRuntimeBootstrap() { return Promise.resolve({ configured: false }); },
      isNetworkAvailable() { return Promise.resolve({ available: true }); },
    },
    SecPalEnterprise: {
      addListener() { return listenerHandle; },
    },
  },
};
`.trim(),
          type: "text/javascript; charset=utf-8",
        },
      ],
      [
        bridgeAsset.sourcePath,
        {
          content: bridgeAsset.content,
          type: "text/javascript; charset=utf-8",
        },
      ],
      [
        "/probe.js",
        {
          content: `
document.body.id = "secpal-browser-smoke-result";
document.body.textContent = JSON.stringify({
  bootstrapInstalled:
    globalThis.__SecPalNativeAuthBootstrapInstalled === true,
  bridgeType: typeof globalThis.SecPalNativeAuthBridge,
  cspViolations: globalThis.__cspViolations,
});
`.trim(),
          type: "text/javascript; charset=utf-8",
        },
      ],
    ]);
    const server = createServer((request, response) => {
      const asset = assets.get(
        new URL(request.url ?? "/", "http://local").pathname
      );
      if (!asset) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; connect-src 'self'; script-src 'self'; script-src-attr 'none'; object-src 'none'",
        "Content-Type": asset.type,
      });
      response.end(asset.content);
    });
    activeServers.add(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve local browser smoke server address.");
    }

    const result = await runChromiumBrowserSmoke({
      chromiumPath: chromiumPath!,
      arguments: [
        "--headless=new",
        "--no-sandbox",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-sync",
        "--dump-dom",
        `http://127.0.0.1:${address.port}/`,
      ],
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('id="secpal-browser-smoke-result"');
    expect(result.stdout).toContain('"bootstrapInstalled":true');
    expect(result.stdout).toContain('"bridgeType":"object"');
    expect(result.stdout).toContain('"cspViolations":[]');
    expect(result.stderr).not.toMatch(
      /Content Security Policy|Refused to (?:execute|load)/iu
    );
  }, 70_000);
});
