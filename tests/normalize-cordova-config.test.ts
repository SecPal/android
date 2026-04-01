/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

async function loadNormalizerModule(): Promise<{
  normalizeCordovaConfig: (configContent: string) => string;
}> {
  // @ts-expect-error The normalizer intentionally remains a Node-executable .mjs helper and is exercised directly here.
  return import("../scripts/normalize-cordova-config.mjs");
}

describe("Cordova config normalization", () => {
  it("replaces the wildcard access policy with first-party origins", async () => {
    const { normalizeCordovaConfig } = await loadNormalizerModule();
    const generatedConfig = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<widget version="1.0.0" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">',
      '  <access origin="*" />',
      "</widget>",
      "",
    ].join("\n");

    const normalizedConfig = normalizeCordovaConfig(generatedConfig);

    expect(normalizedConfig).not.toContain('<access origin="*" />');
    expect(normalizedConfig).toContain(
      '<access origin="https://api.secpal.dev" />'
    );
    expect(normalizedConfig).toContain(
      '<access origin="https://app.secpal.dev" />'
    );
    expect(normalizedConfig).toContain(
      '<allow-navigation href="https://app.secpal.dev/*" />'
    );
    expect(normalizedConfig.endsWith("\n")).toBe(true);
  });

  it("is idempotent when the required access policy is already present", async () => {
    const { normalizeCordovaConfig } = await loadNormalizerModule();
    const normalizedConfig = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<widget version="1.0.0" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">',
      '  <access origin="https://api.secpal.dev" />',
      '  <access origin="https://app.secpal.dev" />',
      '  <allow-navigation href="https://app.secpal.dev/*" />',
      "</widget>",
      "",
    ].join("\n");

    expect(normalizeCordovaConfig(normalizedConfig)).toBe(normalizedConfig);
  });

  it("preserves unrelated widget content while rewriting access policy", async () => {
    const { normalizeCordovaConfig } = await loadNormalizerModule();
    const generatedConfig = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<widget version="1.0.0" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">',
      "  <name>SecPal</name>",
      '  <access origin="*" />',
      '  <preference name="AndroidLaunchMode" value="singleTask" />',
      "</widget>",
      "",
    ].join("\n");

    const normalizedConfig = normalizeCordovaConfig(generatedConfig);

    expect(normalizedConfig).toContain("  <name>SecPal</name>");
    expect(normalizedConfig).toContain(
      '  <preference name="AndroidLaunchMode" value="singleTask" />'
    );
    expect(normalizedConfig.match(/<access origin=/g)).toHaveLength(2);
    expect(normalizedConfig.match(/<allow-navigation/g)).toHaveLength(1);
  });
});
