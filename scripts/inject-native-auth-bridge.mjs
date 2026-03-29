#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal
// SPDX-License-Identifier: MIT

import { readFileSync, writeFileSync } from "node:fs";

const BOOTSTRAP_SCRIPT_ID = "secpal-native-auth-bridge-bootstrap";

export function readApiBaseUrlFromStringsXml(stringsXml) {
  const match = stringsXml.match(
    /<string\s+name="api_base_url">([^<]+)<\/string>/
  );

  if (!match) {
    throw new Error(
      "Android strings.xml is missing the api_base_url string resource"
    );
  }

  return match[1].trim();
}

export function buildNativeAuthBridgeBootstrapScript(apiBaseUrl) {
  const serializedApiBaseUrl = JSON.stringify(apiBaseUrl);

  return [
    "(function () {",
    "  if (globalThis.__SecPalNativeAuthBootstrapInstalled) {",
    "    return;",
    "  }",
    `  const apiOrigin = ${serializedApiBaseUrl};`,
    "  const authState = globalThis.__SecPalNativeAuthState ?? { active: false };",
    "  globalThis.__SecPalNativeAuthState = authState;",
    "  const getPlugin = () => {",
    "    const plugin = globalThis.Capacitor?.Plugins?.SecPalNativeAuth;",
    "    if (!plugin) {",
    '      throw new Error("SecPal native auth plugin is unavailable");',
    "    }",
    "    return plugin;",
    "  };",
    "  const encodeBase64 = (bytes) => {",
    "    let binary = '';",
    "    const chunkSize = 32768;",
    "    for (let index = 0; index < bytes.length; index += chunkSize) {",
    "      const chunk = bytes.subarray(index, index + chunkSize);",
    "      binary += String.fromCharCode(...chunk);",
    "    }",
    "    return btoa(binary);",
    "  };",
    "  const decodeBase64 = (value) => {",
    "    const binary = atob(value);",
    "    const bytes = new Uint8Array(binary.length);",
    "    for (let index = 0; index < binary.length; index += 1) {",
    "      bytes[index] = binary.charCodeAt(index);",
    "    }",
    "    return bytes;",
    "  };",
    "  const buildPath = (url) => `${url.pathname}${url.search}`;",
    "  const nativeApiHost = new URL(apiOrigin).hostname;",
    "  const isNativeApiRequest = (url) => {",
    "    const locationHost = globalThis.location?.hostname;",
    "    return url.pathname.startsWith('/v1/') && (",
    "      url.hostname === nativeApiHost ||",
    "      url.hostname === 'api.secpal.dev' ||",
    "      (locationHost !== undefined && url.hostname === locationHost)",
    "    );",
    "  };",
    "  const bridge = {",
    "    async login(credentials) {",
    "      const result = await getPlugin().login(credentials);",
    "      authState.active = true;",
    "      return result;",
    "    },",
    "    async logout() {",
    "      try {",
    "        return await getPlugin().logout();",
    "      } finally {",
    "        authState.active = false;",
    "      }",
    "    },",
    "    async getCurrentUser() {",
    "      try {",
    "        const result = await getPlugin().getCurrentUser();",
    "        authState.active = true;",
    "        return result;",
    "      } catch (error) {",
    "        const code = error && typeof error === 'object' ? error.code : undefined;",
    "        if (code === 'HTTP_401' || code === 'NO_STORED_TOKEN') {",
    "          authState.active = false;",
    "        }",
    "        throw error;",
    "      }",
    "    },",
    "    request(request) {",
    "      return getPlugin().request(request);",
    "    },",
    "  };",
    "  globalThis.SecPalNativeAuthBridge = bridge;",
    "  if (typeof globalThis.fetch === 'function') {",
    "    const originalFetch = globalThis.fetch.bind(globalThis);",
    "    globalThis.fetch = async (input, init) => {",
    "      const request = new Request(input, init);",
    "      let url;",
    "      try {",
    "        url = new URL(request.url, globalThis.location?.href ?? apiOrigin);",
    "      } catch {",
    "        return originalFetch(request);",
    "      }",
    "      if (!authState.active || !isNativeApiRequest(url)) {",
    "        return originalFetch(request);",
    "      }",
    "      const requestBody = request.method === 'GET' || request.method === 'HEAD'",
    "        ? undefined",
    "        : await request.arrayBuffer();",
    "      const nativeResponse = await bridge.request({",
    "        method: request.method,",
    "        path: buildPath(url),",
    "        bodyBase64: requestBody && requestBody.byteLength > 0",
    "          ? encodeBase64(new Uint8Array(requestBody))",
    "          : undefined,",
    "        contentType: request.headers.get('Content-Type') ?? undefined,",
    "        accept: request.headers.get('Accept') ?? undefined,",
    "      });",
    "      if (nativeResponse.status === 401) {",
    "        authState.active = false;",
    "      } else {",
    "        authState.active = true;",
    "      }",
    "      const headers = new Headers();",
    "      if (nativeResponse.contentType) {",
    "        headers.set('Content-Type', nativeResponse.contentType);",
    "      }",
    "      return new Response(",
    "        nativeResponse.bodyBase64 ? decodeBase64(nativeResponse.bodyBase64) : undefined,",
    "        { status: nativeResponse.status, headers }",
    "      );",
    "    };",
    "  }",
    "  globalThis.__SecPalNativeAuthBootstrapInstalled = true;",
    "})();",
  ].join("\n");
}

export function injectNativeAuthBridgeBootstrap(html, apiBaseUrl) {
  if (html.includes(`id="${BOOTSTRAP_SCRIPT_ID}"`)) {
    return html;
  }

  const scriptTag = `<script id="${BOOTSTRAP_SCRIPT_ID}">${buildNativeAuthBridgeBootstrapScript(apiBaseUrl)}</script>`;
  const moduleScriptIndex = html.indexOf('<script type="module"');

  if (moduleScriptIndex >= 0) {
    return `${html.slice(0, moduleScriptIndex)}${scriptTag}\n${html.slice(moduleScriptIndex)}`;
  }

  const headCloseIndex = html.indexOf("</head>");

  if (headCloseIndex >= 0) {
    return `${html.slice(0, headCloseIndex)}${scriptTag}\n${html.slice(headCloseIndex)}`;
  }

  return `${scriptTag}\n${html}`;
}

export function injectNativeAuthBridgeIntoFile(indexHtmlPath, stringsXmlPath) {
  const html = readFileSync(indexHtmlPath, "utf8");
  const stringsXml = readFileSync(stringsXmlPath, "utf8");
  const apiBaseUrl = readApiBaseUrlFromStringsXml(stringsXml);
  const injectedHtml = injectNativeAuthBridgeBootstrap(html, apiBaseUrl);
  writeFileSync(indexHtmlPath, injectedHtml, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const indexHtmlPath = process.argv[2];
  const stringsXmlPath = process.argv[3];

  if (!indexHtmlPath || !stringsXmlPath) {
    console.error(
      "Usage: node scripts/inject-native-auth-bridge.mjs <dist-index-html> <strings-xml>"
    );
    process.exit(1);
  }

  injectNativeAuthBridgeIntoFile(indexHtmlPath, stringsXmlPath);
}