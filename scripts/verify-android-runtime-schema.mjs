#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parse } from "parse5";
import {
  assertAndroidWebAssetArchive,
  assertAndroidWebAssetDirectory,
  androidWebAssetInventoryName,
} from "./android-web-asset-inventory.mjs";
import {
  assertCompleteAndroidWebApplicationShell,
  buildNativeAuthBridgeAssetName,
  buildNativeAuthBridgeBootstrapScript,
  isDirectNodeExecution,
  nativeAuthBridgeAssetPrefix,
  nativeAuthBridgeAssetPattern,
  readApiBaseUrlFromStringsXml,
} from "./inject-native-auth-bridge.mjs";
import {
  verifyAndroidFrontendBuildMetadata,
  verifyAndroidFrontendBuildMetadataSource,
} from "./verify-android-frontend-build.mjs";
import {
  openLiteralZipArchive,
  ZipArchiveReadError,
} from "./literal-zip-archive.mjs";

const runtimeScriptId = "secpal-native-auth-bridge-bootstrap";
const frontendBuildMetadataName = "build-metadata.json";
const runtimeIndexEntryByExtension = new Map([
  [".apk", "assets/public/index.html"],
  [".aab", "base/assets/public/index.html"],
]);
const runtimeIndexEntries = [...runtimeIndexEntryByExtension.values()];

function assertNoExecutableInlineScripts(indexHtml, sourceLabel) {
  const pending = [parse(indexHtml, { sourceCodeLocationInfo: true })];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.tagName === "script") {
      const attributes = new Map(
        (node.attrs ?? []).map(({ name, value }) => [name, value])
      );
      const location = node.sourceCodeLocation;
      if (
        !attributes.has("src") &&
        attributes.get("id") !== runtimeScriptId &&
        location?.startTag
      ) {
        const body = location.endTag
          ? indexHtml.slice(
              location.startTag.endOffset,
              location.endTag.startOffset
            )
          : (node.childNodes ?? [])
              .map((child) =>
                typeof child.value === "string" ? child.value : ""
              )
              .join("");
        if (body.trim().length > 0) {
          throw new Error(
            `${sourceLabel} must not contain executable inline scripts.`
          );
        }
      }
    }
    pending.push(...(node.childNodes ?? []));
  }
}

