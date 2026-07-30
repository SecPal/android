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
  ["link", ["href"]],
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

function addLocalAndroidWebAssetPath(value, localAssetPaths) {
  if (value.length === 0) {
    return;
  }

  try {
    const assetUrl = new URL(value, androidWebApplicationOrigin);
    if (assetUrl.origin !== androidWebApplicationOrigin) {
      return;
    }

    const assetPath = decodeURIComponent(assetUrl.pathname).replace(/^\/+/, "");
    if (assetPath.length > 0 && assetPath !== "index.html") {
      localAssetPaths.add(assetPath);
    }
  } catch {
    // Invalid local references are rejected as missing packaged assets.
    localAssetPaths.add(value);
  }
}

function collectLocalAndroidWebAssetPaths(indexHtml) {
  const localAssetPaths = new Set();
  const pending = [parse(indexHtml)];

  while (pending.length > 0) {
    const node = pending.pop();
    const assetAttributeNames = localAssetAttributesByTag.get(node.tagName);
    const srcsetAttributeNames = localSrcsetAttributesByTag.get(node.tagName);

    for (const { name, value } of node.attrs ?? []) {
      if (assetAttributeNames?.includes(name)) {
        addLocalAndroidWebAssetPath(value, localAssetPaths);
      } else if (srcsetAttributeNames?.includes(name)) {
        for (const candidateUrl of parseSrcsetCandidateUrls(value)) {
          addLocalAndroidWebAssetPath(candidateUrl, localAssetPaths);
        }
      }
    }

    pending.push(...(node.childNodes ?? []));
  }

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
  const missingAssetEntries = collectLocalAndroidWebAssetPaths(indexHtml)
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
