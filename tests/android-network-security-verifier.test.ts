/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const validApi36NetworkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
    <certificateTransparency enabled="true" />
  </base-config>
</network-security-config>
`;

const validApi37NetworkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
    <certificateTransparency enabled="true" />
  </base-config>
  <domain-config>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`;

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "android-network-security-"));
  tempRoots.push(root);
  const manifestPath = join(root, "AndroidManifest.xml");
  const resourcesPath = join(root, "resources");
  const defaultConfigDirectory = join(resourcesPath, "xml");
  const api36ConfigDirectory = join(resourcesPath, "xml-v36");
  const api37ConfigDirectory = join(resourcesPath, "xml-v37");

  mkdirSync(defaultConfigDirectory, { recursive: true });
  mkdirSync(api36ConfigDirectory);
  mkdirSync(api37ConfigDirectory);
  writeFileSync(manifestPath, validManifest);
  writeFileSync(
    join(defaultConfigDirectory, "network_security_config.xml"),
    validNetworkSecurityConfig
  );
  writeFileSync(
    join(api36ConfigDirectory, "network_security_config.xml"),
    validApi36NetworkSecurityConfig
  );
  writeFileSync(
    join(api37ConfigDirectory, "network_security_config.xml"),
    validApi37NetworkSecurityConfig
  );

  return { manifestPath, resourcesPath };
};

const runVerifier = (manifestPath: string, resourcesPath: string) =>
  spawnSync("node", [verifier, manifestPath, resourcesPath], {
    encoding: "utf8",
  });

const writeQualifiedConfig = (resourcesPath: string, contents: string) => {
  writeFileSync(
    join(resourcesPath, "xml-v36", "network_security_config.xml"),
    contents
  );
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Android release network security verifier", () => {
  it("accepts the canonical system-PKI fallback and API 36 CT policy", () => {
    const fixture = createFixture();

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects release resources without the API 36 CT policy", () => {
    const fixture = createFixture();
    rmSync(join(fixture.resourcesPath, "xml-v36"), {
      recursive: true,
      force: true,
    });

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must define an API 36 network security policy"
    );
  });

  it("rejects release resources without the API 37 localhost hardening policy", () => {
    const fixture = createFixture();
    rmSync(join(fixture.resourcesPath, "xml-v37"), {
      recursive: true,
      force: true,
    });

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must define an API 37 localhost hardening policy"
    );
  });

  it.each([
    ["API 36", "xml-v36", "xml-night-v36"],
    ["API 37", "xml-v37", "xml-night-v37"],
  ])(
    "rejects an %s policy confined to a non-version resource qualifier",
    (_, canonicalDirectory, qualifiedDirectory) => {
      const fixture = createFixture();
      renameSync(
        join(fixture.resourcesPath, canonicalDirectory),
        join(fixture.resourcesPath, qualifiedDirectory)
      );

      const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "must use only the canonical xml, xml-v36, and xml-v37 directories"
      );
    }
  );

  it.each([
    ["mode-qualified fallback", "xml-night-v35", validNetworkSecurityConfig],
    ["future API policy", "xml-v38", validApi36NetworkSecurityConfig],
  ])("rejects an unsupported %s", (_, directory, policy) => {
    const fixture = createFixture();
    const qualifiedDirectory = join(fixture.resourcesPath, directory);
    mkdirSync(qualifiedDirectory);
    writeFileSync(
      join(qualifiedDirectory, "network_security_config.xml"),
      policy
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must use only the canonical xml, xml-v36, and xml-v37 directories"
    );
  });

  it("rejects an API 37 policy that leaves Android's implicit localhost exception active", () => {
    const fixture = createFixture();
    writeFileSync(
      join(fixture.resourcesPath, "xml-v37", "network_security_config.xml"),
      validApi37NetworkSecurityConfig.replace(
        `  <domain-config>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
`,
        ""
      )
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must explicitly configure localhost");
  });

  it("rejects CT elements that can be selected below API 36", () => {
    const fixture = createFixture();
    writeFileSync(
      join(fixture.resourcesPath, "xml", "network_security_config.xml"),
      validNetworkSecurityConfig.replace(
        "</base-config>",
        '  <certificateTransparency enabled="true" />\n  </base-config>'
      )
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "exposes certificateTransparency below API 36"
    );
  });

  it.each([
    [
      "disabled",
      validApi36NetworkSecurityConfig.replace(
        'enabled="true"',
        'enabled="false"'
      ),
    ],
    [
      "missing",
      validApi36NetworkSecurityConfig.replace(
        '    <certificateTransparency enabled="true" />\n',
        ""
      ),
    ],
    [
      "scoped to one domain",
      validApi36NetworkSecurityConfig.replace(
        '    <certificateTransparency enabled="true" />\n  </base-config>',
        `  </base-config>
  <domain-config>
    <domain includeSubdomains="false">api.secpal.dev</domain>
    <certificateTransparency enabled="true" />
  </domain-config>`
      ),
    ],
    [
      "overridden for one domain",
      validApi36NetworkSecurityConfig.replace(
        "</network-security-config>",
        `  <domain-config>
    <domain includeSubdomains="false">customer-api.example</domain>
    <certificateTransparency enabled="false" />
  </domain-config>
</network-security-config>`
      ),
    ],
  ])("rejects an API 36 CT policy that is %s", (_, policy) => {
    const fixture = createFixture();
    writeFileSync(
      join(fixture.resourcesPath, "xml-v36", "network_security_config.xml"),
      policy
    );

    const result = runVerifier(fixture.manifestPath, fixture.resourcesPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must enforce certificate transparency globally"
    );
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

  it("rejects an XML-encoded cleartext opt-in", () => {
    const fixture = createFixture();
    writeFileSync(
      join(fixture.resourcesPath, "xml-v36", "network_security_config.xml"),
      validApi36NetworkSecurityConfig.replace(
        "</network-security-config>",
        `  <domain-config cleartextTrafficPermitted="&#116;rue">
    <domain>api.secpal.dev</domain>
  </domain-config>
</network-security-config>`
      )
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
    expect(result.stderr).toContain("XML is malformed");
  });
});