function extractAndroidRuntimeBridge(indexHtml, sourceLabel) {
  const runtimeScripts = [];
  const contentSecurityPolicies = [];
  let firstScriptOffset = null;
  let firstModuleScriptOffset = null;
  const pending = [parse(indexHtml, { sourceCodeLocationInfo: true })];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.tagName === "script") {
      const attributes = new Map(
        (node.attrs ?? []).map(({ name, value }) => [name, value])
      );
      if (attributes.get("id") === runtimeScriptId) {
        runtimeScripts.push(node);
      }
      const location = node.sourceCodeLocation;
      if (location?.startTag) {
        firstScriptOffset =
          firstScriptOffset === null
            ? location.startTag.startOffset
            : Math.min(firstScriptOffset, location.startTag.startOffset);
      }
      if (
        attributes.get("type")?.trim().toLowerCase() === "module" &&
        attributes.get("src")?.trim() &&
        location?.startTag
      ) {
        firstModuleScriptOffset =
          firstModuleScriptOffset === null
            ? location.startTag.startOffset
            : Math.min(firstModuleScriptOffset, location.startTag.startOffset);
      }
    }
    if (node.tagName === "meta") {
      const attributes = new Map(
        (node.attrs ?? []).map(({ name, value }) => [name, value])
      );
      if (
        attributes.get("http-equiv")?.trim().toLowerCase() ===
        "content-security-policy"
      ) {
        const precedingHeadElements =
          node.parentNode?.tagName === "head"
            ? node.parentNode.childNodes
                .slice(0, node.parentNode.childNodes.indexOf(node))
                .filter((candidate) => candidate.tagName)
            : [];
        contentSecurityPolicies.push({
          content: attributes.get("content") ?? "",
          hasDisallowedPredecessor:
            precedingHeadElements.length > 1 ||
            precedingHeadElements.some((candidate) => {
              const candidateAttributes = candidate.attrs ?? [];
              return (
                candidate.tagName !== "meta" ||
                candidateAttributes.length !== 1 ||
                candidateAttributes[0].name !== "charset" ||
                candidateAttributes[0].value.trim().toLowerCase() !== "utf-8"
              );
            }),
          isHeadChild: node.parentNode?.tagName === "head",
          startOffset: node.sourceCodeLocation?.startTag?.startOffset ?? null,
        });
      }
    }
    pending.push(...(node.childNodes ?? []));
  }

  if (runtimeScripts.length !== 1) {
    throw new Error(
      `${sourceLabel} must contain exactly one injected Android runtime bridge.`
    );
  }

  const [runtimeScript] = runtimeScripts;
  const location = runtimeScript.sourceCodeLocation;
  const startTag = location?.startTag;
  if (!startTag || !location.endTag) {
    throw new Error(
      `${sourceLabel} contains a non-canonical Android runtime bridge tag.`
    );
  }
  const attributes = new Map(
    (runtimeScript.attrs ?? []).map(({ name, value }) => [name, value])
  );
  const src = attributes.get("src") ?? "";
  const assetMatch = /^\/(secpal-native-auth-bridge\.[0-9a-f]{64}\.js)$/.exec(
    src
  );
  const canonicalTag = assetMatch
    ? `<script id="${runtimeScriptId}" src="/${assetMatch[1]}"></script>`
    : null;
  if (
    runtimeScript.attrs?.length !== 2 ||
    !canonicalTag ||
    indexHtml.slice(startTag.startOffset, location.endTag.endOffset) !==
      canonicalTag
  ) {
    throw new Error(
      `${sourceLabel} must load the Android runtime bridge through one canonical same-origin content-hashed script tag.`
    );
  }
  if (
    firstModuleScriptOffset === null ||
    startTag.startOffset >= firstModuleScriptOffset
  ) {
    throw new Error(
      `${sourceLabel} must load the Android runtime bridge before the application module.`
    );
  }
  if (contentSecurityPolicies.length !== 1) {
    throw new Error(
      `${sourceLabel} must contain exactly one strict Content-Security-Policy.`
    );
  }
  const [csp] = contentSecurityPolicies;
  if (!csp.isHeadChild) {
    throw new Error(
      `${sourceLabel} Content-Security-Policy meta must be a direct child of head.`
    );
  }
  if (
    csp.startOffset === null ||
    firstScriptOffset === null ||
    csp.startOffset >= firstScriptOffset
  ) {
    throw new Error(
      `${sourceLabel} Content-Security-Policy meta must appear before every script element.`
    );
  }
  if (csp.hasDisallowedPredecessor) {
    throw new Error(
      `${sourceLabel} Content-Security-Policy meta must be the first head element after optional charset metadata.`
    );
  }
  const directives = csp.content
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);
  const directivesByName = new Map();
  for (const directive of directives) {
    const [name] = directive.split(/\s+/);
    const normalizedName = name.toLowerCase();
    const existing = directivesByName.get(normalizedName) ?? [];
    existing.push(directive);
    directivesByName.set(normalizedName, existing);
  }
  const scriptDirectives = directivesByName.get("script-src") ?? [];
  const scriptElementDirectives = directivesByName.get("script-src-elem") ?? [];
  const scriptAttributeDirectives =
    directivesByName.get("script-src-attr") ?? [];
  if (scriptDirectives.length !== 1) {
    throw new Error(
      `${sourceLabel} must contain exactly one script-src directive.`
    );
  }
  if (scriptAttributeDirectives.length !== 1) {
    throw new Error(
      `${sourceLabel} must contain exactly one script-src-attr 'none' directive.`
    );
  }
  if (scriptElementDirectives.length > 1) {
    throw new Error(
      `${sourceLabel} must contain at most one script-src-elem directive.`
    );
  }
  const [scriptDirective] = scriptDirectives;
  const [scriptAttributeDirective] = scriptAttributeDirectives;
  const [scriptElementDirective] = scriptElementDirectives;
  if (
    scriptDirective !== "script-src 'self'" ||
    scriptAttributeDirective !== "script-src-attr 'none'" ||
    (scriptElementDirective !== undefined &&
      scriptElementDirective !== "script-src-elem 'self'") ||
    /sha256-|sha384-|sha512-|'unsafe-inline'|'unsafe-eval'|https?:/i.test(
      [
        scriptDirective,
        scriptElementDirective ?? "",
        scriptAttributeDirective,
      ].join(" ")
    )
  ) {
    throw new Error(
      `${sourceLabel} must preserve script-src 'self', script-src-attr 'none', and an optional script-src-elem 'self' without hashes, remote sources, unsafe-inline, or unsafe-eval.`
    );
  }

  return assetMatch[1];
}

