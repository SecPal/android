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
const localAssetAttributePattern =
  /^(?:(?:audio|embed|iframe|img|input|script|source|track|video):src|(?:image|use):(?:href|xlink:href)|object:data|video:poster|(?:img|source):srcset|link:imagesrcset)$/;
const fetchedLinkRelationPattern =
  /^(?:apple-touch-icon|apple-touch-startup-image|icon|manifest|mask-icon|modulepreload|prefetch|preload|stylesheet)$/i;
const cssDependencyPattern =
  /(?:url\(\s*|@import\s+(?:url\(\s*)?)["']?([^"')\s;]+)/g;
const executableScriptTypePattern =
  /^(?:module|(?:application|text)\/(?:java|ecma)script(?:1\.[0-5])?)$/i;
const documentScriptLoaderPattern =
  /^(?:Worker|SharedWorker|navigator\.serviceWorker\.register)$/;
const workerConstructorPattern = /^(?:Worker|SharedWorker)$/;
const packagedAssetLiteralPattern =
  /^(?:\/|\.{1,2}\/).+\.(?:avif|css|gif|html?|ico|jpe?g|js|md|mjs|otf|png|svg|ttf|txt|wasm|webmanifest|webp|woff2?)(?:[?#].*)?$/i;
const packagedAssetPropertyPattern = /^(?:badge|href|icon|poster|src)$/;
const packagedAssetPropertyValuePattern =
  /(?:^|\/)(?:\.[^/]+|[^/]+\.[A-Za-z0-9]{1,16})(?:[?#].*)?$/;
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
    position += srcset.slice(position).match(/^[\t\n\f\r ,]*/)?.[0].length ?? 0;
    if (position === srcset.length) break;
    const candidateUrl = srcset.slice(position).match(/^[^\t\n\f\r ]+/)?.[0];
    position += candidateUrl.length;
    const normalizedUrl = candidateUrl.replace(/,+$/, "");
    if (normalizedUrl) candidateUrls.push(normalizedUrl);
    if (candidateUrl.endsWith(",")) continue;

    let parenthesesDepth = 0;
    while (position < srcset.length) {
      const character = srcset[position++];
      if (character === "(") parenthesesDepth += 1;
      if (character === ")")
        parenthesesDepth = Math.max(0, parenthesesDepth - 1);
      if (character === "," && parenthesesDepth === 0) break;
    }
  }

  return candidateUrls;
}

function addLocalAssetPath(value, paths, baseUrl) {
  if (!value) return null;
  try {
    const assetUrl = new URL(value, baseUrl);
    if (assetUrl.origin !== androidWebApplicationOrigin) return null;
    const assetPath = decodeURIComponent(assetUrl.pathname).replace(/^\/+/, "");
    if (!assetPath || assetPath === "index.html") return null;
    paths.add(assetPath);
    return assetPath;
  } catch {
    // Invalid local references are rejected as missing packaged assets.
    paths.add(value);
    return value;
  }
}

function addScriptAssetPath(
  value,
  localAssetPaths,
  baseUrl,
  scriptExecutionContexts,
  executionContext
) {
  const assetPath = addLocalAssetPath(value, localAssetPaths, baseUrl);
  if (!assetPath) return;
  const contexts = scriptExecutionContexts.get(assetPath) ?? new Set();
  contexts.add(executionContext);
  scriptExecutionContexts.set(assetPath, contexts);
}

function collectJavaScriptAssetPaths(
  source,
  localAssetPaths,
  sourceUrl,
  documentBaseUrl,
  scriptExecutionContexts,
  executionContext
) {
  for (const { fileName } of ts.preProcessFile(source, true, true)
    .importedFiles) {
    addScriptAssetPath(
      fileName,
      localAssetPaths,
      sourceUrl,
      scriptExecutionContexts,
      executionContext
    );
  }
  const sourceFile = ts.createSourceFile(
    "web.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const normalizedText = (node) =>
    node?.getText(sourceFile).replace(/\s/g, "") ?? "";
  const addArgument = (node, baseUrl) => {
    if (node && ts.isStringLiteralLike(node)) {
      addLocalAssetPath(node.text, localAssetPaths, baseUrl);
    }
  };
  const addScriptArgument = (node, baseUrl, context) => {
    if (node && ts.isStringLiteralLike(node)) {
      addScriptAssetPath(
        node.text,
        localAssetPaths,
        baseUrl,
        scriptExecutionContexts,
        context
      );
    }
  };
  const addWorkerArgument = (node, baseUrl) => {
    if (node && ts.isStringLiteralLike(node)) {
      addScriptArgument(node, baseUrl, "worker");
      return;
    }
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      normalizedText(node.expression) === "URL" &&
      normalizedText(node.arguments?.[1]) === "import.meta.url"
    ) {
      addScriptArgument(node.arguments?.[0], sourceUrl, "worker");
    }
  };
  const hasSpecializedReferenceParent = (node) => {
    const parent = node.parent;
    if (
      !parent ||
      (!ts.isCallExpression(parent) && !ts.isNewExpression(parent))
    ) {
      return false;
    }
    const loader = normalizedText(parent.expression);
    return (
      parent.arguments?.[0] === node &&
      (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
        loader === "importScripts" ||
        documentScriptLoaderPattern.test(loader) ||
        (loader === "URL" &&
          normalizedText(parent.arguments?.[1]) === "import.meta.url"))
    );
  };
  const propertyName = (node) =>
    ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : "";
  const isPrecacheUrlProperty = (node) =>
    propertyName(node.name) === "url" &&
    ts.isObjectLiteralExpression(node.parent) &&
    node.parent.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        propertyName(property.name) === "revision"
    );
  const visit = (node) => {
    if (
      ts.isStringLiteralLike(node) &&
      !hasSpecializedReferenceParent(node) &&
      packagedAssetLiteralPattern.test(node.text)
    ) {
      addLocalAssetPath(node.text, localAssetPaths, sourceUrl);
    }
    if (
      ts.isPropertyAssignment(node) &&
      (packagedAssetPropertyPattern.test(propertyName(node.name)) ||
        isPrecacheUrlProperty(node)) &&
      ts.isStringLiteralLike(node.initializer) &&
      packagedAssetPropertyValuePattern.test(node.initializer.text)
    ) {
      addLocalAssetPath(node.initializer.text, localAssetPaths, sourceUrl);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const loader = normalizedText(node.expression);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addScriptArgument(node.arguments?.[0], sourceUrl, executionContext);
      } else if (loader === "importScripts") {
        for (const argument of node.arguments ?? []) {
          addScriptArgument(argument, sourceUrl, "worker");
        }
      } else if (
        loader === "URL" &&
        normalizedText(node.arguments?.[1]) === "import.meta.url"
      ) {
        addArgument(node.arguments?.[0], sourceUrl);
      } else if (documentScriptLoaderPattern.test(loader)) {
        const baseUrl =
          executionContext === "worker" && workerConstructorPattern.test(loader)
            ? sourceUrl
            : documentBaseUrl;
        addWorkerArgument(node.arguments?.[0], baseUrl);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectManifestAssetPaths(source, localAssetPaths, baseUrl) {
  const pending = [JSON.parse(source)];
  for (const value of pending) {
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === "src" && typeof child === "string") {
        addLocalAssetPath(child, localAssetPaths, baseUrl);
      } else if (child && typeof child === "object") pending.push(child);
    }
  }
}

function collectLocalAndroidWebAssetPaths(
  indexHtml,
  documentUrl,
  scriptExecutionContexts
) {
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
    const attributes = Object.fromEntries(
      (node.attrs ?? []).map(({ name, value }) => [name, value])
    );
    if (node.tagName === "link") {
      if (
        !(attributes.rel ?? "")
          .split(asciiWhitespacePattern)
          .some((relation) => fetchedLinkRelationPattern.test(relation))
      ) {
        continue;
      }
      if (attributes.href !== undefined) {
        addLocalAssetPath(attributes.href, localAssetPaths, baseUrl);
      }
    }
    for (const [name, value] of Object.entries(attributes)) {
      if (localAssetAttributePattern.test(`${node.tagName}:${name}`)) {
        for (const asset of name.endsWith("srcset")
          ? parseSrcsetCandidateUrls(value)
          : [value]) {
          if (node.tagName === "script" && name === "src") {
            addScriptAssetPath(
              asset,
              localAssetPaths,
              baseUrl,
              scriptExecutionContexts,
              "document"
            );
          } else {
            addLocalAssetPath(asset, localAssetPaths, baseUrl);
          }
        }
      }
    }
    if (node.tagName === "script" && attributes.src === undefined) {
      const type = (attributes.type ?? "").split(";")[0].trim();
      if (type === "" || executableScriptTypePattern.test(type)) {
        collectJavaScriptAssetPaths(
          (node.childNodes ?? []).map((child) => child.value ?? "").join(""),
          localAssetPaths,
          baseUrl,
          baseUrl,
          scriptExecutionContexts,
          "document"
        );
      }
    }
  }

  return { baseUrl, paths: localAssetPaths };
}

function assertPackagedAndroidWebAssets(
  artifactPath,
  archiveEntries,
  runtimeIndexEntry,
  indexHtml
) {
  const runtimeAssetRoot = runtimeIndexEntry.slice(0, -"index.html".length);
  const archiveEntrySet = new Set(archiveEntries);
  const scriptExecutionContexts = new Map();
  const { baseUrl: documentBaseUrl, paths: referencedAssetPaths } =
    collectLocalAndroidWebAssetPaths(
      indexHtml,
      new URL("/", androidWebApplicationOrigin),
      scriptExecutionContexts
    );
  const processedAssetContexts = new Set();
  let foundPendingAsset = true;
  while (foundPendingAsset) {
    foundPendingAsset = false;
    for (const assetPath of referencedAssetPaths) {
      const entry = `${runtimeAssetRoot}${assetPath}`;
      if (!archiveEntrySet.has(entry)) {
        continue;
      }
      const extension = extname(assetPath).toLowerCase();
      const sourceUrl = new URL(`/${assetPath}`, androidWebApplicationOrigin);
      const executionContexts =
        extension === ".js" || extension === ".mjs"
          ? (scriptExecutionContexts.get(assetPath) ?? new Set(["document"]))
          : new Set(["asset"]);
      for (const executionContext of executionContexts) {
        const contextKey = `${executionContext}:${assetPath}`;
        if (processedAssetContexts.has(contextKey)) {
          continue;
        }
        processedAssetContexts.add(contextKey);
        foundPendingAsset = true;
        const source = readUnzipOutput(artifactPath, [
          "-p",
          artifactPath,
          entry,
        ]);
        if (extension === ".js" || extension === ".mjs") {
          collectJavaScriptAssetPaths(
            source,
            referencedAssetPaths,
            sourceUrl,
            documentBaseUrl,
            scriptExecutionContexts,
            executionContext
          );
        } else if (extension === ".css") {
          for (const match of source
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .matchAll(cssDependencyPattern)) {
            addLocalAssetPath(match[1], referencedAssetPaths, sourceUrl);
          }
        } else if (
          extension === ".webmanifest" ||
          /manifest[^/]*\.json$/i.test(assetPath)
        ) {
          collectManifestAssetPaths(source, referencedAssetPaths, sourceUrl);
        }
      }
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
