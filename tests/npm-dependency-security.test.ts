/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const readWorkflowJob = (workflow: string, jobName: string) => {
  const jobHeader = `  ${jobName}:\n`;
  const jobStart = workflow.indexOf(jobHeader);
  expect(jobStart, `Expected workflow job ${jobName}`).toBeGreaterThanOrEqual(
    0
  );

  const followingJobs = workflow.slice(jobStart + jobHeader.length);
  const nextJobOffset = followingJobs.search(/^ {2}[a-z0-9-]+:\n/m);

  return nextJobOffset === -1
    ? followingJobs
    : followingJobs.slice(0, nextJobOffset);
};

describe("npm dependency security", () => {
  it("runs the high-severity audit inside the required Vitest job", () => {
    const qualityWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/quality.yml"),
      "utf8"
    );

    expect(readWorkflowJob(qualityWorkflow, "vitest")).toContain(
      "run: npm audit --audit-level=high"
    );
  });
});
