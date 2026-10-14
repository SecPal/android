/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
const modulePath = new URL(
  "../scripts/verify-repository-security.mjs",
  import.meta.url
).href;
const subject = "a".repeat(40);
const now = new Date("2026-10-14T10:00:00Z");
const evidence = (observedAt = now) => ({
  schema_version: "secpal-trivy-repository-scan-v2",
  subject: { repository: "SecPal/android", commit: subject },
  operation: { name: "TRIVY_REPOSITORY_SCAN", status: "SUCCEEDED" },
  gate_state: "CLEAN",
  completed_at: new Date(observedAt.getTime() - 60_000).toISOString(),
  database: {
    status: "FRESH",
    next_update: new Date(observedAt.getTime() + 3_600_000).toISOString(),
  },
  policy: {
    sha256:
      "sha256:90fe7d4a47b2818e1fea04689f2d84ab2e60132560111143d1adb843f827889e",
  },
  scanner: {
    name: "trivy",
    version: "0.74.0",
    immutable_id:
      "sha256:2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a",
    configuration_sha256:
      "sha256:7600dd706c713b2be7b2ea050ac808ba825ee671788dd7f3f941558d6744c166",
  },
  summary: { total: 0, actionable: 0, review_required: 0, excepted: 0 },
  findings: [],
});

