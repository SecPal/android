#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schema4BridgeDeclaration =
  /const\s+currentBootstrapSchemaVersion\s*=\s*4\s*;/;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const versionNamePattern = /^\d+\.\d+\.\d+$/;
const versionCodePattern = /^[1-9]\d*$/;

function requireArgument(argumentsByName, name) {
  const value = argumentsByName.get(name);

  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }

  return value;
}

export function parseSchema4ReleaseVerificationArguments(argumentsList) {
  const argumentsByName = new Map();

  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];

    if (!name?.startsWith("--") || !value || argumentsByName.has(name)) {
      throw new Error(
        "Expected each release verifier argument exactly once as --name value."
      );
    }

    argumentsByName.set(name, value);
  }

  const apkPath = requireArgument(argumentsByName, "--apk");
  const expectedVersionName = requireArgument(
    argumentsByName,
    "--version-name"
  );
  const expectedVersionCode = requireArgument(
    argumentsByName,
    "--version-code"
  );
  const expectedSha256 = requireArgument(
    argumentsByName,
    "--sha256"
  ).toLowerCase();

  if (!versionNamePattern.test(expectedVersionName)) {
    throw new Error("Expected --version-name to be a semantic version.");
  }

  if (!versionCodePattern.test(expectedVersionCode)) {
    throw new Error("Expected --version-code to be a positive integer.");
  }

  if (!sha256Pattern.test(expectedSha256)) {
    throw new Error(
      "Expected --sha256 to be a 64-character hexadecimal SHA-256."
    );
  }

  return {
    apkPath,
    expectedSha256,
    expectedVersionCode,
    expectedVersionName,
  };
}

export function verifySchema4ReleaseArtifactContents({
  bridgeHtml,
  expectedSha256,
  expectedVersionCode,
  expectedVersionName,
  sha256,
  versionCode,
  versionName,
}) {
  if (versionName !== expectedVersionName) {
    throw new Error(
      `APK version name ${versionName} does not match expected ${expectedVersionName}.`
    );
  }

  if (versionCode !== expectedVersionCode) {
    throw new Error(
      `APK version code ${versionCode} does not match expected ${expectedVersionCode}.`
    );
  }

  if (sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      "APK SHA-256 does not match the immutable release checksum."
    );
  }

  if (!schema4BridgeDeclaration.test(bridgeHtml)) {
    throw new Error("APK bridge does not declare strict integer schema 4.");
  }
}

function runCommand(command, argumentsList) {
  try {
    return execFileSync(command, argumentsList, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const details =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(
      `Failed to run ${command} ${argumentsList.join(" ")}${details ? `: ${details}` : ""}`
    );
  }
}

export function verifySchema4ReleaseArtifact({
  apkPath,
  expectedSha256,
  expectedVersionCode,
  expectedVersionName,
}) {
  const apkanalyzer =
    process.env.SECPAL_ANDROID_APKANALYZER?.trim() || "apkanalyzer";
  const bridgeHtml = runCommand("unzip", [
    "-p",
    apkPath,
    "assets/public/index.html",
  ]);
  const versionName = runCommand(apkanalyzer, [
    "manifest",
    "version-name",
    apkPath,
  ]);
  const versionCode = runCommand(apkanalyzer, [
    "manifest",
    "version-code",
    apkPath,
  ]);
  const sha256 = createHash("sha256")
    .update(readFileSync(apkPath))
    .digest("hex");

  verifySchema4ReleaseArtifactContents({
    bridgeHtml,
    expectedSha256,
    expectedVersionCode,
    expectedVersionName,
    sha256,
    versionCode,
    versionName,
  });
}

function main() {
  const verificationArguments = parseSchema4ReleaseVerificationArguments(
    process.argv.slice(2)
  );

  verifySchema4ReleaseArtifact(verificationArguments);
  process.stdout.write(
    `Verified schema-4 APK ${verificationArguments.expectedVersionName} (${verificationArguments.expectedVersionCode}).\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
