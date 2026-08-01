/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Node-executable project helper.
import { writeAndroidWebAssetInventory } from "../scripts/android-web-asset-inventory.mjs";
// @ts-expect-error Node-executable project helper.
import { buildNativeAuthBridgeAsset } from "../scripts/inject-native-auth-bridge.mjs";
// @ts-expect-error Node-executable project helper.
import * as runtimeSchemaVerifier from "../scripts/verify-android-runtime-schema.mjs";

const {
  verifyAndroidRuntimeSchemaArtifact,
  verifyAndroidRuntimeSchemaDirectory,
  verifyAndroidRuntimeSchemaIndex,
} = runtimeSchemaVerifier;

const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";
const temporaryRoots: string[] = [];

type BridgeFixture = {
  assetRoot: string;
  bridgeContent: string;
  bridgeFileName: string;
  indexHtmlPath: string;
  stringsXmlPath: string;
};

function writeFile(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function bridgeTag(sourcePath: string, content = ""): string {
  return `<script id="secpal-native-auth-bridge-bootstrap" src="${sourcePath}">${content}</script>`;
}

function applicationHtml(tag: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><script src="/runtime-config.js"></script>${tag}<script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`;
}

function createBridgeFixture({
  bridgeContent,
  bridgeFileName,
  tag,
  writeInventory = true,
}: {
  bridgeContent?: string;
  bridgeFileName?: string;
  tag?: string;
  writeInventory?: boolean;
} = {}): BridgeFixture {
  const root = createRoot("android-external-bridge-");
  const assetRoot = join(root, "public");
  const canonicalAsset = buildNativeAuthBridgeAsset(apiBaseUrl);
  const effectiveContent = bridgeContent ?? canonicalAsset.content;
  const effectiveFileName = bridgeFileName ?? canonicalAsset.fileName;
  const effectiveTag = tag ?? bridgeTag(`/${effectiveFileName}`);
  const indexHtmlPath = join(assetRoot, "index.html");
  const stringsXmlPath = join(root, "strings.xml");

  writeFile(indexHtmlPath, applicationHtml(effectiveTag));
  writeFile(join(assetRoot, "assets/index.js"), "export {};\n");
  writeFile(join(assetRoot, "runtime-config.js"), "// runtime config\n");
  writeFile(join(assetRoot, effectiveFileName), effectiveContent);
  writeFile(
    stringsXmlPath,
    `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
  );
  if (writeInventory) {
    writeAndroidWebAssetInventory(assetRoot);
  }

  return {
    assetRoot,
    bridgeContent: effectiveContent,
    bridgeFileName: effectiveFileName,
    indexHtmlPath,
    stringsXmlPath,
  };
}

