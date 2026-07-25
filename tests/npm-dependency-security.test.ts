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
  const normalizedWorkflow = workflow.replaceAll("\r\n", "\n");
  const jobHeader = `  ${jobName}:\n`;
  const jobStart = normalizedWorkflow.indexOf(jobHeader);
  expect(jobStart, `Expected workflow job ${jobName}`).toBeGreaterThanOrEqual(
    0
  );

  const followingJobs = normalizedWorkflow.slice(jobStart + jobHeader.length);
  const nextJobOffset = followingJobs.search(
    /^ {2}[A-Za-z_][A-Za-z0-9_-]*:\n/m
  );

  return nextJobOffset === -1
    ? followingJobs
    : followingJobs.slice(0, nextJobOffset);
};

const hasHighSeverityAuditStep = (workflowJob: string) =>
  workflowJob
    .split("\n")
    .some((line) =>
      /^\s+(?:-\s+)?run:\s*npm audit --audit-level=high\s*$/.test(line)
    );

describe("npm dependency security", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])(
    "isolates a workflow job with %s endings and valid neighboring job IDs",
    (_lineEnding, lineEnding) => {
      const workflow = [
        "jobs:",
        "  vitest:",
        "    steps:",
        "      - run: npm audit --audit-level=high",
        "  _NextJob:",
        "    steps:",
        "      - run: exit 1",
      ].join(lineEnding);

      const vitestJob = readWorkflowJob(workflow, "vitest");

      expect(vitestJob).toContain("run: npm audit --audit-level=high");
      expect(vitestJob).not.toContain("run: exit 1");
    }
  );

  it("runs the high-severity audit inside the required Vitest job", () => {
    const qualityWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/quality.yml"),
      "utf8"
    );

    expect(
      hasHighSeverityAuditStep(readWorkflowJob(qualityWorkflow, "vitest"))
    ).toBe(true);
  });

  it("rejects a commented-out audit command", () => {
    const workflow = [
      "jobs:",
      "  vitest:",
      "    steps:",
      "      # run: npm audit --audit-level=high",
    ].join("\n");

    expect(hasHighSeverityAuditStep(readWorkflowJob(workflow, "vitest"))).toBe(
      false
    );
  });
});
