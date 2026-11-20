/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = resolve(import.meta.dirname, "..");
const workflowPath = resolve(repoRoot, ".github/workflows/android-smoke.yml");
const workflowSource = readFileSync(workflowPath, "utf8");
const emulatorHelperSource = readFileSync(
  resolve(repoRoot, "scripts/start-android-emulator.sh"),
  "utf8"
);
type WorkflowStep = {
  id?: string;
  name?: string;
  env?: Record<string, string>;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};
type SmokeJob = {
  name: string;
  if?: string;
  environment?: string;
  env: Record<string, string>;
  steps: WorkflowStep[];
};
type SmokeWorkflow = {
  name: string;
  on: {
    pull_request: { branches: string[]; paths: string[] };
    push: { branches: string[]; paths: string[] };
    schedule: Array<{ cron: string }>;
    workflow_dispatch: Record<string, unknown>;
  };
  concurrency: Record<string, unknown>;
  jobs: { smoke: SmokeJob; "pull-request"?: SmokeJob };
};
const workflow = parse(workflowSource) as SmokeWorkflow;

describe("Android smoke workflow", () => {
  it("uses an isolated credential-free runner for every applicable pull request", () => {
    const pullRequest = workflow.jobs["pull-request"];
    expect(pullRequest?.if).toBe("github.event_name == 'pull_request'");
    expect(pullRequest?.environment).toBeUndefined();
    expect(JSON.stringify(pullRequest ?? {})).not.toMatch(
      /secrets\.|SECPAL_TEST_(?:EMAIL|PASSWORD)|developmentFixturePassword|SECPAL_RUNTIME_URL|\/health\/ready/
    );
    const steps = pullRequest?.steps ?? [];
    for (const name of [
      "Build debug APK from pinned frontend",
      "Verify generated native-auth route parity",
      "Start API-35 emulator",
      "Clean install and launch SecPal",
      "Verify unauthenticated Android startup",
      "Cleanup emulator",
    ]) {
      expect(
        steps.some((step) => step.name === name),
        name
      ).toBe(true);
    }
    const smoke = steps.find(
      (step) => step.name === "Verify unauthenticated Android startup"
    );
    expect(smoke?.run).toContain("npm run test:live:android-smoke -- initial");
    expect(smoke?.run).not.toMatch(/\b(?:network-ready|configure|login)\b/);
  });

  it("binds the authenticated journey to the protected-main environment and checkout", () => {
    const { smoke } = workflow.jobs;
    expect(smoke.environment).toBe("android-smoke-main");
    expect(smoke.if).toBe(
      "github.repository == 'SecPal/android' && github.ref == 'refs/heads/main' && github.ref_protected && " +
        "(github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')"
    );
    expect(smoke.steps[0]?.with).toMatchObject({
      ref: "${{ github.sha }}",
      "persist-credentials": false,
    });
    const source = smoke.steps.findIndex(
      (step) => step.name === "Verify protected Android source"
    );
    const journey = smoke.steps.findIndex(
      (step) => step.name === "Run Android smoke journey"
    );
    expect(source).toBeGreaterThan(0);
    expect(source).toBeLessThan(journey);
    expect(JSON.stringify(smoke.steps)).not.toMatch(
      /actions\/(?:cache|download-artifact)@|"cache":/
    );
    expect(
      smoke.steps.find((step) => step.name === "Setup Node.js")?.with
    ).toMatchObject({
      "package-manager-cache": false,
    });
    const sourceCheck = smoke.steps[source]?.run ?? "";
    const sha = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout.trim();
    expect(sha).toMatch(/^[a-f0-9]{40}$/);
    const trustedSource = {
      ...process.env,
      GITHUB_REPOSITORY: "SecPal/android",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REF_PROTECTED: "true",
      GITHUB_SHA: sha,
    };
    for (const [override, status] of [
      [{}, 0],
      [{ GITHUB_EVENT_NAME: "schedule" }, 0],
      [{ GITHUB_EVENT_NAME: "workflow_dispatch" }, 0],
      [{ GITHUB_EVENT_NAME: "pull_request" }, 1],
      [{ GITHUB_EVENT_NAME: "pull_request_target" }, 1],
      [{ GITHUB_EVENT_NAME: "workflow_run" }, 1],
      [{ GITHUB_EVENT_NAME: "" }, 1],
      [{ GITHUB_REF: "refs/pull/664/merge" }, 1],
      [{ GITHUB_REF: "refs/heads/update" }, 1],
      [{ GITHUB_REF: "refs/tags/main" }, 1],
      [{ GITHUB_REF: "refs/heads/Main" }, 1],
      [{ GITHUB_REPOSITORY: "another-owner/android" }, 1],
      [{ GITHUB_REF_PROTECTED: "false" }, 1],
      [{ GITHUB_SHA: "0".repeat(40) }, 1],
    ] as const) {
      expect(
        spawnSync("bash", ["-c", sourceCheck], {
          cwd: repoRoot,
          env: { ...trustedSource, ...override },
        }).status,
        JSON.stringify(override)
      ).toBe(status);
    }
  });

  it("runs for main changes, manual requests, and a daily schedule distinct from CT", () => {
    expect(workflow.name).toBe("Android Smoke");
    expect(workflow.on.pull_request.branches).toContain("main");
    expect(workflow.on.push.branches).toContain("main");
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.on.schedule).toEqual([{ cron: "43 4 * * *" }]);
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
  });

  it("requires a configured dedicated test origin before starting the trusted emulator", () => {
    const steps = workflow.jobs.smoke.steps;
    const target = steps.find((step) => step.id === "test-target");
    const journey = steps.find(
      (step) => step.name === "Run Android smoke journey"
    );
    expect(target?.env?.SECPAL_RUNTIME_URL).toBe(
      "${{ vars.ANDROID_SMOKE_API_ORIGIN }}"
    );
    expect(journey?.env?.SECPAL_RUNTIME_URL).toBe(
      "${{ steps.test-target.outputs.origin }}"
    );
    const targetIndex = steps.findIndex((step) => step.id === "test-target");
    expect(targetIndex).toBeGreaterThan(-1);
    expect(targetIndex).toBeLessThan(
      steps.findIndex((step) => step.name === "Start API-35 emulator")
    );
    expect(target?.run).toContain('"${SECPAL_RUNTIME_URL}/health/ready"');
    expect(target?.run).toContain("jq -e '.status == \"ready\"'");

    for (const origin of [
      "",
      "https://api.secpal.dev",
      "http://api.cx33.secpal.dev",
      "https://api.cx33.secpal.dev/other",
    ]) {
      const result = spawnSync("bash", ["-c", target?.run ?? ""], {
        env: { ...process.env, SECPAL_RUNTIME_URL: origin },
        encoding: "utf8",
        timeout: 1_000,
      });
      expect(result.status, origin).toBe(1);
      expect(result.stdout).toContain("ANDROID_SMOKE_API_ORIGIN");
    }
  });

  it("builds Android against the validated pinned frontend revision", () => {
    const revisionStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Read pinned frontend revision"
    );
    const checkoutStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Checkout pinned frontend"
    );
    const revisionStep = workflow.jobs.smoke.steps[revisionStepIndex];
    const checkoutStep = workflow.jobs.smoke.steps[checkoutStepIndex];

    expect(revisionStepIndex).toBeGreaterThan(-1);
    expect(checkoutStepIndex).toBe(revisionStepIndex + 1);
    expect(revisionStep?.id).toBe("frontend-revision");
    expect(revisionStep?.run).toContain("android/frontend-revision.txt");
    expect(revisionStep?.run).toContain("^[0-9a-f]{40}$");
    expect(checkoutStep?.with).toMatchObject({
      repository: "SecPal/frontend",
      ref: "${{ steps.frontend-revision.outputs.sha }}",
      path: "frontend",
    });
    expect(workflowSource).toContain(
      "SECPAL_ANDROID_FRONTEND_DIR: ${{ github.workspace }}/frontend"
    );
    expect(workflowSource).toContain("npm ci");
    expect(workflowSource).toContain("npm run cap:sync");
    expect(workflowSource).toContain("npm run native:assemble:debug");
    expect(workflowSource).toContain("Android SHA:");
    expect(workflowSource).toContain("Frontend SHA:");
  });

  it("compares both generated and finally packaged web assets with Git", () => {
    const buildStep = workflow.jobs.smoke.steps.find(
      (step) => step.name === "Build debug APK from pinned frontend"
    );
    const buildCommands = buildStep?.run ?? "";
    const syncIndex = buildCommands.indexOf("npm run cap:sync");
    const firstCleanIndex = buildCommands.indexOf(
      "npm run native:verify:web-assets-clean"
    );
    const assembleIndex = buildCommands.indexOf(
      "npm run native:assemble:debug"
    );
    const finalCleanIndex = buildCommands.lastIndexOf(
      "npm run native:verify:web-assets-clean"
    );

    expect(syncIndex).toBeGreaterThan(-1);
    expect(firstCleanIndex).toBeGreaterThan(syncIndex);
    expect(assembleIndex).toBeGreaterThan(firstCleanIndex);
    expect(finalCleanIndex).toBeGreaterThan(assembleIndex);
  });

  it("verifies generated native-auth route parity after packaging", () => {
    const buildStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Build debug APK from pinned frontend"
    );
    const parityStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Verify generated native-auth route parity"
    );
    const parityStep = workflow.jobs.smoke.steps[parityStepIndex];

    expect(buildStepIndex).toBeGreaterThan(-1);
    expect(parityStepIndex).toBe(buildStepIndex + 1);
    expect(parityStep?.env?.SECPAL_REQUIRE_PACKAGED_ROUTE_PARITY).toBe("1");
    expect(parityStep?.run).toBe(
      "./node_modules/.bin/vitest run tests/android-native-auth-route-inventory.test.ts"
    );
    expect(workflow.on.pull_request.paths).toContain(
      "tests/android-native-auth-route-inventory.test.ts"
    );
    expect(workflow.on.push.paths).toContain(
      "tests/android-native-auth-route-inventory.test.ts"
    );
  });

  it("uses a deterministic current-day version code for the smoke APK", () => {
    const revisionStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Record tested revisions"
    );
    const buildStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Build debug APK from pinned frontend"
    );
    const revisionSetup =
      workflow.jobs.smoke.steps[revisionStepIndex]?.run ?? "";

    expect(revisionStepIndex).toBeGreaterThan(-1);
    expect(revisionStepIndex).toBeLessThan(buildStepIndex);
    expect(revisionSetup).toContain("date --utc +%Y%m%d");
    expect(revisionSetup).toContain(
      'smoke_version_code="${android_build_date}99"'
    );
    expect(revisionSetup).toContain(
      "SECPAL_ANDROID_VERSION_CODE=${smoke_version_code}"
    );
    expect(revisionSetup).toContain("Android version code:");
  });

  it("runs when any direct Capacitor packaging dependency changes", () => {
    const requiredPaths = [
      "capacitor.config.ts",
      "scripts/android-web-asset-inventory.mjs",
      "scripts/generate-android-web-asset-inventory.mjs",
      "scripts/normalize-capacitor-cordova-gradle.mjs",
      "scripts/normalize-cordova-config.mjs",
      "scripts/patch-capacitor-android-unchecked.mjs",
      "scripts/verify-android-frontend-build.mjs",
      "scripts/verify-android-runtime-schema.mjs",
      "scripts/verify-android-web-assets-clean.mjs",
      "scripts/verify-android-web-asset-overlays.mjs",
    ];

    for (const path of requiredPaths) {
      expect(workflow.on.pull_request.paths).toContain(path);
      expect(workflow.on.push.paths).toContain(path);
    }
  });

  it("uses the existing API-35 KVM emulator infrastructure and reconnect helper", () => {
    expect(workflowSource).toContain(
      'image="system-images;android-35;google_apis;x86_64"'
    );
    expect(workflowSource).toContain("sudo chmod 666 /dev/kvm");
    expect(workflowSource).toContain("npm run android:emulator:start");
    expect(workflowSource).toContain("npm run android:device:wait");
    expect(workflowSource).toContain(
      "bash ./scripts/forward-android-webview.sh"
    );
    expect(workflowSource).toContain(
      "SECPAL_ANDROID_EMULATOR_GPU_MODE: software"
    );
    expect(workflowSource).toContain(
      "SECPAL_ANDROID_EMULATOR_WINDOW_MODE: no-window"
    );
    expect(emulatorHelperSource).toContain("-wipe-data");
    expect(emulatorHelperSource).toContain("-no-snapshot");
  });

  it("uses the public development fixture only for trusted login and masks its password", () => {
    expect(workflowSource).not.toMatch(/secrets\.|android-ci@example\.com/);
    expect(workflowSource).not.toMatch(/^\s+SECPAL_TEST_PASSWORD:/m);
    const journey = workflow.jobs.smoke.steps.find(
      (step) => step.name === "Run Android smoke journey"
    );
    const loadFixture = journey?.run
      ?.split("\n")
      .find((line) => line.trimStart().startsWith("fixture_password="));
    expect(loadFixture).toContain(
      "process.stdout.write(developmentFixturePassword)"
    );
    const fixture = spawnSync(
      "bash",
      ["-ec", `${loadFixture}\nprintf '%s' "$fixture_password"`],
      { cwd: repoRoot, encoding: "utf8" }
    );
    expect(fixture.status).toBe(0);
    expect(fixture.stdout).toBe("password");
    expect(fixture.stderr).toBe("");
    expect(journey?.run).toContain('echo "::add-mask::$fixture_password"');
    expect(journey?.run).toContain(
      'SECPAL_TEST_PASSWORD="$fixture_password" run_action login\n'
    );
    expect(journey?.run).not.toContain("$GITHUB_ENV");
  });

  it("executes the complete persistence, lifecycle, logout, and instance-switch journey", () => {
    const expectedActions = [
      "run_action network-ready",
      "run_action initial",
      "run_action configure",
      "run_action login-persisted",
      "run_action login",
      "run_action protected-profile",
      "run_action lifecycle",
      "run_action logout",
      "run_action logout-persisted",
      "run_action switch-instance",
      "run_action final-configure",
    ];
    const journey = workflow.jobs.smoke.steps.find(
      (step) => step.name === "Run Android smoke journey"
    )?.run;
    const actualActions = journey
      ?.split("\n")
      .map((line) =>
        line.trim().replace(/^SECPAL_TEST_PASSWORD="\$fixture_password" /, "")
      )
      .filter((line) => line.startsWith("run_action "));

    expect(actualActions).toEqual(expectedActions);
    expect(
      workflowSource.match(/shell am force-stop app\.secpal/g)
    ).toHaveLength(1);
    expect(workflowSource).toContain("shell input keyevent KEYCODE_HOME");
  });

  it("uploads failure-only diagnostics for seven days and always cleans up", () => {
    const steps = workflow.jobs.smoke.steps;
    const upload = steps.find(
      (step) => step.name === "Upload failure diagnostics"
    );
    const cleanup = steps.find((step) => step.name === "Cleanup emulator");

    expect(upload?.if).toBe("failure()");
    expect(upload?.with?.["retention-days"]).toBe(7);
    expect(upload?.with?.path).toBe(
      "${{ runner.temp }}/android-smoke-diagnostics/smoke-result.json"
    );
    expect(cleanup?.if).toBe("always()");
    const credentialFreeSteps = workflow.jobs["pull-request"]?.steps ?? [];
    const preAuthDiagnostics =
      credentialFreeSteps.find(
        (step) => step.name === "Collect credential-free failure diagnostics"
      )?.run ?? "";
    for (const name of [
      "logcat.txt",
      "screenshot.png",
      "dumpsys-activity.txt",
      "dumpsys-window.txt",
      "dumpsys-package.txt",
      "webview-state.json",
    ]) {
      expect(preAuthDiagnostics).toContain(name);
      expect(JSON.stringify(steps)).not.toContain(name);
    }
    expect(workflowSource).toContain("smoke-result.json");
    expect(workflowSource.match(/android-smoke\.mjs sanitize/g)).toHaveLength(
      5
    );
  });

  it("does not add Firebase, Google Cloud, real-device, or passkey integration", () => {
    expect(workflowSource).not.toMatch(
      /firebase|google-github-actions|gcloud/i
    );
    expect(workflowSource).not.toMatch(/passkey|device-owner|kiosk/i);
  });

  it("pins every referenced GitHub Action to a full commit SHA", () => {
    const actionReferences = workflow.jobs.smoke.steps
      .map((step) => step.uses)
      .filter((reference): reference is string => reference !== undefined);

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });
});
