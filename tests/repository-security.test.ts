/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type Step = {
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  id?: string;
};
type Job = {
  name?: string;
  uses?: string;
  needs?: string[];
  if?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
  "runs-on"?: string;
  "timeout-minutes"?: number;
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const read = (path: string) => load(readFileSync(path, "utf8")) as Workflow;
const pin = "226180bd610af77313057141dca23b7dce88a46c";

describe("repository security acceptance", () => {
  it("runs the exact shared action once for PRs and main pushes with read-only authority", () => {
    const quality = read(".github/workflows/quality.yml");
    expect(quality.on).toEqual({
      push: { branches: ["main"] },
      pull_request: { branches: ["main"] },
    });
    expect(quality.jobs["repository-security"]).toEqual({
      name: "Repository Security",
      uses: "./.github/workflows/reusable-repository-security.yml",
      permissions: { contents: "read" },
    });
    const security = read(".github/workflows/reusable-repository-security.yml");
    expect(security.on).toEqual({ workflow_call: null });
    expect(security.permissions).toEqual({ contents: "read" });
    expect(Object.keys(security.jobs)).toEqual(["scan"]);
    const job = security.jobs.scan;
    expect(Object.keys(job).sort()).toEqual([
      "name",
      "runs-on",
      "steps",
      "timeout-minutes",
    ]);
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job["timeout-minutes"]).toBe(20);
    expect(job.steps).toHaveLength(3);
    expect(job.steps?.[0]).toEqual({
      name: "Checkout exact source",
      uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      with: { ref: "${{ github.sha }}", "persist-credentials": false },
    });
    expect(job.steps?.[1]).toEqual({
      name: "Scan exact source",
      id: "repository-scan",
      uses: `SecPal/.github/.github/actions/trivy-repository-scan@${pin}`,
    });
    const source = readFileSync(
      ".github/workflows/reusable-repository-security.yml",
      "utf8"
    );
    expect(source).not.toMatch(
      /continue-on-error|secrets:|secrets\.|SECPAL_ANDROID_|TRIVY_|needs:|environment:/
    );
  });

  it.each([
    "CLEAN",
    "ACTIONABLE",
    "REVIEW_REQUIRED",
    "UNKNOWN_STALE",
    "",
    "UNKNOWN",
    " CLEAN",
    "CLEAN\n",
    '{"gate_state":"CLEAN"}',
  ])("admits only the exact CLEAN output (%j)", (gate) => {
    const job = read(".github/workflows/reusable-repository-security.yml").jobs
      .scan;
    const step = job.steps?.[2];
    expect(step?.env).toEqual({
      GATE_STATE: "${{ steps.repository-scan.outputs.gate-state }}",
    });
    const result = spawnSync(
      "bash",
      ["-e", "-u", "-o", "pipefail", "-c", step?.run ?? ""],
      { env: { PATH: process.env.PATH, GATE_STATE: gate }, encoding: "utf8" }
    );
    expect(result.status).toBe(gate === "CLEAN" ? 0 : 1);
    expect(result.stdout + result.stderr).not.toContain(
      gate === "CLEAN" ? "{secret}" : `state: ${gate}`
    );
  });

  it("fails an existing required check even when its security prerequisite was skipped", () => {
    const job = read(".github/workflows/quality.yml").jobs.vitest;
    expect(job.needs).toEqual(["dependency-audit", "repository-security"]);
    expect(job.if).toBe("${{ always() }}");
    const gate = job.steps?.[0];
    expect(gate?.env).toEqual({
      SECURITY_RESULT: "${{ needs.repository-security.result }}",
      AUDIT_RESULT: "${{ needs.dependency-audit.result }}",
    });
    for (const security of ["success", "failure", "cancelled", "skipped", ""]) {
      const result = spawnSync("bash", ["-e", "-c", gate?.run ?? ""], {
        env: {
          PATH: process.env.PATH,
          SECURITY_RESULT: security,
          AUDIT_RESULT: "success",
        },
      });
      expect(result.status).toBe(security === "success" ? 0 : 1);
    }
  });
});
