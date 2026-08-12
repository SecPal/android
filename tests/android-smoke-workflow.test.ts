/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

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
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
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
  jobs: { smoke: { env: Record<string, string>; steps: WorkflowStep[] } };
};
const workflow = parse(workflowSource) as SmokeWorkflow;

describe("Android smoke workflow", () => {
  it("runs for main changes, manual requests, and a daily schedule distinct from CT", () => {
    expect(workflow.name).toBe("Android Smoke");
    expect(workflow.on.pull_request.branches).toContain("main");
    expect(workflow.on.push.branches).toContain("main");
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.on.schedule).toEqual([{ cron: "43 4 * * *" }]);
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
  });

  it("checks API readiness before installing or starting the emulator", () => {
    const readyIndex = workflowSource.indexOf(
      "https://api.secpal.dev/health/ready"
    );
    const liveIndex = workflowSource.indexOf(
      "https://api.secpal.dev/health/live"
    );
    const sdkIndex = workflowSource.indexOf("sdkmanager");
    const emulatorIndex = workflowSource.indexOf(
      "npm run android:emulator:start"
    );

    expect(readyIndex).toBeGreaterThan(-1);
    expect(liveIndex).toBeGreaterThan(readyIndex);
    expect(readyIndex).toBeLessThan(sdkIndex);
    expect(readyIndex).toBeLessThan(emulatorIndex);
    expect(workflowSource).toContain("jq -e '.status == \"ready\"'");
  });

  it("builds Android against a reproducible checkout of frontend main", () => {
    expect(workflowSource).toContain("repository: SecPal/frontend");
    expect(workflowSource).toContain('ref: "main"');
    expect(workflowSource).toContain("path: frontend");
    expect(workflowSource).toContain(
      "SECPAL_ANDROID_FRONTEND_DIR: ${{ github.workspace }}/frontend"
    );
    expect(workflowSource).toContain("npm ci");
    expect(workflowSource).toContain("npm run cap:sync");
    expect(workflowSource).toContain("npm run native:assemble:debug");
    expect(workflowSource).toContain("Android SHA:");
    expect(workflowSource).toContain("Frontend SHA:");
  });

  it("uses a deterministic current-day version code for the smoke APK", () => {
    const revisionStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Record tested revisions"
    );
    const buildStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Build debug APK from frontend main"
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

  it("uses the documented runtime and seed credentials without logging the password", () => {
    expect(workflowSource).toContain(
      "SECPAL_RUNTIME_URL: https://api.secpal.dev"
    );
    expect(workflowSource).toContain("SECPAL_TEST_EMAIL: test@example.com");
    expect(workflow.jobs.smoke.env.SECPAL_TEST_PASSWORD).toBeUndefined();
    expect(workflowSource).not.toContain("SECPAL_TEST_PASSWORD: password");

    const credentialStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Configure documented test credential"
    );
    const journeyStepIndex = workflow.jobs.smoke.steps.findIndex(
      (step) => step.name === "Run Android smoke journey"
    );
    const credentialSetup =
      workflow.jobs.smoke.steps[credentialStepIndex]?.run ?? "";

    expect(credentialStepIndex).toBeGreaterThan(-1);
    expect(credentialStepIndex).toBeLessThan(journeyStepIndex);
    expect(credentialSetup).toContain("'pass' 'word'");
    expect(credentialSetup).toContain("::add-mask::${test_password}");
    expect(credentialSetup).toContain("SECPAL_TEST_PASSWORD=${test_password}");
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
      .map((line) => line.trim())
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
    expect(cleanup?.if).toBe("always()");
    expect(workflowSource).toContain("logcat.txt");
    expect(workflowSource).toContain("screenshot.png");
    expect(workflowSource).toContain("dumpsys-activity.txt");
    expect(workflowSource).toContain("dumpsys-window.txt");
    expect(workflowSource).toContain("dumpsys-package.txt");
    expect(workflowSource).toContain("webview-state.json");
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
