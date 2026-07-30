#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { parse } from "parse5";
import ts from "typescript";
import {
  assertAndroidWebAssetArchive,
  assertAndroidWebAssetDirectory,
  androidWebAssetInventoryName,
} from "./android-web-asset-inventory.mjs";
import {
  assertCompleteAndroidWebApplicationShell,
  buildNativeAuthBridgeBootstrapScript,
  isDirectNodeExecution,
  readApiBaseUrlFromStringsXml,
} from "./inject-native-auth-bridge.mjs";
import {
  openLiteralZipArchive,
  ZipArchiveReadError,
} from "./literal-zip-archive.mjs";

const runtimeScriptId = "secpal-native-auth-bridge-bootstrap";
const runtimeScriptStart = '<script id="secpal-native-auth-bridge-bootstrap">';
const runtimeIndexEntryByExtension = new Map([
  [".apk", "assets/public/index.html"],
  [".aab", "base/assets/public/index.html"],
]);
const runtimeIndexEntries = [...runtimeIndexEntryByExtension.values()];

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
  assertAndroidWebAssetDirectory(assetRoot, inventoryPath);
  verifyAndroidRuntimeSchemaIndex(
    join(assetRoot, "index.html"),
    stringsXmlPath
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
    await assertAndroidWebAssetArchive({
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
    assertCanonicalAndroidRuntimeIndex(indexHtml, sourceLabel, expectedBridge);
  } catch (error) {
    if (error instanceof ZipArchiveReadError) {
      throw new Error(`Unable to inspect ${artifactPath}: ${error.message}`);
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
        resolvedStringsXmlPath
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