function selectRuntimeIndexEntry(artifactPath, archiveEntries) {
  const expectedEntry = runtimeIndexEntryByExtension.get(
    extname(artifactPath).toLowerCase()
  );
  if (!expectedEntry) {
    throw new Error(`${artifactPath} must be an APK or AAB artifact.`);
  }

  const presentRuntimeEntries = archiveEntries.filter((entry) =>
    runtimeIndexEntries.includes(entry)
  );
  if (
    presentRuntimeEntries.length !== 1 ||
    presentRuntimeEntries[0] !== expectedEntry
  ) {
    throw new Error(
      `${artifactPath} must contain exactly one Android runtime index at ${expectedEntry}.`
    );
  }

  return expectedEntry;
}

function assertCanonicalAndroidRuntimeIndex(indexHtml, sourceLabel) {
  assertNoExecutableInlineScripts(indexHtml, sourceLabel);
  assertCompleteAndroidWebApplicationShell(indexHtml, sourceLabel);
  return extractAndroidRuntimeBridge(indexHtml, sourceLabel);
}

function assertCanonicalAndroidRuntimeBridgeAsset(
  bridgeAsset,
  bridgeAssetPath,
  sourceLabel,
  expectedBridge
) {
  const filenameMatch = nativeAuthBridgeAssetPattern.exec(
    basename(bridgeAssetPath)
  );
  const actualSha256 = createHash("sha256").update(bridgeAsset).digest("hex");
  if (
    !filenameMatch ||
    filenameMatch[1] !== actualSha256 ||
    bridgeAssetPath !==
      buildNativeAuthBridgeAssetName(bridgeAsset.toString("utf8"))
  ) {
    throw new Error(
      `${sourceLabel} native-auth bridge filename does not match its exact SHA-256 bytes.`
    );
  }
  const actualBridge = bridgeAsset.toString("utf8");

  if (actualBridge !== expectedBridge) {
    throw new Error(
      `${sourceLabel} does not contain the canonical Android runtime bridge.`
    );
  }
}

function assertCanonicalBridgeInventory(
  actualPaths,
  bridgeAssetPath,
  sourceLabel
) {
  const bridgePaths = actualPaths.filter((path) =>
    basename(path).startsWith(nativeAuthBridgeAssetPrefix)
  );
  if (
    bridgePaths.length !== 1 ||
    bridgePaths[0] !== bridgeAssetPath ||
    bridgeAssetPath.includes("/")
  ) {
    throw new Error(
      `${sourceLabel} must contain exactly one inventoried canonical native-auth bridge asset.`
    );
  }
}

function buildExpectedBridge(stringsXmlPath) {
  return buildNativeAuthBridgeBootstrapScript(
    readApiBaseUrlFromStringsXml(readFileSync(stringsXmlPath, "utf8"))
  );
}

export function verifyAndroidRuntimeSchemaIndex(
  indexHtmlPath,
  stringsXmlPath,
  fallbackInventoryPath
) {
  const assetRoot = dirname(indexHtmlPath);
  if (basename(indexHtmlPath) !== "index.html") {
    throw new Error(`${indexHtmlPath} must be the canonical index.html input.`);
  }
  const generatedInventoryPath = join(assetRoot, androidWebAssetInventoryName);
  const inventoryPath = existsSync(generatedInventoryPath)
    ? generatedInventoryPath
    : fallbackInventoryPath;
  if (!inventoryPath) {
    throw new Error(
      `${indexHtmlPath} must be verified with its Android web asset inventory.`
    );
  }
  const { actualPaths } = assertAndroidWebAssetDirectory(
    assetRoot,
    inventoryPath
  );
  verifyAndroidFrontendBuildMetadata(assetRoot);
  const bridgeAssetPath = assertCanonicalAndroidRuntimeIndex(
    readFileSync(indexHtmlPath, "utf8"),
    indexHtmlPath
  );
  assertCanonicalBridgeInventory(actualPaths, bridgeAssetPath, assetRoot);
  assertCanonicalAndroidRuntimeBridgeAsset(
    readFileSync(join(assetRoot, bridgeAssetPath)),
    bridgeAssetPath,
    `${indexHtmlPath}:${bridgeAssetPath}`,
    buildExpectedBridge(stringsXmlPath)
  );
}

