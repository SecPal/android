#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, writeFileSync } from "node:fs";

const REQUIRED_ACCESS_POLICY = [
  '  <access origin="https://api.secpal.dev" />',
  '  <access origin="https://app.secpal.dev" />',
  '  <allow-navigation href="https://app.secpal.dev/*" />',
].join("\n");

export function normalizeCordovaConfig(configContent) {
  const normalizedContent = configContent
    .replace(/\s*<access origin="\*" \/>\n?/g, "\n")
    .replace(/\s*<access origin="https:\/\/api\.secpal\.dev" \/>\n?/g, "\n")
    .replace(/\s*<access origin="https:\/\/app\.secpal\.dev" \/>\n?/g, "\n")
    .replace(
      /\s*<allow-navigation href="https:\/\/app\.secpal\.dev\/\*" \/>\n?/g,
      "\n"
    )
    .replace(/\n{3,}/g, "\n\n")
    .replace(/<\/widget>\s*$/, `${REQUIRED_ACCESS_POLICY}\n</widget>`);

  if (
    normalizedContent === configContent &&
    !configContent.includes("</widget>")
  ) {
    throw new Error("Expected a Cordova widget root in config.xml");
  }

  return normalizedContent.endsWith("\n")
    ? normalizedContent
    : `${normalizedContent}\n`;
}

export function normalizeCordovaConfigFile(configPath) {
  const currentContent = readFileSync(configPath, "utf8");
  const normalizedContent = normalizeCordovaConfig(currentContent);

  if (normalizedContent !== currentContent) {
    writeFileSync(configPath, normalizedContent, "utf8");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const configPath = process.argv[2];

  if (!configPath) {
    console.error(
      "Usage: node scripts/normalize-cordova-config.mjs <config-xml-path>"
    );
    process.exit(1);
  }

  normalizeCordovaConfigFile(configPath);
}
