#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parse } from "parse5";
import ts from "typescript";
import {
  assertCompleteAndroidWebApplicationShell,
  buildNativeAuthBridgeBootstrapScript,
  isDirectNodeExecution,
  readApiBaseUrlFromStringsXml,
} from "./inject-native-auth-bridge.mjs";

const runtimeScriptId = "secpal-native-auth-bridge-bootstrap";
const runtimeScriptStart = '<script id="secpal-native-auth-bridge-bootstrap">';
const runtimeIndexEntryByExtension = new Map([
  [".apk", "assets/public/index.html"],
  [".aab", "base/assets/public/index.html"],
]);
const runtimeIndexEntries = [...runtimeIndexEntryByExtension.values()];
const localAssetAttributesByTag = new Map([
  ["audio", ["src"]],
  ["embed", ["src"]],
  ["iframe", ["src"]],
  ["img", ["src"]],
  ["image", ["href", "xlink:href"]],
  ["input", ["src"]],
  ["object", ["data"]],
  ["script", ["src"]],
  ["source", ["src"]],
  ["track", ["src"]],
  ["use", ["href", "xlink:href"]],
  ["video", ["poster", "src"]],
]);
const localSrcsetAttributesByTag = new Map([
  ["img", ["srcset"]],
  ["link", ["imagesrcset"]],
  ["source", ["srcset"]],
]);
const fetchedLinkRelationPattern =
  /^(?:apple-touch-icon|apple-touch-startup-image|icon|manifest|mask-icon|modulepreload|prefetch|preload|stylesheet)$/;
const newUrlDependencyPattern =
  /\bnew\s+URL\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/g;
