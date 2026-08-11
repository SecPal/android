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
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  "runs-on"?: string;
  steps?: WorkflowStep[];
  "timeout-minutes"?: number;
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

describe("Android quality workflow", () => {
  it("runs bounded lint for every supported app variant and uploads failure reports", () => {
    const workflow = load(
      readFileSync(resolve(repoRoot, ".github/workflows/quality.yml"), "utf8")
    ) as Workflow;
    const lintJob = workflow.jobs?.["android-lint"];
    const steps = lintJob?.steps ?? [];
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(lintJob?.["runs-on"]).toBe("ubuntu-latest");
    expect(lintJob?.["timeout-minutes"]).toBeGreaterThan(0);
    expect(lintJob?.["timeout-minutes"]).toBeLessThanOrEqual(30);
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
      })
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/),
        with: { "node-version": "22", cache: "npm" },
      })
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: expect.stringMatching(/^actions\/setup-java@[0-9a-f]{40}$/),
        with: {
          distribution: "temurin",
          "java-version": "21",
          cache: "gradle",
        },
      })
    );
    expect(steps).toContainEqual(expect.objectContaining({ run: "npm ci" }));
    expect(steps).toContainEqual(
      expect.objectContaining({
        id: "android_lint",
        run: "npm run native:lint",
      })
    );
    expect(packageJson.scripts["native:lint"]).toBe(
      "bash ./scripts/with-android-env.sh ./android/gradlew --no-daemon --continue -p android :app:lintDebug :app:lintRelease :app:lintCtRegression :app:lintStoreListing"
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        if: "${{ failure() && steps.android_lint.outcome == 'failure' }}",
        uses: expect.stringMatching(/^actions\/upload-artifact@[0-9a-f]{40}$/),
        with: {
          name: "android-lint-reports",
          path: "android/app/build/reports/lint-results-*",
          "if-no-files-found": "error",
          "retention-days": 7,
        },
      })
    );
  });

  it("runs the debug JVM unit tests and uploads reports only on failure", () => {
    const workflow = load(
      readFileSync(resolve(repoRoot, ".github/workflows/quality.yml"), "utf8")
    ) as Workflow;
    const unitTestJob = workflow.jobs?.["android-jvm-unit-tests"];
    const steps = unitTestJob?.steps ?? [];
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(unitTestJob?.["runs-on"]).toBe("ubuntu-latest");
    expect(unitTestJob?.["timeout-minutes"]).toBeGreaterThan(0);
    expect(unitTestJob?.["timeout-minutes"]).toBeLessThanOrEqual(30);
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
      })
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/),
        with: { "node-version": "22", cache: "npm" },
      })
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: expect.stringMatching(/^actions\/setup-java@[0-9a-f]{40}$/),
        with: {
          distribution: "temurin",
          "java-version": "21",
          cache: "gradle",
        },
      })
    );
    expect(steps).toContainEqual(expect.objectContaining({ run: "npm ci" }));
    expect(steps).toContainEqual(
      expect.objectContaining({
        id: "android_jvm_unit_tests",
        run: "npm run native:test:unit",
      })
    );
    expect(packageJson.scripts["native:test:unit"]).toBe(
      "bash ./scripts/with-android-env.sh ./android/gradlew --no-daemon -p android :app:testDebugUnitTest"
    );
    const reportUpload = steps.find((step) =>
      step.uses?.startsWith("actions/upload-artifact@")
    );
    expect(reportUpload).toEqual(
      expect.objectContaining({
        if: "${{ failure() && steps.android_jvm_unit_tests.outcome == 'failure' }}",
        uses: expect.stringMatching(/^actions\/upload-artifact@[0-9a-f]{40}$/),
        with: expect.objectContaining({
          name: "android-jvm-unit-test-reports",
          "if-no-files-found": "warn",
          "retention-days": 7,
        }),
      })
    );
    expect(String(reportUpload?.with?.path).trim().split("\n")).toEqual(
      expect.arrayContaining([
        "android/app/build/reports/tests/testDebugUnitTest",
        "android/app/build/test-results/testDebugUnitTest",
      ])
    );
  });
});
