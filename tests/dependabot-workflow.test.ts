/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { expect, it } from "vitest";

it("grants the accepted callee its read ceiling with phase two and complete state reconciliation", () => {
  const workflow = load(
    readFileSync(".github/workflows/dependabot-auto-merge.yml", "utf8")
  ) as {
    on: { pull_request_target: { types: string[] } };
    concurrency: { "cancel-in-progress": boolean };
    permissions: Record<string, string>;
    jobs: Record<string, { uses: string; with: Record<string, string> }>;
  };
  expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
  for (const event of [
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
    "labeled",
    "unlabeled",
    "edited",
    "converted_to_draft",
  ]) {
    expect(workflow.on.pull_request_target.types).toContain(event);
  }
  expect(workflow.permissions).toEqual({
    contents: "write",
    "pull-requests": "write",
    checks: "read",
    statuses: "read",
  });
  expect(workflow.jobs["auto-merge"].with).toMatchObject({
    phase: "2",
    "allowed-ecosystems": "github_actions,npm_and_yarn",
    "merge-method": "squash",
  });
  expect(workflow.jobs["auto-merge"].uses).toBe(
    "SecPal/.github/.github/workflows/reusable-dependabot-auto-merge.yml@31555f23d459031248006f77785d872bc3947127"
  );
  expect(Object.values(workflow.jobs).every((job) => Boolean(job.uses))).toBe(
    true
  );
});