const cssDependencyPattern =
  /(?:url\(\s*|@import\s+(?:url\(\s*)?)["']?([^"')\s;]+)/g;
const manifestDependencyPattern = /"src"\s*:\s*"([^"]+)"/g;
const androidWebApplicationOrigin = "https://app.secpal.dev";
const asciiWhitespacePattern = /[\t\n\f\r ]/;

function readUnzipOutput(artifactPath, argumentsList) {
  const result = spawnSync("unzip", argumentsList, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const details = result.error?.message || result.stderr.trim();
    throw new Error(
      `Unable to inspect ${artifactPath}: ${
        details || `unzip exited with status ${result.status ?? "unknown"}`
      }`
    );
  }

  return result.stdout;
}

function extractAndroidRuntimeBridge(indexHtml, sourceLabel) {
  const runtimeScripts = [];
  const pending = [parse(indexHtml, { sourceCodeLocationInfo: true })];
  while (pending.length > 0) {
    const node = pending.pop();
    if (
      node.tagName === "script" &&
      node.attrs?.some(
        ({ name, value }) => name === "id" && value === runtimeScriptId
      )
    ) {
      runtimeScripts.push(node);
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
  if (
    !startTag ||
    indexHtml.slice(startTag.startOffset, startTag.endOffset) !==
      runtimeScriptStart
  ) {
    throw new Error(
      `${sourceLabel} contains a non-canonical Android runtime bridge tag.`
    );
  }

  if (!location.endTag) {
    throw new Error(`${sourceLabel} contains an unterminated runtime bridge.`);
  }

  return indexHtml.slice(startTag.endOffset, location.endTag.startOffset);
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

function parseSrcsetCandidateUrls(srcset) {
  const candidateUrls = [];
  let position = 0;

  while (position < srcset.length) {
    while (
      position < srcset.length &&
      (asciiWhitespacePattern.test(srcset[position]) ||
        srcset[position] === ",")
    ) {
      position += 1;
    }
    if (position >= srcset.length) {
      break;
    }

    const urlStart = position;
    while (
      position < srcset.length &&
      !asciiWhitespacePattern.test(srcset[position])
    ) {
      position += 1;
    }

    let candidateUrl = srcset.slice(urlStart, position);
    let separatedByTrailingComma = false;
    while (candidateUrl.endsWith(",")) {
      candidateUrl = candidateUrl.slice(0, -1);
      separatedByTrailingComma = true;
    }
    if (candidateUrl.length > 0) {
      candidateUrls.push(candidateUrl);
    }
    if (separatedByTrailingComma) {
      continue;
    }

    let parenthesesDepth = 0;
    while (position < srcset.length) {
      const character = srcset[position];
      position += 1;
      if (character === "(") {
        parenthesesDepth += 1;
      } else if (character === ")" && parenthesesDepth > 0) {
        parenthesesDepth -= 1;
      } else if (character === "," && parenthesesDepth === 0) {
        break;
      }
    }
  }

  return candidateUrls;
}

function addLocalAssetPath(value, paths, baseUrl) {
  if (value.length === 0) {
    return;
  }

  try {
    const assetUrl = new URL(value, baseUrl);
    if (assetUrl.origin !== androidWebApplicationOrigin) {
      return;
    }

    const assetPath = decodeURIComponent(assetUrl.pathname).replace(/^\/+/, "");
    if (assetPath.length > 0 && assetPath !== "index.html") {
      paths.add(assetPath);
    }
  } catch {
    // Invalid local references are rejected as missing packaged assets.
    paths.add(value);
  }
}

function collectJavaScriptAssetPaths(source, localAssetPaths, baseUrl) {
  for (const { fileName } of ts.preProcessFile(source, true, true)
    .importedFiles) {
    addLocalAssetPath(fileName, localAssetPaths, baseUrl);
  }
  for (const match of source.matchAll(newUrlDependencyPattern)) {
    addLocalAssetPath(match[1], localAssetPaths, baseUrl);
  }
}

function collectLocalAndroidWebAssetPaths(indexHtml, documentUrl) {
  const localAssetPaths = new Set();
  const pending = [parse(indexHtml)];
  const nodes = [];

  while (pending.length > 0) {
    const node = pending.pop();
    nodes.push(node);
    pending.push(...(node.childNodes ?? []).toReversed());
  }
  let baseUrl = documentUrl;
  for (const node of nodes.filter(
    (candidate) => candidate.tagName === "base"
  )) {
    const href = node.attrs?.find(({ name }) => name === "href")?.value;
    if (href === undefined) {
      continue;
    }
    try {
      baseUrl = new URL(href, documentUrl);
      break;
    } catch {
      // The first valid base URL controls document-relative references.
    }
  }

  for (const node of nodes) {
    if (node.tagName === "link") {
      const relations = (
        node.attrs?.find(({ name }) => name === "rel")?.value ?? ""
      )
        .split(asciiWhitespacePattern)
        .map((relation) => relation.toLowerCase());
      if (
        !relations.some((relation) => fetchedLinkRelationPattern.test(relation))
      ) {
        continue;
      }
      const href = node.attrs?.find(({ name }) => name === "href")?.value;
      if (href !== undefined) {
        addLocalAssetPath(href, localAssetPaths, baseUrl);
      }
    }
    const assetAttributeNames = localAssetAttributesByTag.get(node.tagName);
    const srcsetAttributeNames = localSrcsetAttributesByTag.get(node.tagName);

    for (const { name, value } of node.attrs ?? []) {
      if (assetAttributeNames?.includes(name)) {
        addLocalAssetPath(value, localAssetPaths, baseUrl);
      } else if (srcsetAttributeNames?.includes(name)) {
        for (const candidateUrl of parseSrcsetCandidateUrls(value)) {
          addLocalAssetPath(candidateUrl, localAssetPaths, baseUrl);
        }
      }
    }
  }
  collectJavaScriptAssetPaths(indexHtml, localAssetPaths, baseUrl);

  return [...localAssetPaths].sort();
}

function assertPackagedAndroidWebAssets(
  artifactPath,
  archiveEntries,
  runtimeIndexEntry,
  indexHtml
) {
  const runtimeAssetRoot = runtimeIndexEntry.slice(0, -"index.html".length);
  const archiveEntrySet = new Set(archiveEntries);
  const referencedAssetPaths = new Set(
    collectLocalAndroidWebAssetPaths(indexHtml, androidWebApplicationOrigin)
  );
  for (const entry of archiveEntries) {
    const assetPath = entry.slice(runtimeAssetRoot.length);
    const extension = extname(assetPath).toLowerCase();
    if (
      entry.startsWith(runtimeAssetRoot) &&
      (extension === ".js" || extension === ".mjs")
    ) {
      collectJavaScriptAssetPaths(
        readUnzipOutput(artifactPath, ["-p", artifactPath, entry]),
        referencedAssetPaths,
        new URL(`/${assetPath}`, androidWebApplicationOrigin)
      );
      continue;
    }
    const dependencyPattern =
      extension === ".css"
        ? cssDependencyPattern
        : extension === ".webmanifest" ||
            /manifest[^/]*\.json$/i.test(assetPath)
          ? manifestDependencyPattern
          : undefined;
    if (!entry.startsWith(runtimeAssetRoot) || !dependencyPattern) {
      continue;
    }
    const source = readUnzipOutput(artifactPath, ["-p", artifactPath, entry]);
    for (const match of source.matchAll(dependencyPattern)) {
      addLocalAssetPath(
        match[1],
        referencedAssetPaths,
        new URL(`/${assetPath}`, androidWebApplicationOrigin)
      );
    }
  }
  const missingAssetEntries = [...referencedAssetPaths]
    .map((assetPath) => `${runtimeAssetRoot}${assetPath}`)
    .filter((assetEntry) => !archiveEntrySet.has(assetEntry));

  if (missingAssetEntries.length > 0) {
    throw new Error(
      `${artifactPath} is missing Android web assets referenced by ${runtimeIndexEntry}: ${missingAssetEntries.join(", ")}`
    );
  }
}

function assertCanonicalSchema4Registration(runtimeBridge, sourceLabel) {
  const sourceFile = ts.createSourceFile(
    sourceLabel,
    runtimeBridge,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const schemaDeclarations = [];
  const schemaAssignments = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "currentBootstrapSchemaVersion"
    ) {
      schemaDeclarations.push(node);
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "schema_version"
    ) {
      schemaAssignments.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const [schemaDeclaration] = schemaDeclarations;
  const [schemaAssignment] = schemaAssignments;
  const declaresSchema4 =
    schemaDeclarations.length === 1 &&
    (schemaDeclaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isNumericLiteral(schemaDeclaration.initializer) &&
    schemaDeclaration.initializer.text === "4";
  const registersSchemaConstant =
    schemaAssignments.length === 1 &&
    ts.isIdentifier(schemaAssignment.initializer) &&
    schemaAssignment.initializer.text === "currentBootstrapSchemaVersion";

  if (
    sourceFile.parseDiagnostics.length > 0 ||
    !declaresSchema4 ||
    !registersSchemaConstant
  ) {
    throw new Error(
      `${sourceLabel} must declare schema 4 independently and assign it to notification registration.`
    );
  }
}

function assertCanonicalAndroidRuntimeIndex(
  indexHtml,
  sourceLabel,
  expectedBridge
) {
  assertCompleteAndroidWebApplicationShell(indexHtml, sourceLabel);
  const actualBridge = extractAndroidRuntimeBridge(indexHtml, sourceLabel);

  assertCanonicalSchema4Registration(actualBridge, sourceLabel);

  if (actualBridge !== expectedBridge) {
    throw new Error(
      `${sourceLabel} does not contain the canonical schema 4 runtime bridge.`
    );
  }
}

function buildExpectedBridge(stringsXmlPath) {
  return buildNativeAuthBridgeBootstrapScript(
    readApiBaseUrlFromStringsXml(readFileSync(stringsXmlPath, "utf8"))
  );
}

export function verifyAndroidRuntimeSchemaIndex(indexHtmlPath, stringsXmlPath) {
  assertCanonicalAndroidRuntimeIndex(
    readFileSync(indexHtmlPath, "utf8"),
    indexHtmlPath,
    buildExpectedBridge(stringsXmlPath)
  );
}

export function verifyAndroidRuntimeSchemaArtifact(
  artifactPath,
  stringsXmlPath
) {
  const expectedBridge = buildExpectedBridge(stringsXmlPath);
  const archiveEntries = readUnzipOutput(artifactPath, ["-Z1", artifactPath])
    .split(/\r?\n/)
    .filter(Boolean);
  const runtimeIndexEntry = selectRuntimeIndexEntry(
    artifactPath,
    archiveEntries
  );

  const sourceLabel = `${artifactPath}:${runtimeIndexEntry}`;
  const indexHtml = readUnzipOutput(artifactPath, [
    "-p",
    artifactPath,
    runtimeIndexEntry,
  ]);
  assertPackagedAndroidWebAssets(
    artifactPath,
    archiveEntries,
    runtimeIndexEntry,
    indexHtml
  );
  assertCanonicalAndroidRuntimeIndex(indexHtml, sourceLabel, expectedBridge);
}

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const [, , inputPath, stringsXmlPath] = process.argv;
    if (!inputPath || !stringsXmlPath) {
      throw new Error(
        "Usage: node scripts/verify-android-runtime-schema.mjs <apk-aab-or-index-html> <strings-xml>"
      );
    }
    const resolvedInputPath = resolve(inputPath);
    const resolvedStringsXmlPath = resolve(stringsXmlPath);
    if (extname(resolvedInputPath).toLowerCase() === ".html") {
      verifyAndroidRuntimeSchemaIndex(
        resolvedInputPath,
        resolvedStringsXmlPath
      );
      console.log("ANDROID_RUNTIME_SCHEMA_INDEX_OK");
    } else {
      verifyAndroidRuntimeSchemaArtifact(
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