it("authenticates the current successful main attempt and its unique artifact, failing closed on missing or changed evidence", async () => {
  const { verifyRepositorySecurity } = await import(modulePath);
  const root = mkdtempSync(join(tmpdir(), "release-evidence-test-"));
  try {
    writeFileSync(join(root, "result.json"), JSON.stringify(evidence()));
    execFileSync("zip", ["-q", "evidence.zip", "result.json"], { cwd: root });
    const archive = readFileSync(join(root, "evidence.zip"));
    const run = {
      id: 17,
      run_attempt: 2,
      head_sha: subject,
      event: "push",
      head_branch: "main",
      head_repository: { full_name: "SecPal/android" },
      path: ".github/workflows/quality.yml",
      status: "completed",
      conclusion: "success",
    };
    const job = {
      name: "Repository Security / Scan repository",
      status: "completed",
      conclusion: "success",
    };
    const artifact = {
      id: 42,
      name: "trivy-repository-evidence-17-2-abcdef0123456789",
      expired: false,
    };
    const runPath = `actions/workflows/quality.yml/runs?head_sha=${subject}&event=push&branch=main&per_page=1`;
    const defaults: Record<string, unknown> = {
      [runPath]: { workflow_runs: [run] },
      "actions/runs/17/attempts/2/jobs?per_page=100": {
        total_count: 1,
        jobs: [job],
      },
      "actions/runs/17/artifacts?per_page=100": {
        total_count: 1,
        artifacts: [artifact],
      },
      "actions/runs/17": run,
    };
    const execute =
      (overrides: Record<string, unknown> = {}, dirty = false) =>
      (binary: string, args: string[]) => {
        if (binary === "git")
          return args[0] === "rev-parse"
            ? subject
            : dirty
              ? " M source.js"
              : "";
        expect(binary).toBe("gh");
        expect(args.slice(0, 3)).toEqual(["api", "--hostname", "github.com"]);
        expect(args[3].startsWith("repos/SecPal/android/")).toBe(true);
        const path = args[3].slice("repos/SecPal/android/".length);
        if (path === "actions/artifacts/42/zip") return archive;
        const response = { ...defaults, ...overrides }[path];
        if (!response) throw new Error("Unexpected read request");
        return JSON.stringify(response);
      };
    const check = (overrides = {}, dirty = false) =>
      verifyRepositorySecurity({
        repoRoot: root,
        execute: execute(overrides, dirty),
        now: () => now,
      });
    await expect(check()).resolves.toEqual({
      commit: subject,
      runId: 17,
      artifact: artifact.name,
    });
    for (const overrides of [
      { [runPath]: { workflow_runs: [] } },
      { [runPath]: { workflow_runs: [{ ...run, conclusion: "failure" }] } },
      { [runPath]: { workflow_runs: [{ ...run, event: "pull_request" }] } },
      { [runPath]: { workflow_runs: [{ ...run, head_sha: "b".repeat(40) }] } },
      {
        "actions/runs/17/attempts/2/jobs?per_page=100": {
          total_count: 1,
          jobs: [{ ...job, conclusion: "skipped" }],
        },
      },
      {
        "actions/runs/17/artifacts?per_page=100": {
          total_count: 0,
          artifacts: [],
        },
      },
      {
        "actions/runs/17/artifacts?per_page=100": {
          total_count: 2,
          artifacts: [artifact, artifact],
        },
      },
      {
        "actions/runs/17/artifacts?per_page=100": {
          total_count: 1,
          artifacts: [{ ...artifact, expired: true }],
        },
      },
      ...[[], [{ ...job, conclusion: "failure" }]].map((jobs) => ({
        "actions/runs/17/attempts/2/jobs?per_page=100": {
          total_count: jobs.length,
          jobs,
        },
      })),
      ...[
        "trivy-repository-evidence-18-2-abcdef0123456789",
        "trivy-repository-evidence-17-1-abcdef0123456789",
      ].map((name) => ({
        "actions/runs/17/artifacts?per_page=100": {
          total_count: 1,
          artifacts: [{ ...artifact, name }],
        },
      })),
      { "actions/runs/17": { ...run, run_attempt: 3 } },
    ])
      await expect(check(overrides)).rejects.toThrow();
    await expect(check({}, true)).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("stops Fastlane before signing, credential lookup or a remote publication lock when acceptance fails", () => {
  const ruby = `
def default_platform(*) = nil
def desc(*) = nil
def platform(*) = yield
def lane(*) = nil
load ARGV.fetch(0)
def sh(*args)
  raise "unexpected authority" unless args == ["node", File.join(REPO_ROOT, "scripts/verify-repository-security.mjs")]
  raise "security rejected"
end
[
  -> { run_signed_gradle("assembleRelease") },
  -> { with_selected_publish_version_code(lane: "deploy_internal") { raise "published" } },
  -> { with_direct_release_lock { raise "published" } }
].each do |boundary|
  begin
    boundary.call
    abort "boundary passed"
  rescue => error
    raise unless error.message == "security rejected"
  end
end
`;
  const result = spawnSync("ruby", ["-e", ruby, resolve("fastlane/Fastfile")], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
});

describe("exact release source security evidence", () => {
  it("accepts a fresh CLEAN v2 result and rejects every untrusted or expired boundary", async () => {
    const { verifyEvidence } = await import(modulePath);
    expect(() => verifyEvidence(evidence(), subject, now)).not.toThrow();
    const bad = [
      undefined,
      {},
      { ...evidence(), schema_version: "secpal-trivy-repository-scan-v1" },
      ...[
        "",
        "ACTIONABLE",
        "REVIEW_REQUIRED",
        "UNKNOWN_STALE",
        "clean",
        null,
      ].map((gate_state) => ({ ...evidence(), gate_state })),
      {
        ...evidence(),
        subject: { repository: "SecPal/frontend", commit: subject },
      },
      {
        ...evidence(),
        subject: { repository: "SecPal/android", commit: "b".repeat(40) },
      },
      {
        ...evidence(),
        operation: { name: "TRIVY_REPOSITORY_SCAN", status: "FAILED" },
      },
      {
        ...evidence(),
        database: { status: "STALE", next_update: "2026-10-15T00:00:00Z" },
      },
      {
        ...evidence(),
        database: { status: "FRESH", next_update: now.toISOString() },
      },
      { ...evidence(), database: undefined },
      { ...evidence(), database: { status: "FRESH", next_update: "bad" } },
      { ...evidence(), completed_at: "2026-10-15T00:00:00Z" },
      { ...evidence(), policy: { sha256: "sha256:" + "0".repeat(64) } },
      { ...evidence(), scanner: {} },
      {
        ...evidence(),
        summary: { total: 1, actionable: 1, review_required: 0, excepted: 0 },
      },
      {
        ...evidence(),
        summary: { total: 1, actionable: 0, review_required: 0, excepted: 1 },
        findings: [{ exception: { expires_at: now.toISOString() } }],
      },
    ];
    for (const value of bad)
      expect(() => verifyEvidence(value, subject, now)).toThrow(
        "Repository security acceptance failed"
      );
    const beforeExpiry = new Date("2026-10-17T23:59:59.999Z");
    expect(() =>
      verifyEvidence(evidence(beforeExpiry), subject, beforeExpiry)
    ).not.toThrow();
    const expiry = new Date("2026-10-18T00:00:00Z");
    expect(() => verifyEvidence(evidence(expiry), subject, expiry)).toThrow();
  });
});

it("checks repository security before signed Gradle and either publisher can exercise authority", () => {
  const fastfile = readFileSync("fastlane/Fastfile", "utf8");
  for (const method of [
    "run_signed_gradle(task)",
    "with_selected_publish_version_code(lane:)",
    "with_direct_release_lock",
  ]) {
    expect(fastfile).toContain(`def ${method}\n  require_repository_security!`);
  }
  const wrapper = readFileSync(
    "scripts/require-android-build-version-code.rb",
    "utf8"
  );
  expect(wrapper).toContain('"verify-repository-security.mjs"');
  expect(wrapper.indexOf('"verify-repository-security.mjs"')).toBeLessThan(
    wrapper.indexOf("exec(*ARGV)")
  );
});
