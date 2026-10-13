// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openLiteralZipArchive } from "./literal-zip-archive.mjs";

const repository = "SecPal/android";
// Reviewed identities from the shared action at 226180bd610af77313057141dca23b7dce88a46c.
const policyIdentity =
  "sha256:90fe7d4a47b2818e1fea04689f2d84ab2e60132560111143d1adb843f827889e";
const configurationIdentity =
  "sha256:7600dd706c713b2be7b2ea050ac808ba825ee671788dd7f3f941558d6744c166";
const scannerIdentity =
  "sha256:2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a";
const policyExpiresAt = Date.parse("2026-10-18T00:00:00Z");
const failure =
  "Repository security acceptance failed. Require fresh CLEAN evidence for this exact source commit.";

function requireCondition(condition) {
  if (!condition) throw new Error(failure);
}

// This consumes the shared scanner's admission, without reclassifying findings.
// Fresh at scan time is insufficient once a release outlives its DB or exception.
export function verifyEvidence(result, commit, now = new Date()) {
  requireCondition(
    result?.schema_version === "secpal-trivy-repository-scan-v2" &&
      result.subject?.repository === repository &&
      result.subject?.commit === commit &&
      result.operation?.name === "TRIVY_REPOSITORY_SCAN" &&
      result.operation?.status === "SUCCEEDED" &&
      result.gate_state === "CLEAN" &&
      result.database?.status === "FRESH" &&
      Date.parse(result.completed_at) <= now.getTime() &&
      now.getTime() < Date.parse(result.database.next_update) &&
      now.getTime() < policyExpiresAt &&
      result.policy?.sha256 === policyIdentity &&
      result.scanner?.name === "trivy" &&
      result.scanner?.version === "0.74.0" &&
      result.scanner?.immutable_id === scannerIdentity &&
      result.scanner?.configuration_sha256 === configurationIdentity &&
      result.summary?.actionable === 0 &&
      result.summary?.review_required === 0 &&
      Array.isArray(result.findings) &&
      result.summary?.total === result.findings.length &&
      result.summary?.excepted === result.findings.length &&
      result.findings.every(
        (finding) => now.getTime() < Date.parse(finding.exception?.expires_at)
      )
  );
}

export async function verifyRepositorySecurity({
  repoRoot,
  execute = execFileSync,
  now = () => new Date(),
}) {
  const command = (binary, args, binaryOutput = false) =>
    execute(binary, args, {
      cwd: repoRoot,
      encoding: binaryOutput ? undefined : "utf8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const git = (...args) => command("git", args).trim();
  const api = (path, binary = false) => {
    const response = command(
      "gh",
      ["api", "--hostname", "github.com", `repos/${repository}/${path}`],
      binary
    );
    return binary ? response : JSON.parse(response);
  };
  const commit = git("rev-parse", "HEAD");
  requireCondition(/^[a-f0-9]{40}$/.test(commit));
  const requireCleanSource = () =>
    requireCondition(
      git("rev-parse", "HEAD") === commit &&
        git("status", "--porcelain", "--untracked-files=all") === ""
    );
  requireCleanSource();
  const runs = api(
    `actions/workflows/quality.yml/runs?head_sha=${commit}&event=push&branch=main&per_page=1`
  );
  const run = runs.workflow_runs?.[0];
  requireCondition(
    run?.head_sha === commit &&
      run.event === "push" &&
      run.head_branch === "main" &&
      run.head_repository?.full_name === repository &&
      run.path === ".github/workflows/quality.yml" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      Number.isSafeInteger(run.id) &&
      run.id > 0 &&
      Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt > 0
  );
  const jobs = api(
    `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
  );
  requireCondition(jobs.total_count <= 100 && Array.isArray(jobs.jobs));
  const scans = jobs.jobs.filter(
    (job) => job.name === "Repository Security / Scan repository"
  );
  requireCondition(
    scans.length === 1 &&
      scans[0].status === "completed" &&
      scans[0].conclusion === "success"
  );
  const artifacts = api(`actions/runs/${run.id}/artifacts?per_page=100`);
  requireCondition(
    artifacts.total_count <= 100 && Array.isArray(artifacts.artifacts)
  );
  const name = new RegExp(
    `^trivy-repository-evidence-${run.id}-${run.run_attempt}-[a-f0-9]{16}$`
  );
  const matches = artifacts.artifacts.filter((artifact) =>
    name.test(artifact.name)
  );
  requireCondition(
    matches.length === 1 &&
      matches[0].expired === false &&
      Number.isSafeInteger(matches[0].id) &&
      matches[0].id > 0
  );

  const directory = mkdtempSync(join(tmpdir(), "secpal-repository-security-"));
  try {
    const path = join(directory, "evidence.zip");
    writeFileSync(path, api(`actions/artifacts/${matches[0].id}/zip`, true), {
      mode: 0o600,
    });
    const archive = await openLiteralZipArchive(path);
    try {
      requireCondition(
        archive.entries.length === 1 && archive.entries[0] === "result.json"
      );
      verifyEvidence(
        JSON.parse((await archive.readEntry("result.json")).toString("utf8")),
        commit,
        now()
      );
    } finally {
      archive.close();
    }
    // Reject a new attempt or changed source while evidence was being fetched.
    const latest = api(`actions/runs/${run.id}`);
    requireCondition(
      latest.run_attempt === run.run_attempt &&
        latest.status === "completed" &&
        latest.conclusion === "success"
    );
    requireCleanSource();
    return { commit, runId: run.id, artifact: matches[0].name };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const accepted = await verifyRepositorySecurity({
      repoRoot: dirname(dirname(fileURLToPath(import.meta.url))),
    });
    console.log(
      `Repository security accepted: ${accepted.commit}; run ${accepted.runId}; artifact ${accepted.artifact}`
    );
  } catch {
    console.error(failure);
    process.exitCode = 1;
  }
}
