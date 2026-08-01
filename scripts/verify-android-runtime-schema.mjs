#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
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
const runtimeBridgeLikeFilePattern =
  /^secpal-native-auth-bridge(?:\.[^/]*)?\.js$/u;
const runtimeBridgeSourcePattern =
  /^\/secpal-native-auth-bridge\.([0-9a-f]{64})\.js$/u;
const runtimeIndexEntryByExtension = new Map([
  [".apk", "assets/public/index.html"],
  [".aab", "base/assets/public/index.html"],
]);
const runtimeIndexEntries = [...runtimeIndexEntryByExtension.values()];

function extractAndroidRuntimeBridgeReference(indexHtml, sourceLabel) {
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
      `${sourceLabel} must contain exactly one native auth bridge script with the canonical ID.`
    );
  }

  const [runtimeScript] = runtimeScripts;
  const location = runtimeScript.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) {
    throw new Error(
      `${sourceLabel} contains an unterminated native auth bridge tag.`
    );
  }

  const inlineContent = indexHtml.slice(
    location.startTag.endOffset,
    location.endTag.startOffset
  );
  if (inlineContent.length > 0) {
    throw new Error(
      `${sourceLabel} native auth bridge script must not contain inline content.`
    );
  }

  const sourceAttributes = runtimeScript.attrs.filter(
    ({ name }) => name === "src"
  );
  if (sourceAttributes.length !== 1 || sourceAttributes[0].value.length === 0) {
    throw new Error(
      `${sourceLabel} native auth bridge script must define src exactly once.`
    );
  }

  const sourcePath = sourceAttributes[0].value;
  const sourceMatch = runtimeBridgeSourcePattern.exec(sourcePath);
  if (!sourceMatch) {
    throw new Error(
      `${sourceLabel} native auth bridge src must use the controlled root-relative SHA-256 asset path.`
    );
  }

  const fileName = sourcePath.slice(1);
  const expectedStartTag = `<script id="${runtimeScriptId}" src="${sourcePath}">`;
  const actualStartTag = indexHtml.slice(
    location.startTag.startOffset,
    location.startTag.endOffset
  );
  if (runtimeScript.attrs.length !== 2 || actualStartTag !== expectedStartTag) {
    throw new Error(
      `${sourceLabel} contains a non-canonical native auth bridge tag.`
    );
  }

  return {
    expectedHash: sourceMatch[1],
    fileName,
  };
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

function buildExpectedBridge(stringsXmlPath) {
  return buildNativeAuthBridgeBootstrapScript(
    readApiBaseUrlFromStringsXml(readFileSync(stringsXmlPath, "utf8"))
  );
}

function assertCanonicalBridgeContent({
  bridgeContent,
  expectedBridge,
  expectedHash,
  sourceLabel,
}) {
  const actualHash = createHash("sha256")
    .update(bridgeContent, "utf8")
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `${sourceLabel} native auth bridge SHA-256 does not match its file name.`
    );
  }

  assertCanonicalSchema4Registration(bridgeContent, sourceLabel);
  if (bridgeContent !== expectedBridge) {
    throw new Error(
      `${sourceLabel} does not contain the canonical schema 4 runtime bridge.`
    );
  }
}

function assertExactlyOneBridgeAsset(
  assetNames,
  expectedFileName,
  sourceLabel
) {
  const bridgeAssetNames = assetNames.filter((name) =>
    runtimeBridgeLikeFilePattern.test(name)
  );
  if (
    bridgeAssetNames.length !== 1 ||
    bridgeAssetNames[0] !== expectedFileName
  ) {
    throw new Error(
      `${sourceLabel} must contain exactly one packaged native auth bridge asset matching its index reference.`
    );
  }
}