export function verifyAndroidRuntimeSchemaDirectory(
  assetRoot,
  stringsXmlPath,
  fallbackInventoryPath
) {
  const generatedInventoryPath = join(assetRoot, androidWebAssetInventoryName);
  const inventoryPath = existsSync(generatedInventoryPath)
    ? generatedInventoryPath
    : fallbackInventoryPath;
  if (!inventoryPath) {
    throw new Error(
      `${assetRoot} must contain ${androidWebAssetInventoryName} or provide a fallback inventory.`
    );
  }
  verifyAndroidRuntimeSchemaIndex(
    join(assetRoot, "index.html"),
    stringsXmlPath,
    inventoryPath
  );
}

export async function verifyAndroidRuntimeSchemaArtifact(
  artifactPath,
  stringsXmlPath
) {
  const expectedBridge = buildExpectedBridge(stringsXmlPath);
  let archive;
  try {
    archive = await openLiteralZipArchive(artifactPath);
    const runtimeIndexEntry = selectRuntimeIndexEntry(
      artifactPath,
      archive.entries
    );
    const runtimeAssetRoot = runtimeIndexEntry.slice(0, -"index.html".length);
    const { actualPaths } = await assertAndroidWebAssetArchive({
      archiveEntries: archive.entries,
      hashEntry: archive.hashEntry,
      readEntry: archive.readEntry,
      runtimeAssetRoot,
      sourceLabel: artifactPath,
    });

    const sourceLabel = `${artifactPath}:${runtimeIndexEntry}`;
    const indexHtml = (await archive.readEntry(runtimeIndexEntry)).toString(
      "utf8"
    );
    const bridgeAssetPath = assertCanonicalAndroidRuntimeIndex(
      indexHtml,
      sourceLabel
    );
    assertCanonicalBridgeInventory(actualPaths, bridgeAssetPath, artifactPath);
    const bridgeEntry = `${runtimeAssetRoot}${bridgeAssetPath}`;
    assertCanonicalAndroidRuntimeBridgeAsset(
      await archive.readEntry(bridgeEntry),
      bridgeAssetPath,
      `${artifactPath}:${bridgeEntry}`,
      expectedBridge
    );
    const metadataEntry = `${runtimeAssetRoot}${frontendBuildMetadataName}`;
    verifyAndroidFrontendBuildMetadataSource(
      (await archive.readEntry(metadataEntry)).toString("utf8"),
      `${artifactPath}:${metadataEntry}`
    );
  } catch (error) {
    if (error instanceof ZipArchiveReadError) {
      throw new Error(`Unable to inspect ${artifactPath}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    archive?.close();
  }
}

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const [, , inputPath, stringsXmlPath, fallbackInventoryPath] = process.argv;
    if (!inputPath || !stringsXmlPath) {
      throw new Error(
        "Usage: node scripts/verify-android-runtime-schema.mjs <apk-aab-index-or-web-assets> <strings-xml> [fallback-inventory]"
      );
    }
    const resolvedInputPath = resolve(inputPath);
    const resolvedStringsXmlPath = resolve(stringsXmlPath);
    if (statSync(resolvedInputPath).isDirectory()) {
      verifyAndroidRuntimeSchemaDirectory(
        resolvedInputPath,
        resolvedStringsXmlPath,
        fallbackInventoryPath ? resolve(fallbackInventoryPath) : undefined
      );
      console.log("ANDROID_RUNTIME_SCHEMA_DIRECTORY_OK");
    } else if (extname(resolvedInputPath).toLowerCase() === ".html") {
      verifyAndroidRuntimeSchemaIndex(
        resolvedInputPath,
        resolvedStringsXmlPath,
        fallbackInventoryPath ? resolve(fallbackInventoryPath) : undefined
      );
      console.log("ANDROID_RUNTIME_SCHEMA_INDEX_OK");
    } else {
      await verifyAndroidRuntimeSchemaArtifact(
        resolvedInputPath,
        resolvedStringsXmlPath
      );
      console.log("ANDROID_RUNTIME_SCHEMA_ARTIFACT_OK");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
