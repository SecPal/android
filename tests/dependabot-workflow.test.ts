/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { expect, it } from "vitest";

it("grants the accepted callee its read ceiling while keeping Android patch-only", () => {
  const workflow = load(
    readFileSync(".github/workflows/dependabot-auto-merge.yml", "utf8")
  ) as {
    permissions: Record<string, string>;
    jobs: Record<string, { uses: string; with: Record<string, string> }>;
  };
  expect(workflow.permissions).toEqual({
    contents: "write",
    "pull-requests": "write",
    checks: "read",
    statuses: "read",
  });
  expect(workflow.jobs["auto-merge"].with).toMatchObject({
    phase: "1",
    "merge-method": "squash",
  });
  expect(workflow.jobs["auto-merge"].uses).toBe(
    "SecPal/.github/.github/workflows/reusable-dependabot-auto-merge.yml@aa28f9b2c11645e8cc2f12755ff31ae21c1bfaff"
  );
  expect(Object.values(workflow.jobs).every((job) => Boolean(job.uses))).toBe(
    true
  );
});