function verifyAndroidRuntimeSchemaIndexInternal({
  assetRoot,
  expectedBridge,
  indexHtml,
  sourceLabel,
}) {
  assertCompleteAndroidWebApplicationShell(indexHtml, sourceLabel);
  const bridgeReference = extractAndroidRuntimeBridgeReference(
    indexHtml,
    sourceLabel
  );
  const bridgeAssetPath = join(assetRoot, bridgeReference.fileName);
  if (!existsSync(bridgeAssetPath) || !lstatSync(bridgeAssetPath).isFile()) {
    throw new Error(
      `${sourceLabel} referenced native auth bridge asset is missing.`
    );
  }

  assertExactlyOneBridgeAsset(
    readdirSync(assetRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
    bridgeReference.fileName,
    sourceLabel
  );
  assertCanonicalBridgeContent({
    bridgeContent: readFileSync(bridgeAssetPath, "utf8"),
    expectedBridge,
    expectedHash: bridgeReference.expectedHash,
    sourceLabel: bridgeAssetPath,
  });
}

export function verifyAndroidRuntimeSchemaIndex(indexHtmlPath, stringsXmlPath) {
  const resolvedIndexHtmlPath = resolve(indexHtmlPath);
  const assetRoot = dirname(resolvedIndexHtmlPath);
  const generatedInventoryPath = join(assetRoot, androidWebAssetInventoryName);
  verifyAndroidRuntimeSchemaIndexInternal({
    assetRoot,
    expectedBridge: buildExpectedBridge(stringsXmlPath),
    indexHtml: readFileSync(resolvedIndexHtmlPath, "utf8"),
    sourceLabel: resolvedIndexHtmlPath,
  });
  if (existsSync(generatedInventoryPath)) {
    assertAndroidWebAssetDirectory(assetRoot, generatedInventoryPath);
  }
}

export function verifyAndroidRuntimeSchemaDirectory(
  assetRoot,
  stringsXmlPath,
  fallbackInventoryPath
) {
  const resolvedAssetRoot = resolve(assetRoot);
  const generatedInventoryPath = join(
    resolvedAssetRoot,
    androidWebAssetInventoryName
  );
  const inventoryPath = existsSync(generatedInventoryPath)
    ? generatedInventoryPath
    : fallbackInventoryPath;
  if (!inventoryPath) {
    throw new Error(
      `${resolvedAssetRoot} must contain ${androidWebAssetInventoryName} or provide a fallback inventory.`
    );
  }
  assertAndroidWebAssetDirectory(resolvedAssetRoot, inventoryPath);
  const indexHtmlPath = join(resolvedAssetRoot, "index.html");
  verifyAndroidRuntimeSchemaIndexInternal({
    assetRoot: resolvedAssetRoot,
    expectedBridge: buildExpectedBridge(stringsXmlPath),
    indexHtml: readFileSync(indexHtmlPath, "utf8"),
    sourceLabel: indexHtmlPath,
  });
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

    const indexSourceLabel = `${artifactPath}:${runtimeIndexEntry}`;
    const indexHtml = (await archive.readEntry(runtimeIndexEntry)).toString(
      "utf8"
    );
    assertCompleteAndroidWebApplicationShell(indexHtml, indexSourceLabel);
    const bridgeReference = extractAndroidRuntimeBridgeReference(
      indexHtml,
      indexSourceLabel
    );
    const bridgeEntry = `${runtimeAssetRoot}${bridgeReference.fileName}`;
    if (!archive.entries.includes(bridgeEntry)) {
      throw new Error(
        `${indexSourceLabel} referenced native auth bridge asset is missing.`
      );
    }

    const rootAssetNames = archive.entries
      .filter((entry) => entry.startsWith(runtimeAssetRoot))
      .map((entry) => entry.slice(runtimeAssetRoot.length))
      .filter((entry) => entry.length > 0 && !entry.includes("/"));
    assertExactlyOneBridgeAsset(
      rootAssetNames,
      bridgeReference.fileName,
      artifactPath
    );
    assertCanonicalBridgeContent({
      bridgeContent: (await archive.readEntry(bridgeEntry)).toString("utf8"),
      expectedBridge,
      expectedHash: bridgeReference.expectedHash,
      sourceLabel: `${artifactPath}:${bridgeEntry}`,
    });
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