function packageFixture(
  fixture: BridgeFixture,
  extension: "apk" | "aab",
  internalRoot?: string
): string {
  const archiveRoot = createRoot(`android-${extension}-bridge-`);
  const expectedRoot =
    extension === "apk" ? "assets/public" : "base/assets/public";
  const targetRoot = join(
    archiveRoot,
    ...(internalRoot ?? expectedRoot).split("/")
  );
  mkdirSync(targetRoot, { recursive: true });
  const copyResult = spawnSync(
    "cp",
    ["-R", `${fixture.assetRoot}/.`, targetRoot],
    {
      encoding: "utf8",
    }
  );
  expect(copyResult.status, copyResult.stderr).toBe(0);
  const archivePath = join(archiveRoot, `fixture.${extension}`);
  const zipTopLevel = (internalRoot ?? expectedRoot).split("/")[0];
  const zipResult = spawnSync("zip", ["-q", "-r", archivePath, zipTopLevel], {
    cwd: archiveRoot,
    encoding: "utf8",
  });
  expect(zipResult.status, zipResult.stderr).toBe(0);
  return archivePath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("external native auth runtime verification", () => {
  it("accepts a valid WebView directory and an individual index with its sibling asset", () => {
    const fixture = createBridgeFixture();

    expect(() =>
      verifyAndroidRuntimeSchemaDirectory(
        fixture.assetRoot,
        fixture.stringsXmlPath
      )
    ).not.toThrow();
    expect(() =>
      verifyAndroidRuntimeSchemaIndex(
        fixture.indexHtmlPath,
        fixture.stringsXmlPath
      )
    ).not.toThrow();
  });

  it.each(["apk", "aab"] as const)(
    "accepts a valid %s with the platform-specific internal asset root",
    async (extension) => {
      const fixture = createBridgeFixture();
      const artifactPath = packageFixture(fixture, extension);

      await expect(
        verifyAndroidRuntimeSchemaArtifact(artifactPath, fixture.stringsXmlPath)
      ).resolves.toBeUndefined();
    }
  );

  it.each([
    ["missing tag", "", /exactly one native auth bridge script/iu],
    [
      "duplicate tag",
      `${bridgeTag(`/${buildNativeAuthBridgeAsset(apiBaseUrl).fileName}`)}${bridgeTag(`/${buildNativeAuthBridgeAsset(apiBaseUrl).fileName}`)}`,
      /exactly one native auth bridge script/iu,
    ],
    [
      "inline content",
      bridgeTag(
        `/${buildNativeAuthBridgeAsset(apiBaseUrl).fileName}`,
        "alert(1)"
      ),
      /must not contain inline content/iu,
    ],
    [
      "missing src",
      '<script id="secpal-native-auth-bridge-bootstrap"></script>',
      /must define src/iu,
    ],
    [
      "external URL",
      bridgeTag("https://attacker.invalid/bridge.js"),
      /controlled root-relative/iu,
    ],
    [
      "protocol-relative URL",
      bridgeTag("//attacker.invalid/bridge.js"),
      /controlled root-relative/iu,
    ],
    [
      "path traversal",
      bridgeTag("/../bridge.js"),
      /controlled root-relative/iu,
    ],
    [
      "data URL",
      bridgeTag("data:text/javascript,alert(1)"),
      /controlled root-relative/iu,
    ],
    [
      "blob URL",
      bridgeTag("blob:https://app.secpal.dev/id"),
      /controlled root-relative/iu,
    ],
    [
      "javascript URL",
      bridgeTag("javascript:alert(1)"),
      /controlled root-relative/iu,
    ],
    [
      "query string",
      bridgeTag(`/${buildNativeAuthBridgeAsset(apiBaseUrl).fileName}?v=1`),
      /controlled root-relative/iu,
    ],
    [
      "fragment",
      bridgeTag(`/${buildNativeAuthBridgeAsset(apiBaseUrl).fileName}#x`),
      /controlled root-relative/iu,
    ],
    [
      "short hash",
      bridgeTag("/secpal-native-auth-bridge.abc.js"),
      /controlled root-relative/iu,
    ],
    [
      "uppercase hash",
      bridgeTag(`/secpal-native-auth-bridge.${"A".repeat(64)}.js`),
      /controlled root-relative/iu,
    ],
  ])("rejects %s", (_name, tag, expectedError) => {
    const fixture = createBridgeFixture({ tag });

    expect(() =>
      verifyAndroidRuntimeSchemaIndex(
        fixture.indexHtmlPath,
        fixture.stringsXmlPath
      )
    ).toThrow(expectedError);
  });

  it("rejects a missing referenced bridge file", () => {
    const fixture = createBridgeFixture();
    rmSync(join(fixture.assetRoot, fixture.bridgeFileName));

    expect(() =>
      verifyAndroidRuntimeSchemaIndex(
        fixture.indexHtmlPath,
        fixture.stringsXmlPath
      )
    ).toThrow(/referenced native auth bridge asset is missing/iu);
  });

  it("rejects content whose SHA-256 does not match its file name", () => {
    const fixture = createBridgeFixture();
    writeFile(join(fixture.assetRoot, fixture.bridgeFileName), "tampered");

    expect(() =>
      verifyAndroidRuntimeSchemaIndex(
        fixture.indexHtmlPath,
        fixture.stringsXmlPath
      )
    ).toThrow(/SHA-256 does not match its file name/iu);
  });

  it("rejects hash-valid content that is not the canonical bootstrap", () => {
    const alternateContent = buildNativeAuthBridgeAsset(
      apiBaseUrl
    ).content.replace(apiBaseUrl, "https://unexpected-runtime.secpal.dev");
    const alternateHash = createHash("sha256")
      .update(alternateContent)
      .digest("hex");
    const fixture = createBridgeFixture({
      bridgeContent: alternateContent,
      bridgeFileName: `secpal-native-auth-bridge.${alternateHash}.js`,
    });

    expect(() =>
      verifyAndroidRuntimeSchemaIndex(
        fixture.indexHtmlPath,
        fixture.stringsXmlPath
      )
    ).toThrow(/canonical schema 4 runtime bridge/iu);
  });

  it("retains the independent schema-4 AST invariant", () => {
    const canonical = buildNativeAuthBridgeAsset(apiBaseUrl).content;
    const schema3 = canonical.replace(
      "currentBootstrapSchemaVersion = 4",
      "currentBootstrapSchemaVersion = 3"
    );
    const digest = createHash("sha256").update(schema3).digest("hex");
    const fixture = createBridgeFixture({
      bridgeContent: schema3,
      bridgeFileName: `secpal-native-auth-bridge.${digest}.js`,
    });

    expect(() =>
      verifyAndroidRuntimeSchemaIndex(
        fixture.indexHtmlPath,
        fixture.stringsXmlPath
      )
    ).toThrow(/must declare schema 4 independently/iu);
  });

  it("rejects an inventory that omits the bridge asset", () => {
    const fixture = createBridgeFixture({ writeInventory: false });
    rmSync(join(fixture.assetRoot, fixture.bridgeFileName));
    writeAndroidWebAssetInventory(fixture.assetRoot);
    writeFile(
      join(fixture.assetRoot, fixture.bridgeFileName),
      fixture.bridgeContent
    );

    expect(() =>
      verifyAndroidRuntimeSchemaDirectory(
        fixture.assetRoot,
        fixture.stringsXmlPath
      )
    ).toThrow(/not declared by its Android web asset inventory/iu);
  });

  it("rejects additional obsolete bridge files even when inventoried", () => {
    const fixture = createBridgeFixture({ writeInventory: false });
    writeFile(
      join(fixture.assetRoot, `secpal-native-auth-bridge.${"a".repeat(64)}.js`),
      "obsolete"
    );
    writeAndroidWebAssetInventory(fixture.assetRoot);

    expect(() =>
      verifyAndroidRuntimeSchemaDirectory(
        fixture.assetRoot,
        fixture.stringsXmlPath
      )
    ).toThrow(/exactly one packaged native auth bridge asset/iu);
  });

  it.each([
    ["apk", "base/assets/public", /assets\/public\/index\.html/iu],
    ["aab", "assets/public", /base\/assets\/public\/index\.html/iu],
  ] as const)(
    "rejects a %s using the other artifact type's internal index path",
    async (extension, internalRoot, expectedError) => {
      const fixture = createBridgeFixture();
      const artifactPath = packageFixture(fixture, extension, internalRoot);

      await expect(
        verifyAndroidRuntimeSchemaArtifact(artifactPath, fixture.stringsXmlPath)
      ).rejects.toThrow(expectedError);
    }
  );

  it("keeps the generated Android HTML compatible with the strict CSP contract", () => {
    const fixture = createBridgeFixture();
    const html = readFileSync(fixture.indexHtmlPath, "utf8");
    const scriptTags = [
      ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu),
    ];

    expect(html).toContain("script-src 'self'");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/iu);
    expect(scriptTags).toHaveLength(3);
    for (const scriptTag of scriptTags) {
      expect(scriptTag[1]).toMatch(/\bsrc=/iu);
      expect(scriptTag[2]).toBe("");
    }
    expect(html.indexOf(fixture.bridgeFileName)).toBeLessThan(
      html.indexOf('type="module"')
    );
  });
});
