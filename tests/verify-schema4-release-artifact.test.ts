/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { describe, expect, it } from "vitest";

async function loadVerifierModule(): Promise<{
  parseSchema4ReleaseVerificationArguments: (argumentsList: string[]) => {
    apkPath: string;
    expectedSha256: string;
    expectedVersionCode: string;
    expectedVersionName: string;
  };
  verifySchema4ReleaseArtifactContents: (input: {
    bridgeHtml: string;
    expectedSha256: string;
    expectedVersionCode: string;
    expectedVersionName: string;
    sha256: string;
    versionCode: string;
    versionName: string;
  }) => void;
}> {
  const moduleUrl = new URL(
    `../scripts/verify-schema4-release-artifact.mjs?test=${Math.random().toString(16).slice(2)}`,
    import.meta.url
  );

  return import(moduleUrl.href);
}

describe("schema-4 release artifact verifier", () => {
  it("requires an APK path plus immutable version, build, and checksum evidence", async () => {
    const { parseSchema4ReleaseVerificationArguments } =
      await loadVerifierModule();

    expect(() => parseSchema4ReleaseVerificationArguments([])).toThrow(
      /--apk/i
    );
    expect(() =>
      parseSchema4ReleaseVerificationArguments([
        "--apk",
        "app.apk",
        "--version-name",
        "0.0.1",
        "--version-code",
        "261932120",
      ])
    ).toThrow(/--sha256/i);
  });

  it("accepts a schema-4 APK evidence set only when every immutable value matches", async () => {
    const { verifySchema4ReleaseArtifactContents } = await loadVerifierModule();

    expect(() =>
      verifySchema4ReleaseArtifactContents({
        bridgeHtml: "const currentBootstrapSchemaVersion = 4;",
        expectedSha256: "a".repeat(64),
        expectedVersionCode: "261932120",
        expectedVersionName: "0.0.1",
        sha256: "a".repeat(64),
        versionCode: "261932120",
        versionName: "0.0.1",
      })
    ).not.toThrow();
  });

  it("rejects schema 3, a non-integer schema value, and mismatched release identity", async () => {
    const { verifySchema4ReleaseArtifactContents } = await loadVerifierModule();
    const expectedEvidence = {
      expectedSha256: "a".repeat(64),
      expectedVersionCode: "261932120",
      expectedVersionName: "0.0.1",
      sha256: "a".repeat(64),
      versionCode: "261932120",
      versionName: "0.0.1",
    };

    expect(() =>
      verifySchema4ReleaseArtifactContents({
        ...expectedEvidence,
        bridgeHtml: "const currentBootstrapSchemaVersion = 3;",
      })
    ).toThrow(/integer schema 4/i);
    expect(() =>
      verifySchema4ReleaseArtifactContents({
        ...expectedEvidence,
        bridgeHtml: 'const currentBootstrapSchemaVersion = "4";',
      })
    ).toThrow(/integer schema 4/i);
    expect(() =>
      verifySchema4ReleaseArtifactContents({
        ...expectedEvidence,
        bridgeHtml: "const currentBootstrapSchemaVersion = 4;",
        versionCode: "261932121",
      })
    ).toThrow(/version code/i);
  });
});
