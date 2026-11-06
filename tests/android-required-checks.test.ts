// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { createRequire } from "node:module";

describe("required Android conditional checks", () => {
  for (const [file, child] of [
    ["android-smoke.yml", "smoke"],
    ["android-enterprise-policy.yml", "device-owner-policy"],
  ]) {
    const workflow = parse(readFileSync(`.github/workflows/${file}`, "utf8"));
    it(`${file} is available on every PR and gates its actual child`, () => {
      expect(workflow.on.pull_request.paths).toBeUndefined();
      const gate = workflow.jobs.acceptance;
      expect(gate.if).toBe("${{ always() }}");
      expect(gate.needs).toEqual(["scope", child]);
      expect(
        JSON.parse(workflow.jobs.scope.steps[0].env.RELEVANT_PATHS)
      ).toEqual(workflow.on.push.paths);
      for (const [scope, relevant, childResult, success] of [
        ["success", "true", "success", true],
        ["success", "false", "skipped", true],
        ["failure", "false", "skipped", false],
        ["success", "unknown", "success", false],
        ...["failure", "cancelled", "skipped", "", "neutral"].map((result) => [
          "success",
          "true",
          result,
          false,
        ]),
        ["success", "false", "failure", false],
      ]) {
        const result = spawnSync(
          "bash",
          ["-euo", "pipefail", "-c", gate.steps[0].run],
          {
            env: {
              SCOPE_RESULT: String(scope),
              RELEVANT: String(relevant),
              CHILD_RESULT: String(childResult),
            },
          }
        );
        expect(
          result.status === 0,
          `${file}: ${scope}/${relevant}/${childResult}`
        ).toBe(success);
      }
    });
  }
});

describe("native applicability uses the full GitHub diff", () => {
  for (const file of ["android-smoke.yml", "android-enterprise-policy.yml"]) {
    const workflow = parse(readFileSync(`.github/workflows/${file}`, "utf8"));
    const step = workflow.jobs.scope.steps[0];
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;
    it(`${file} includes hidden Android inputs and rename sources`, async () => {
      process.env.RELEVANT_PATHS = step.env.RELEVANT_PATHS;
      const pr = { head: { sha: "a" }, base: { sha: "b" }, changed_files: 1 };
      for (const files of [
        [{ filename: "android/.native-policy" }],
        [
          {
            filename: "README.md",
            previous_filename: "android/app/build.gradle",
          },
        ],
      ]) {
        const github = {
          rest: {
            pulls: { get: async () => ({ data: pr }), listFiles: "files" },
          },
          paginate: async () => files,
        };
        const result = await new AsyncFunction(
          "github",
          "context",
          "require",
          step.with.script
        )(
          github,
          {
            eventName: "pull_request",
            repo: { owner: "SecPal", repo: "android" },
            payload: { pull_request: { number: 1, head: { sha: "a" } } },
          },
          createRequire(import.meta.url)
        );
        expect(result).toBe("true");
      }
      delete process.env.RELEVANT_PATHS;
    });
  }
});
