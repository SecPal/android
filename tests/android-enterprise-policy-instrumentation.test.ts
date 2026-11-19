/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

describe("Android enterprise policy instrumentation contract", () => {
  const dpcCertificate = "enterprise-test-certificate";
  const dpcDigest = createHash("sha256").update(dpcCertificate).digest("hex");
  const workDigest = "ab".repeat(32);

  it.each([
    { name: "valid distinct test certificates", digest: workDigest, status: 0 },
    {
      name: "failed DPC export",
      digest: workDigest,
      dpcStatus: 23,
      status: 23,
    },
    {
      name: "failed Work extraction with valid output",
      digest: workDigest,
      workStatus: 29,
      status: 29,
    },
    {
      name: "missing Work report",
      digest: workDigest,
      missingReport: true,
      status: 2,
    },
    { name: "missing ctRegression identity", digest: "", status: 1 },
    { name: "short Work digest", digest: "ab".repeat(31), status: 1 },
    { name: "long Work digest", digest: "ab".repeat(33), status: 1 },
    { name: "non-hexadecimal Work digest", digest: "gh".repeat(32), status: 1 },
    { name: "identical signing identities", digest: dpcDigest, status: 1 },
  ])("preserves signing-input status: $name", (scenario) => {
    const workflow = parse(
      readRepoFile(".github", "workflows", "android-enterprise-policy.yml")
    ) as {
      jobs: Record<
        string,
        { steps: { name: string; run?: string; shell?: string }[] }
      >;
    };
    const step = workflow.jobs["device-owner-policy"].steps.find(
      ({ name }) =>
        name === "Verify independent DPC and Work management boundary"
    )!;
    const run = step.run!;
    const start = run.indexOf("# Test certificates");
    const validation =
      'test "$SECPAL_DPC_CERT_SHA256" != "$SECPAL_WORK_CERT_SHA256"';
    expect(start).toBeGreaterThanOrEqual(0);
    expect(run).toContain(validation);
    const signingScript = run.slice(
      start,
      run.indexOf(validation) + validation.length
    );
    const directory = mkdtempSync(resolve(tmpdir(), "secpal-signing-status-"));
    const reportName = "work-signing-report.txt";
    const report = resolve(directory, reportName);
    const startup = resolve(directory, "shell-startup.sh");
    const startupMarker = resolve(directory, "startup-executed");

    try {
      writeFileSync(
        startup,
        'touch "${BASH_SOURCE[0]%/*}/startup-executed"; exit 71\n'
      );
      vi.stubEnv("BASH_ENV", startup);
      vi.stubEnv("ENV", startup);
      vi.stubEnv("SHELLOPTS", "xtrace:nounset");
      vi.stubEnv("BASHOPTS", "failglob");
      if (!scenario.missingReport) {
        writeFileSync(
          report,
          [
            "Variant: debug",
            `SHA-256: ${"cd".repeat(32)}`,
            "Variant: ctRegression",
            `SHA-256: ${
              scenario.digest
                .toUpperCase()
                .match(/.{1,2}/g)
                ?.join(":") ?? ""
            }`,
            "Variant: release",
            `SHA-256: ${"ef".repeat(32)}`,
          ].join("\n")
        );
      }
      // Exercise the workflow's real Bash pipeline and awk parser. Inject command
      // failures after valid output so subsequent validation cannot mask status loss.
      const script = `
keytool() { printf '%s' '${dpcCertificate}'; return ${scenario.dpcStatus ?? 0}; }
awk() { command awk "$@" || return "$?"; return ${scenario.workStatus ?? 0}; }
work_signing_report="$1"
${signingScript}
env | grep '^SECPAL_.*_CERT_SHA256='
`;
      const shellArguments =
        step.shell === "bash"
          ? ["--noprofile", "--norc", "-e", "-o", "pipefail"]
          : ["-e"];
      const result = spawnSync(
        "/bin/bash",
        [...shellArguments, "-c", script, "signing-status", reportName],
        {
          encoding: "utf8",
          // Keep the environment-derived temporary path out of shell arguments.
          // The report argument stays relative to this isolated fixture directory.
          cwd: directory,
          // The shell needs only these tools and a deterministic locale. Do not
          // inherit startup files, shell options, exported functions or fixtures.
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
        }
      );
      expect(result.error).toBeUndefined();
      expect(existsSync(startupMarker)).toBe(false);
      expect(result.status, result.stderr).toBe(scenario.status);
      if (scenario.status === 0) {
        expect(result.stdout.split("\n")).toEqual(
          expect.arrayContaining([
            `SECPAL_DPC_CERT_SHA256=${dpcDigest}`,
            `SECPAL_WORK_CERT_SHA256=${workDigest}`,
          ])
        );
      } else {
        expect(result.stdout).not.toContain("SECPAL_");
      }
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("proves managed install restrictions through the platform device-owner API", () => {
    const instrumentedTest = readRepoFile(
      "android",
      "dpc",
      "src",
      "androidTest",
      "java",
      "app",
      "secpal",
      "EnterprisePolicyInstrumentedTest.java"
    );
    const workflow = readRepoFile(
      ".github",
      "workflows",
      "android-enterprise-policy.yml"
    );
    const devicePolicyWaitScript = readRepoFile(
      "scripts",
      "wait-for-device-policy-account-scan.sh"
    );
    const devicePolicyWaitCommand =
      "bash ./scripts/wait-for-device-policy-account-scan.sh emulator-5570 60";

    expect(instrumentedTest).toContain("isDeviceOwnerApp");
    expect(instrumentedTest).toContain(
      "DpcPolicyEnforcer.setKioskUserRestrictions"
    );
    expect(instrumentedTest).toContain("UserManager.DISALLOW_INSTALL_APPS");
    expect(instrumentedTest).toContain("assertTrue");
    expect(instrumentedTest).toContain("assertFalse");

    expect(workflow).toContain(":app:signingReport");
    expect(workflow).toContain("Variant: ctRegression");
    expect(workflow).not.toContain("$HOME/.android/debug.keystore");
    expect(workflow).toContain(":dpc:assembleCtRegressionAndroidTest");
    expect(workflow).toContain(":app:assembleCtRegressionAndroidTest");
    expect(workflow).toContain("dpm set-profile-owner");
    expect(workflow).toContain("EnterpriseManagementInstrumentedTest");
    expect(workflow).toContain(
      'test "$SECPAL_DPC_CERT_SHA256" != "$SECPAL_WORK_CERT_SHA256"'
    );
    expect(workflow.match(/android\/build\.gradle/g)).toHaveLength(2);
    expect(workflow.match(/android\/settings\.gradle/g)).toHaveLength(2);
    expect(workflow).not.toContain("use_unsafe_pre22_gencode");
    expect(workflow).toContain(
      'image="system-images;android-35;default;x86_64"'
    );
    expect(workflow).not.toContain(
      "system-images;android-35;google_apis;x86_64"
    );
    expect(workflow).toContain("dpc-ctRegression.apk");
    expect(workflow).toContain("dpc-ctRegression-androidTest.apk");
    expect(workflow.match(/adb -s emulator-5570 install -t -r/g)).toHaveLength(
      4
    );
    expect(workflow).toContain(devicePolicyWaitCommand);
    expect(workflow.indexOf(devicePolicyWaitCommand)).toBeLessThan(
      workflow.indexOf("dpm set-device-owner")
    );
    expect(workflow).toContain("dpm set-device-owner");
    expect(workflow).toContain("app.secpal.EnterprisePolicyInstrumentedTest");
    expect(workflow).toContain("dpm remove-active-admin");
    expect(devicePolicyWaitScript).toContain(
      "Finished calculating hasIncompatibleAccountsTask"
    );
    expect(devicePolicyWaitScript).toContain("dumpsys account");
  });
});
