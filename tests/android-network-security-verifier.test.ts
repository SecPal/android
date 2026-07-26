/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const verifier = resolve(
  repoRoot,
  "scripts",
  "verify-android-network-security.mjs"
);
const tempRoots: string[] = [];

const validManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application
    android:networkSecurityConfig="@xml/network_security_config"
    android:usesCleartextTraffic="false" />
</manifest>
`;

const validNetworkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "android-network-security-"));
  tempRoots.push(root);
  const manifestPath = join(root, "AndroidManifest.xml");
  const resourcesPath = join(root, "resources");
  const defaultConfigDirectory = join(resourcesPath, "xml");

  mkdirSync(defaultConfigDirectory, { recursive: true });
  writeFileSync(manifestPath, validManifest);
  writeFileSync(
    join(defaultConfigDirectory, "network_security_config.xml"),
    validNetworkSecurityConfig
  );

  return { manifestPath, resourcesPath };
};

const runVerifier = (manifestPath: string, resourcesPath: string) =>
  spawnSync("node", [verifier, manifestPath, resourcesPath], {
    encoding: "utf8",
  });

const writeQualifiedConfig = (resourcesPath: string, contents: string) => {
  const qualifiedConfigDirectory = join(resourcesPath, "xml-v24");
  mkdirSync(qualifiedConfigDirectory);
  writeFileSync(
    join(qualifiedConfigDirectory, "network_security_config.xml"),
    contents
  );
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Android release network security verifier", () => {
  it("accepts the canonical system-PKI release policy", () => {
    const fixture = createFixture();

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects an insecure API-qualified resource selected by supported devices", () => {
    const fixture = createFixture();
    writeQualifiedConfig(
      fixture.resourcesPath,
      `<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("permits cleartext traffic");
  });

  it.each([
    [
      "user-installed certificate authorities",
      `<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`,
      "non-system trust source",
    ],
    [
      "certificate pinning",
      `<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config>
    <domain>api.secpal.dev</domain>
    <pin-set>
      <pin digest="SHA-256">3BJmezOWc04OlOrJ501K2t07GXxrHS5qQC7T7OnnO7k=</pin>
    </pin-set>
  </domain-config>
</network-security-config>
`,
      "contains certificate pinning",
    ],
    [
      "debug trust overrides",
      `<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <debug-overrides>
    <trust-anchors>
      <certificates src="user" />
    </trust-anchors>
  </debug-overrides>
</network-security-config>
`,
      "contains debug trust overrides",
    ],
  ])("rejects a qualified policy containing %s", (_, policy, message) => {
    const fixture = createFixture();
    writeQualifiedConfig(fixture.resourcesPath, policy);

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it("rejects a release manifest that redirects the canonical policy", () => {
    const fixture = createFixture();
    writeFileSync(
      fixture.manifestPath,
      validManifest.replace(
        '@xml/network_security_config"',
        '@xml/release_insecure_network_config"'
      )
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must reference @xml/network_security_config"
    );
  });

  it("rejects a release manifest that enables cleartext traffic", () => {
    const fixture = createFixture();
    writeFileSync(
      fixture.manifestPath,
      validManifest.replace(
        'android:usesCleartextTraffic="false"',
        'android:usesCleartextTraffic="true"'
      )
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must disable cleartext traffic");
  });

  it("rejects an alias that can redirect the canonical XML resource", () => {
    const fixture = createFixture();
    const valuesDirectory = join(fixture.resourcesPath, "values");
    mkdirSync(valuesDirectory);
    writeFileSync(
      join(valuesDirectory, "values.xml"),
      `<resources>
  <item name="network_security_config" type="xml">
    @xml/release_insecure_network_config
  </item>
</resources>
`
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not alias network_security_config");
  });

  it("rejects a comment boundary that exposes a new XML comment opener", () => {
    const fixture = createFixture();
    writeFileSync(
      join(fixture.resourcesPath, "xml", "network_security_config.xml"),
      validNetworkSecurityConfig.replace(
        "</network-security-config>",
        "<<!-- removed comment -->!--\n</network-security-config>"
      )
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unterminated XML comment");
  });
});
