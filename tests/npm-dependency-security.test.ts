/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

type WorkflowStep = {
  "continue-on-error"?: unknown;
  if?: unknown;
  run?: unknown;
};

type WorkflowJob = {
  "continue-on-error"?: unknown;
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

const blocksOnFailure = (value: unknown) =>
  value === undefined || value === false;

const hasBlockingHighSeverityAuditStep = (
  workflowSource: string,
  jobName: string
) => {
  const workflow = load(workflowSource) as Workflow;
  const job = workflow.jobs?.[jobName];
  const steps = job?.steps;

  return (
    blocksOnFailure(job?.["continue-on-error"]) &&
    Array.isArray(steps) &&
    steps.some(
      (step) =>
        step.run === "npm audit --audit-level=high" &&
        step.if === undefined &&
        blocksOnFailure(step["continue-on-error"])
    )
  );
};

describe("npm dependency security", () => {
  it("runs a blocking high-severity audit step in the required Vitest job", () => {
    const qualityWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/quality.yml"),
      "utf8"
    );

    expect(hasBlockingHighSeverityAuditStep(qualityWorkflow, "vitest")).toBe(
      true
    );
  });

  it("rejects a commented-out audit command", () => {
    const workflow = [
      "jobs:",
      "  vitest:",
      "    steps:",
      "      # run: npm audit --audit-level=high",
    ].join("\n");

    expect(hasBlockingHighSeverityAuditStep(workflow, "vitest")).toBe(false);
  });

  it("rejects an audit command outside the workflow steps", () => {
    const workflow = [
      "jobs:",
      "  vitest:",
      "    env:",
      "      run: npm audit --audit-level=high",
      "    steps:",
      "      - run: npm run test:coverage",
    ].join("\n");

    expect(hasBlockingHighSeverityAuditStep(workflow, "vitest")).toBe(false);
  });

  it.each([
    ["conditional", "        if: ${{ false }}"],
    ["non-blocking", "        continue-on-error: true"],
  ])("rejects a %s audit step", (_description, stepOption) => {
    const workflow = [
      "jobs:",
      "  vitest:",
      "    steps:",
      "      - run: npm audit --audit-level=high",
      stepOption,
    ].join("\n");

    expect(hasBlockingHighSeverityAuditStep(workflow, "vitest")).toBe(false);
  });

  it("accepts an explicitly blocking audit step", () => {
    const workflow = [
      "jobs:",
      "  vitest:",
      "    steps:",
      "      - run: npm audit --audit-level=high",
      "        continue-on-error: false",
    ].join("\n");

    expect(hasBlockingHighSeverityAuditStep(workflow, "vitest")).toBe(true);
  });

  it("rejects an audit job that can fail without failing the workflow", () => {
    const workflow = [
      "jobs:",
      "  vitest:",
      "    continue-on-error: true",
      "    steps:",
      "      - run: npm audit --audit-level=high",
    ].join("\n");

    expect(hasBlockingHighSeverityAuditStep(workflow, "vitest")).toBe(false);
  });
});
