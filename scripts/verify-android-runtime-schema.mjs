#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";
import {
  buildNativeAuthBridgeBootstrapScript,
  readApiBaseUrlFromStringsXml,
} from "./inject-native-auth-bridge.mjs";

const runtimeScriptId = "secpal-native-auth-bridge-bootstrap";
const runtimeScriptStart = '<script id="secpal-native-auth-bridge-bootstrap">';
const runtimeIndexEntries = [
  "assets/public/index.html",
  "base/assets/public/index.html",
];

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

export function verifyAndroidRuntimeSchemaArtifact(
  artifactPath,
  stringsXmlPath
) {
  const expectedBridge = buildNativeAuthBridgeBootstrapScript(
    readApiBaseUrlFromStringsXml(readFileSync(stringsXmlPath, "utf8"))
  );
  const archiveEntries = new Set(
    readUnzipOutput(artifactPath, ["-Z1", artifactPath])
      .split(/\r?\n/)
      .filter(Boolean)
  );
  const runtimeIndexEntry = runtimeIndexEntries.find((entry) =>
    archiveEntries.has(entry)
  );

  if (!runtimeIndexEntry) {
    throw new Error(
      `${artifactPath} does not contain the Android runtime index in an APK or AAB location.`
    );
  }

  const sourceLabel = `${artifactPath}:${runtimeIndexEntry}`;
  const actualBridge = extractAndroidRuntimeBridge(
    readUnzipOutput(artifactPath, ["-p", artifactPath, runtimeIndexEntry]),
    sourceLabel
  );

  if (actualBridge !== expectedBridge) {
    throw new Error(
      `${sourceLabel} does not contain the canonical schema 4 runtime bridge.`
    );
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , artifactPath, stringsXmlPath] = process.argv;
    if (!artifactPath || !stringsXmlPath) {
      throw new Error(
        "Usage: node scripts/verify-android-runtime-schema.mjs <apk-or-aab> <strings-xml>"
      );
    }
    verifyAndroidRuntimeSchemaArtifact(
      resolve(artifactPath),
      resolve(stringsXmlPath)
    );
    console.log("ANDROID_RUNTIME_SCHEMA_ARTIFACT_OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
