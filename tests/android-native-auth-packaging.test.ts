/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The inventory verifier intentionally remains Node-executable JavaScript.
import { assertAndroidWebAssetDirectory } from "../scripts/android-web-asset-inventory.mjs";
// @ts-expect-error The packaging helper intentionally remains Node-executable JavaScript.
import * as nativeAuthBridgePackaging from "../scripts/inject-native-auth-bridge.mjs";
// @ts-expect-error The verifier intentionally remains Node-executable JavaScript.
import { verifyAndroidFrontendBuildMetadata } from "../scripts/verify-android-frontend-build.mjs";
// @ts-expect-error The verifier intentionally remains Node-executable JavaScript.
import { verifyAndroidWebAssetOverlays } from "../scripts/verify-android-web-asset-overlays.mjs";

const { buildNativeAuthBridgeBootstrapScript, injectNativeAuthBridgeIntoFile } =
  nativeAuthBridgePackaging;

const repoRoot = resolve(import.meta.dirname, "..");
const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";

function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function createFrontendBuildMetadata(
  applicationSurface: string = "android-native"
) {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      applicationSurface,
      buildMode: "android",
      production: true,
    },
    null,
    2
  )}\n`;
}

describe("Android native-auth packaging", () => {
  it("keeps the standalone fallback inventory aligned with every committed web asset", () => {
    const publicRoot = resolve(repoRoot, "android/app/src/main/assets/public");
    const fallbackPath = resolve(
      repoRoot,
      "android/app/src/main/web-assets-fallback.json"
    );

    expect(() =>
      assertAndroidWebAssetDirectory(publicRoot, fallbackPath)
    ).not.toThrow();
  });

  it("accepts only deterministic Android-native frontend build metadata", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "android-frontend-metadata-"));
    const metadataPath = join(tempRoot, "build-metadata.json");

    try {
      write(metadataPath, createFrontendBuildMetadata());
      expect(() => verifyAndroidFrontendBuildMetadata(tempRoot)).not.toThrow();

      write(metadataPath, createFrontendBuildMetadata("web"));
      expect(() => verifyAndroidFrontendBuildMetadata(tempRoot)).toThrow(
        /applicationSurface.*android-native/i
      );

      write(
        metadataPath,
        '{"schemaVersion":1,"applicationSurface":"android-native","buildMode":"web","production":true}\n'
      );
      expect(() => verifyAndroidFrontendBuildMetadata(tempRoot)).toThrow(
        /build metadata/i
      );

      for (const ambiguousMetadata of [
        '{"schemaVersion":1,"applicationSurface":"web","applicationSurface":"android-native","buildMode":"android","production":true}\n',
        '{"schemaVersion":1,"applicationSurface":"android-native","buildMode":"android","production":false,"production":true}\n',
      ]) {
        write(metadataPath, ambiguousMetadata);
        expect(() => verifyAndroidFrontendBuildMetadata(tempRoot)).toThrow(
          /deterministic build metadata/i
        );
      }

      write(
        metadataPath,
        '{"schemaVersion":1,"applicationSurface":"android-native","buildMode":"android","production":true,"decoy":"android-native"}\n'
      );
      expect(() => verifyAndroidFrontendBuildMetadata(tempRoot)).toThrow(
        /build metadata/i
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("packages the canonical bridge as one content-hashed same-origin asset without changing strict CSP", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "android-bridge-package-"));
    const indexPath = join(tempRoot, "index.html");
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const csp =
      "default-src 'self'; script-src 'self'; script-src-attr 'none'; object-src 'none'";

    try {
      write(
        indexPath,
        `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><script type="module" src="/assets/index.js"></script></head><body></body></html>`
      );
      write(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );

      injectNativeAuthBridgeIntoFile(indexPath, stringsXmlPath);

      const canonicalBridge = buildNativeAuthBridgeBootstrapScript(apiBaseUrl);
      expect(canonicalBridge.endsWith("\n")).toBe(true);
      const sha256 = createHash("sha256")
        .update(canonicalBridge, "utf8")
        .digest("hex");
      const bridgeName = `secpal-native-auth-bridge.${sha256}.js`;
      const html = readFileSync(indexPath, "utf8");

      expect(html).toContain(`content="${csp}"`);
      expect(html).toContain(
        `<script id="secpal-native-auth-bridge-bootstrap" src="/${bridgeName}"></script>`
      );
      expect(html.indexOf(bridgeName)).toBeLessThan(
        html.indexOf('type="module"')
      );
      expect(html).not.toContain(canonicalBridge);
      expect(html).not.toContain("sha256-");
      expect(readFileSync(join(tempRoot, bridgeName), "utf8")).toBe(
        canonicalBridge
      );
      expect(
        readdirSync(tempRoot).filter((name) =>
          name.startsWith("secpal-native-auth-bridge.")
        )
      ).toEqual([bridgeName]);

      injectNativeAuthBridgeIntoFile(indexPath, stringsXmlPath);
      expect(readFileSync(indexPath, "utf8")).toBe(html);
      expect(existsSync(join(tempRoot, bridgeName))).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("removes stale generated bridge assets while preserving unrelated frontend files", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "android-bridge-stale-"));
    const indexPath = join(tempRoot, "index.html");
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const staleName = `secpal-native-auth-bridge.${"a".repeat(64)}.js`;

    try {
      write(
        indexPath,
        `<!doctype html><html><head><script id="secpal-native-auth-bridge-bootstrap" src="/${staleName}"></script><script type="module" src="/assets/index.js"></script></head><body></body></html>`
      );
      write(join(tempRoot, staleName), "stale");
      write(join(tempRoot, "unrelated.js"), "preserved");
      write(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );

      injectNativeAuthBridgeIntoFile(indexPath, stringsXmlPath);

      expect(existsSync(join(tempRoot, staleName))).toBe(false);
      expect(readFileSync(join(tempRoot, "unrelated.js"), "utf8")).toBe(
        "preserved"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects protected runtime files and bridge-shaped assets from debug overlays", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "android-overlay-assets-"));
    const debugAssets = join(tempRoot, "debug", "assets");
    const ctAssets = join(tempRoot, "ctRegression", "assets");

    try {
      write(join(debugAssets, "diagnostics", "native-only.txt"), "test-only");
      expect(() =>
        verifyAndroidWebAssetOverlays([debugAssets, ctAssets])
      ).not.toThrow();

      for (const protectedPath of [
        "public/index.html",
        "public/build-metadata.json",
        "public/secpal-web-assets.json",
        `public/secpal-native-auth-bridge.${"a".repeat(64)}.js`,
        "public/secpal-native-auth-bridge.decoy.js",
      ]) {
        write(join(ctAssets, ...protectedPath.split("/")), "replacement");
        expect(() =>
          verifyAndroidWebAssetOverlays([debugAssets, ctAssets])
        ).toThrow(/protected Android web asset overlay/i);
        rmSync(join(ctAssets, ...protectedPath.split("/")), { force: true });
      }

      write(join(ctAssets, "public", "unrelated-debug.js"), "unexpected");
      expect(() =>
        verifyAndroidWebAssetOverlays([debugAssets, ctAssets])
      ).toThrow(/non-inventoried Android web asset overlay/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects symbolic links before they can bypass overlay inventory controls", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "android-overlay-symlink-"));
    const debugAssets = join(tempRoot, "debug", "assets");
    const externalPublic = join(tempRoot, "external-public");

    try {
      write(join(externalPublic, "index.html"), "replacement");
      mkdirSync(debugAssets, { recursive: true });
      symlinkSync(externalPublic, join(debugAssets, "public"), "dir");

      expect(() => verifyAndroidWebAssetOverlays([debugAssets])).toThrow(
        /unsupported symbolic link.*public/i
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
