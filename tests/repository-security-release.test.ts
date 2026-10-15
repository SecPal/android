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
const { repositorySecurityPolicy, verifyEvidence, verifyRepositorySecurity } =
  await import(modulePath);
const subject = "a".repeat(40);
const hour = 60 * 60 * 1000;
const policyExpiry = Date.parse(repositorySecurityPolicy.expiresAt);
const now = new Date(policyExpiry - 2 * hour);
const completedAt = new Date(now.getTime() - hour).toISOString();
const nextUpdate = new Date(policyExpiry + hour).toISOString();
const differentDigest = (digest: string) =>
  digest.slice(0, -1) + (digest.endsWith("0") ? "1" : "0");
const evidence = () => ({
  schema_version: repositorySecurityPolicy.schemaVersion,
  subject: { repository: "SecPal/android", commit: subject },
  operation: { name: "TRIVY_REPOSITORY_SCAN", status: "SUCCEEDED" },
  gate_state: "CLEAN",
  completed_at: completedAt,
  database: { status: "FRESH", next_update: nextUpdate },
  policy: { sha256: repositorySecurityPolicy.sha256 },
  scanner: { ...repositorySecurityPolicy.scanner },
  summary: { total: 0, actionable: 0, review_required: 0, excepted: 0 },
  findings: [],
});

it("authenticates the current successful main attempt and its unique artifact, failing closed on missing or changed evidence", async () => {
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
  it("accepts fresh CLEAN evidence under the reviewed policy and rejects every untrusted or expired boundary", () => {
    expect(() => verifyEvidence(evidence(), subject, now)).not.toThrow();
    const bad = [
      undefined,
      {},
      { ...evidence(), schema_version: "unsupported-schema" },
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
        database: { status: "STALE", next_update: nextUpdate },
      },
      {
        ...evidence(),
        database: { status: "FRESH", next_update: now.toISOString() },
      },
      { ...evidence(), database: { status: "FRESH", next_update: "bad" } },
      {
        ...evidence(),
        completed_at: new Date(now.getTime() + hour).toISOString(),
      },
      {
        ...evidence(),
        policy: {
          sha256: differentDigest(repositorySecurityPolicy.sha256),
        },
      },
      ...Object.entries(repositorySecurityPolicy.scanner).map(
        ([key, value]) => ({
          ...evidence(),
          scanner: {
            ...evidence().scanner,
            [key]: (value as string).startsWith("sha256:")
              ? differentDigest(value as string)
              : `${value}-unreviewed`,
          },
        })
      ),
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
  });

  it("accepts unexpired exceptions and enforces exception and policy expiry independently with a fresh database", () => {
    const withException = {
      ...evidence(),
      summary: { total: 1, actionable: 0, review_required: 0, excepted: 1 },
      findings: [
        {
          exception: { expires_at: repositorySecurityPolicy.expiresAt },
        },
      ],
    };
    const beforeExpiry = new Date(policyExpiry - 1);
    expect(() =>
      verifyEvidence(withException, subject, beforeExpiry)
    ).not.toThrow();
    const expiredException = structuredClone(withException);
    expiredException.findings[0].exception.expires_at = now.toISOString();
    expect(() => verifyEvidence(expiredException, subject, now)).toThrow(
      "Repository security acceptance failed"
    );
    expect(() =>
      verifyEvidence(evidence(), subject, new Date(policyExpiry))
    ).toThrow("Repository security acceptance failed");
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
