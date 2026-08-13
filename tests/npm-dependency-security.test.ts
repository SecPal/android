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
  if?: unknown;
  needs?: unknown;
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

const blocksOnFailure = (value: unknown) =>
  value === undefined || value === false;

const readWorkflow = (workflowSource: string) =>
  load(workflowSource) as Workflow;

const hasBlockingHighSeverityAuditStep = (
  workflowSource: string,
  jobName: string
) => {
  const workflow = readWorkflow(workflowSource);
  const job = workflow.jobs?.[jobName];
  const steps = job?.steps;

  return (
    blocksOnFailure(job?.["continue-on-error"]) &&
    job?.if === undefined &&
    Array.isArray(steps) &&
    steps.some(
      (step) =>
        step.run === "npm audit --audit-level=high" &&
        step.if === undefined &&
        blocksOnFailure(step["continue-on-error"])
    )
  );
};

const jobNeeds = (
  workflowSource: string,
  jobName: string,
  dependency: string
) => {
  const needs = readWorkflow(workflowSource).jobs?.[jobName]?.needs;
  return (
    needs === dependency || (Array.isArray(needs) && needs.includes(dependency))
  );
};

describe("npm dependency security", () => {
  it("pins nanoid outside the vulnerable custom-generator range", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    ) as { overrides?: Record<string, string> };
    const packageLock = JSON.parse(
      readFileSync(resolve(repoRoot, "package-lock.json"), "utf8")
    ) as {
      packages?: Record<string, { version?: string }>;
    };

    expect(packageJson.overrides?.nanoid).toBe("3.3.18");
    expect(packageLock.packages?.["node_modules/nanoid"]?.version).toBe(
      "3.3.18"
    );
  });

  it("runs an unconditional audit before the required Vitest job", () => {
    const qualityWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/quality.yml"),
      "utf8"
    );

    expect(
      hasBlockingHighSeverityAuditStep(qualityWorkflow, "dependency-audit")
    ).toBe(true);
    expect(jobNeeds(qualityWorkflow, "vitest", "dependency-audit")).toBe(true);
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

  it("rejects a conditionally skipped audit job", () => {
    const workflow = [
      "jobs:",
      "  vitest:",
      "    if: ${{ false }}",
      "    steps:",
      "      - run: npm audit --audit-level=high",
    ].join("\n");

    expect(hasBlockingHighSeverityAuditStep(workflow, "vitest")).toBe(false);
  });
});
