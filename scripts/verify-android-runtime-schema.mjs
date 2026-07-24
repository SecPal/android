#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildNativeAuthBridgeBootstrapScript,
  readApiBaseUrlFromStringsXml,
} from "./inject-native-auth-bridge.mjs";

const runtimeScriptStart = '<script id="secpal-native-auth-bridge-bootstrap">';
const runtimeScriptEnd = "</script>";
const runtimeScriptTagPattern =
  /<script\b[^>]*\bid\s*=\s*["']secpal-native-auth-bridge-bootstrap["'][^>]*>/gi;
const runtimeIndexEntries = [
  "assets/public/index.html",
  "base/assets/public/index.html",
];

function extractAndroidRuntimeBridge(indexHtml, sourceLabel) {
  const startIndex = indexHtml.indexOf(runtimeScriptStart);
  const runtimeScriptTags = indexHtml.match(runtimeScriptTagPattern) ?? [];

  if (startIndex < 0 || runtimeScriptTags.length !== 1) {
    throw new Error(
      `${sourceLabel} must contain exactly one injected Android runtime bridge.`
    );
  }

  const scriptContentStart = startIndex + runtimeScriptStart.length;
  const endIndex = indexHtml.indexOf(runtimeScriptEnd, scriptContentStart);

  if (endIndex < 0) {
    throw new Error(`${sourceLabel} contains an unterminated runtime bridge.`);
  }

  return indexHtml.slice(scriptContentStart, endIndex);
}

export function verifyAndroidRuntimeSchemaArtifact(
  artifactPath,
  stringsXmlPath
) {
  const stringsXml = readFileSync(stringsXmlPath, "utf8");
  const expectedBridge = buildNativeAuthBridgeBootstrapScript(
    readApiBaseUrlFromStringsXml(stringsXml)
  );

  for (const entry of runtimeIndexEntries) {
    const result = spawnSync("unzip", ["-p", artifactPath, entry], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });

    if (result.error) {
      throw new Error(
        `Unable to inspect ${artifactPath}: ${result.error.message}`
      );
    }

    if (result.status !== 0) {
      continue;
    }

    const sourceLabel = `${artifactPath}:${entry}`;
    const actualBridge = extractAndroidRuntimeBridge(
      result.stdout,
      sourceLabel
    );

    if (actualBridge !== expectedBridge) {
      throw new Error(
        `${sourceLabel} does not contain the canonical schema 4 runtime bridge.`
      );
    }

    return;
  }

  throw new Error(
    `${artifactPath} does not contain the Android runtime index in an APK or AAB location.`
  );
}

const invokedPath = process.argv[1];

if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  const artifactPath = process.argv[2];
  const stringsXmlPath = process.argv[3];

  if (!artifactPath || !stringsXmlPath) {
    console.error(
      "Usage: node scripts/verify-android-runtime-schema.mjs <apk-or-aab> <strings-xml>"
    );
    process.exitCode = 1;
  } else {
    try {
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
}
