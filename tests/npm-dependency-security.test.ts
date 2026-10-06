/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const { satisfies } = createRequire(import.meta.url)("semver") as {
  satisfies: (version: string, range: string) => boolean;
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasNanoidOverride = (
  overrides: Record<string, unknown> | undefined
): boolean =>
  Object.entries(overrides ?? {}).some(
    ([name, value]) =>
      name === "nanoid" ||
      name.startsWith("nanoid@") ||
      (isRecord(value) && hasNanoidOverride(value))
  );

const isPatchedNanoidVersion = (version: unknown) => {
  if (typeof version !== "string") {
    return false;
  }

  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    return false;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return (
    (major === 3 && (minor > 3 || (minor === 3 && patch >= 18))) ||
    major > 5 ||
    (major === 5 && (minor > 1 || (minor === 1 && patch >= 6)))
  );
};

describe("npm dependency security", () => {
  it("resolves every smol-toml instance outside the vulnerable range", () => {
    const packageLock = JSON.parse(
      readFileSync(resolve(repoRoot, "package-lock.json"), "utf8")
    ) as {
      packages?: Record<string, { version?: string }>;
    };
    const instances = Object.entries(packageLock.packages ?? {}).filter(
      ([path]) => /(?:^|\/)node_modules\/smol-toml$/.test(path)
    );

    expect(instances.length).toBeGreaterThan(0);
    for (const [path, { version }] of instances) {
      expect(satisfies(version ?? "", ">=1.9.0"), path).toBe(true);
    }
  });

  it("does not let inherited trust enable links in the Markdown math renderer", () => {
    const require = createRequire(resolve(repoRoot, "package.json"));
    const mathRequire = createRequire(
      require.resolve("micromark-extension-math")
    );
    const katexUrl = pathToFileURL(mathRequire.resolve("katex")).href;
    // Keep prototype pollution inside a separate process.
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import katex from ${JSON.stringify(katexUrl)};
Object.prototype.trust = true;
console.log(katex.renderToString(String.raw\`\\href{https://untrusted.secpal.dev}{unsafe}\`));`,
      ],
      { encoding: "utf8", timeout: 10_000 }
    );

    expect(output).toContain("katex");
    expect(output).not.toContain('href="https://untrusted.secpal.dev"');
  });

  it("lints Markdown math with TOML configuration through the installed CLI", () => {
    const directory = mkdtempSync(join(tmpdir(), "secpal-markdownlint-"));
    try {
      const config = join(directory, "config.toml");
      const markdown = join(directory, "math.md");
      writeFileSync(config, "default = false\nMD047 = true\n");
      writeFileSync(
        markdown,
        "# Math\n\nInline $x^2$ and display math:\n\n$$\nx^2\n$$\n"
      );
      const args = [
        resolve(repoRoot, "node_modules/markdownlint-cli/markdownlint.js"),
        "--config",
        config,
        markdown,
      ];
      expect(
        execFileSync(process.execPath, args, {
          encoding: "utf8",
          timeout: 10_000,
        })
      ).toBe("");
      writeFileSync(markdown, "# Missing final newline");
      expect(() =>
        execFileSync(process.execPath, args, {
          encoding: "utf8",
          stdio: "pipe",
          timeout: 10_000,
        })
      ).toThrow(/MD047/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves nanoid outside the vulnerable range without an override", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    ) as { overrides?: Record<string, unknown> };
    const packageLock = JSON.parse(
      readFileSync(resolve(repoRoot, "package-lock.json"), "utf8")
    ) as {
      packages?: Record<string, { version?: string }>;
    };

    expect(hasNanoidOverride(packageJson.overrides)).toBe(false);
    expect(
      isPatchedNanoidVersion(
        packageLock.packages?.["node_modules/nanoid"]?.version
      )
    ).toBe(true);
  });

  it.each(["3.3.19", "3.4.0", "5.1.6", "6.0.0"])(
    "accepts later patched nanoid release %s",
    (version) => {
      expect(isPatchedNanoidVersion(version)).toBe(true);
    }
  );

  it("finds nested nanoid overrides", () => {
    expect(
      hasNanoidOverride({
        postcss: {
          "nanoid@^3.3.16": "3.3.18",
        },
      })
    ).toBe(true);
  });

  it.each([
    "3.3.17",
    "3.2.99",
    "2.99.99",
    "4.0.0",
    "4.99.99",
    "5.1.5",
    "3.3.18-beta.1",
    undefined,
  ])("rejects vulnerable or non-release nanoid version %s", (version) => {
    expect(isPatchedNanoidVersion(version)).toBe(false);
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
