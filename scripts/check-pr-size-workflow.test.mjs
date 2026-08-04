#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guardPath = fileURLToPath(
  new URL("./check-pr-size-workflow.mjs", import.meta.url)
);
const validCaller =
  "SecPal/.github/.github/workflows/reusable-pr-size.yml@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("accepts the repository workflow", () => {
  const result = spawnSync(process.execPath, [guardPath], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
});

function runGuard(workflow) {
  const directory = mkdtempSync(join(tmpdir(), "check-pr-size-workflow-"));
  const workflowPath = join(directory, "pr-size.yml");
  writeFileSync(workflowPath, workflow);

  try {
    return spawnSync(process.execPath, [guardPath, workflowPath], {
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const pinnedCaller = `jobs:
  pr-size:
    uses: ${validCaller}
`;

test("accepts exactly the required read permission and pinned caller", () => {
  const result = runGuard(`permissions:\n  contents: read\n${pinnedCaller}`);

  assert.equal(result.status, 0, result.stderr);
});

test("accepts caller updates pinned to a full commit SHA", () => {
  const result = runGuard(`permissions:
  contents: read
jobs:
  pr-size:
    uses: SecPal/.github/.github/workflows/reusable-pr-size.yml@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
`);

  assert.equal(result.status, 0, result.stderr);
});

for (const [name, permissions] of [
  ["missing contents", ""],
  ["writable contents", "contents: write"],
  ["unused pull-request access", "contents: read\n  pull-requests: read"],
  ["an unexpected scope", "contents: read\n  issues: write"],
]) {
  test(`rejects ${name}`, () => {
    const workflow = `permissions:${permissions ? `\n  ${permissions.replaceAll("\n", "\n  ")}` : " {}"}\n${pinnedCaller}`;
    const result = runGuard(workflow);

    assert.notEqual(result.status, 0, result.stderr || result.stdout);
  });
}

test("rejects a PR-size job-level permission override", () => {
  const result = runGuard(`permissions:
  contents: read
jobs:
  pr-size:
    uses: ${validCaller}
    permissions:
      contents: write
`);

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
});

test("rejects a permission override in another job", () => {
  const result = runGuard(`permissions:
  contents: read
jobs:
  pr-size:
    uses: ${validCaller}
  unexpected-job:
    permissions:
      issues: write
`);

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
});

test("rejects an abbreviated reusable-workflow commit SHA", () => {
  const result = runGuard(`permissions:
  contents: read
jobs:
  pr-size:
    uses: SecPal/.github/.github/workflows/reusable-pr-size.yml@bc27f01
`);

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
});

test("rejects another reusable workflow pinned to a full commit SHA", () => {
  const result = runGuard(`permissions:
  contents: read
jobs:
  pr-size:
    uses: SecPal/.github/.github/workflows/reusable-reuse.yml@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`);

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
});

test("rejects a mutable reusable-workflow reference", () => {
  const result = runGuard(`permissions:
  contents: read
jobs:
  pr-size:
    uses: SecPal/.github/.github/workflows/reusable-pr-size.yml@main
`);

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
});

test("rejects malformed YAML", () => {
  const result = runGuard("permissions: [\n");

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /^Error: could not parse /);
});

test("reports non-file input URLs through the guard error path", () => {
  const workflowPath = "https://example.invalid/pr-size.yml";
  const result = spawnSync(process.execPath, [guardPath, workflowPath], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /^Error: could not parse /);
  assert.ok(result.stderr.includes(workflowPath), result.stderr);
});
