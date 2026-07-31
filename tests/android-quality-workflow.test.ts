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
      expect.objectContaining({ uses: "actions/checkout@v7" })
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: "actions/setup-node@v7",
        with: { "node-version": "22", cache: "npm" },
      })
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: "actions/setup-java@v5",
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
      "bash ./scripts/with-android-env.sh bash -lc 'cd android && ./gradlew --no-daemon :app:lintDebug :app:lintRelease :app:lintCtRegression :app:lintStoreListing'"
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        if: "${{ failure() && steps.android_lint.outcome == 'failure' }}",
        uses: "actions/upload-artifact@v7",
        with: {
          name: "android-lint-reports",
          path: "android/app/build/reports/lint-results-*",
          "if-no-files-found": "error",
          "retention-days": 7,
        },
      })
    );
  });
});
