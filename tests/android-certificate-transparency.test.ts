/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

type WorkflowStep = {
  env?: Record<string, string>;
  id?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};

type WorkflowJob = {
  if?: string;
  name?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
  "timeout-minutes"?: number;
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
  on?: {
    pull_request?: { branches?: string[]; paths?: string[] };
    push?: { branches?: string[]; paths?: string[] };
  };
  permissions?: Record<string, string>;
};

describe("Android Certificate Transparency regression contract", () => {
  it("always reports a fail-closed aggregate required check", async () => {
    const workflow = load(
      readRepoFile(
        ".github",
        "workflows",
        "android-certificate-transparency.yml"
      )
    ) as Workflow;

    expect(workflow.on?.pull_request).toEqual({ branches: ["main"] });
    expect(workflow.on?.push?.paths).toContain(
      ".github/workflows/android-certificate-transparency.yml"
    );
    expect(workflow.permissions).toEqual({ contents: "read" });

    const detectionJob = workflow.jobs?.["detect-relevant-changes"];
    expect(detectionJob?.permissions).toEqual({ "pull-requests": "read" });
    expect(detectionJob?.["timeout-minutes"]).toBe(5);
    expect(detectionJob?.outputs).toEqual({
      relevant: "${{ steps.detect.outputs.result }}",
    });
    const detectionStep = detectionJob?.steps?.find(
      (step) => step.id === "detect"
    );
    expect(detectionStep?.uses).toMatch(
      /^actions\/github-script@[0-9a-f]{40}$/
    );
    expect(detectionStep?.with?.script).toContain(
      "github.paginate(github.rest.pulls.listFiles"
    );
    expect(detectionStep?.with?.script).toContain(
      'return context.eventName !== "pull_request" || relevant ? "true" : "false";'
    );
    const detectionScript = detectionStep?.with?.script;
    expect(detectionScript).toBeTypeOf("string");
    const executeDetection = new Function(
      "context",
      "github",
      "core",
      `return (async () => {${detectionScript}})();`
    ) as (
      context: Record<string, unknown>,
      github: Record<string, unknown>,
      core: Record<string, unknown>
    ) => Promise<string>;
    const detect = (
      eventName: string,
      files: Array<string | { filename: string; previous_filename?: string }>,
      changedFiles: number
    ) =>
      executeDetection(
        {
          eventName,
          issue: { number: 612 },
          payload: { pull_request: { changed_files: changedFiles } },
          repo: { owner: "SecPal", repo: "android" },
        },
        {
          paginate: async () =>
            files.map((file) =>
              typeof file === "string" ? { filename: file } : file
            ),
          rest: { pulls: { listFiles: () => undefined } },
        },
        { warning: () => undefined }
      );
    await expect(detect("push", [], 0)).resolves.toBe("true");
    await expect(detect("pull_request", ["docs/README.md"], 1)).resolves.toBe(
      "false"
    );
    await expect(
      detect("pull_request", ["package-lock.json"], 1)
    ).resolves.toBe("true");
    await expect(
      detect(
        "pull_request",
        ["android/app/src/main/res/xml-v36/network_security_config.xml"],
        1
      )
    ).resolves.toBe("true");
    await expect(
      detect(
        "pull_request",
        [
          {
            filename: "docs/network-security.md",
            previous_filename:
              "android/app/src/main/res/xml/network_security_config.xml",
          },
        ],
        1
      )
    ).resolves.toBe("true");
    await expect(detect("pull_request", ["docs/README.md"], 2)).resolves.toBe(
      "true"
    );
    for (const filteredPath of workflow.on?.push?.paths ?? []) {
      const representativePath = filteredPath.replace(
        "xml*/network_security_config.xml",
        "xml-v36/network_security_config.xml"
      );
      await expect(
        detect("pull_request", [representativePath], 1)
      ).resolves.toBe("true");
    }

    const matrixJob = workflow.jobs?.["platform-policy"];
    expect(matrixJob?.needs).toBe("detect-relevant-changes");
    expect(matrixJob?.if).toBe(
      "${{ needs.detect-relevant-changes.outputs.relevant == 'true' }}"
    );

    const aggregateJob = workflow.jobs?.["certificate-transparency"];
    expect(aggregateJob?.name).toBe("Certificate transparency");
    expect(aggregateJob?.permissions).toEqual({});
    expect(aggregateJob?.needs).toEqual([
      "detect-relevant-changes",
      "platform-policy",
    ]);
    expect(aggregateJob?.if).toBe("${{ always() }}");
    expect(aggregateJob?.["timeout-minutes"]).toBe(5);
    const aggregateStep = aggregateJob?.steps?.[0];
    expect(aggregateStep?.env).toEqual({
      DETECTION_RESULT: "${{ needs.detect-relevant-changes.result }}",
      PLATFORM_POLICY_RESULT: "${{ needs.platform-policy.result }}",
      RELEVANT: "${{ needs.detect-relevant-changes.outputs.relevant }}",
    });

    const aggregateScript = aggregateStep?.run;
    expect(aggregateScript).toBeTypeOf("string");
    const runAggregate = (env: Record<string, string>) =>
      spawnSync("bash", ["-eu", "-o", "pipefail", "-c", aggregateScript!], {
        encoding: "utf8",
        env: { ...process.env, ...env },
      });

    expect(
      runAggregate({
        DETECTION_RESULT: "success",
        PLATFORM_POLICY_RESULT: "skipped",
        RELEVANT: "false",
      }).status
    ).toBe(0);
    expect(
      runAggregate({
        DETECTION_RESULT: "success",
        PLATFORM_POLICY_RESULT: "success",
        RELEVANT: "true",
      }).status
    ).toBe(0);
    for (const failingCase of [
      {
        DETECTION_RESULT: "failure",
        PLATFORM_POLICY_RESULT: "skipped",
        RELEVANT: "false",
      },
      {
        DETECTION_RESULT: "success",
        PLATFORM_POLICY_RESULT: "failure",
        RELEVANT: "true",
      },
      {
        DETECTION_RESULT: "success",
        PLATFORM_POLICY_RESULT: "skipped",
        RELEVANT: "unknown",
      },
    ]) {
      expect(runAggregate(failingCase).status).not.toBe(0);
    }
  });

  it("locks the SDK, device, monitoring, and recovery contract", () => {
    const variablesGradle = readRepoFile("android", "variables.gradle");
    const appBuildGradle = readRepoFile("android", "app", "build.gradle");
    const instrumentedTest = readRepoFile(
      "android",
      "app",
      "src",
      "androidTest",
      "java",
      "app",
      "secpal",
      "CertificateTransparencyInstrumentedTest.java"
    );
    const exampleInstrumentedTest = readRepoFile(
      "android",
      "app",
      "src",
      "androidTest",
      "java",
      "app",
      "secpal",
      "ExampleInstrumentedTest.java"
    );
    const workflow = readRepoFile(
      ".github",
      "workflows",
      "android-certificate-transparency.yml"
    );
    const architecture = readRepoFile("docs", "ANDROID_AUTH_ARCHITECTURE.md");
    const api36Policy = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml-v36",
      "network_security_config.xml"
    );
    const api37Policy = readRepoFile(
      "android",
      "app",
      "src",
      "main",
      "res",
      "xml-v37",
      "network_security_config.xml"
    );

    expect(variablesGradle).toMatch(/compileSdkVersion\s*=\s*36/);
    expect(variablesGradle).toMatch(/targetSdkVersion\s*=\s*35/);
    expect(appBuildGradle).toMatch(/ctRegression\s*\{/);
    expect(appBuildGradle).toMatch(/initWith\s+release/);
    expect(appBuildGradle).toMatch(/signingConfig\s+signingConfigs\.debug/);
    expect(appBuildGradle).toMatch(/testBuildType\s+["']ctRegression["']/);
    expect(appBuildGradle).toContain(
      "proguardFile 'ct-regression-proguard-rules.pro'"
    );
    expect(appBuildGradle).toContain(
      "testProguardFile 'ct-regression-proguard-rules.pro'"
    );
    expect(appBuildGradle).toContain(
      'manifest.srcFile "src/ctRegression/AndroidManifest.xml"'
    );
    const ctRegressionManifestPath = resolve(
      repoRoot,
      "android",
      "app",
      "src",
      "ctRegression",
      "AndroidManifest.xml"
    );
    expect(existsSync(ctRegressionManifestPath)).toBe(true);
    const ctRegressionManifest = readFileSync(ctRegressionManifestPath, "utf8");
    expect(ctRegressionManifest).toContain('android:testOnly="true"');
    expect(ctRegressionManifest).toContain(
      'android:name=".BridgeIsolationTestActivity"'
    );
    expect(ctRegressionManifest).toContain('android:exported="false"');
    expect(ctRegressionManifest).not.toContain('android:exported="true"');
    expect(ctRegressionManifest).not.toContain("DebugEnterprisePolicyReceiver");
    expect(ctRegressionManifest).not.toContain(
      "app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY"
    );
    expect(ctRegressionManifest).not.toContain(
      "app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY"
    );
    const ctRegressionProguardRulesPath = resolve(
      repoRoot,
      "android",
      "app",
      "ct-regression-proguard-rules.pro"
    );
    expect(existsSync(ctRegressionProguardRulesPath)).toBe(true);
    const ctRegressionProguardRules = readFileSync(
      ctRegressionProguardRulesPath,
      "utf8"
    );
    for (const sharedTestRuntimeClass of [
      "kotlin.LazyKt**",
      "kotlin.ResultKt",
      "kotlin.collections.AbstractIterator",
      "kotlin.coroutines.ContinuationKt",
      "kotlin.coroutines.intrinsics.IntrinsicsKt**",
      "kotlin.coroutines.jvm.internal.DebugProbesKt",
      "kotlin.io.CloseableKt",
      "kotlin.jvm.internal.Intrinsics",
      "kotlin.jvm.internal.StringCompanionObject",
      "kotlin.time.DurationKt",
    ]) {
      expect(ctRegressionProguardRules).toContain(
        `-keep class ${sharedTestRuntimeClass} { *; }`
      );
    }
    expect(ctRegressionProguardRules).not.toContain(
      "-keep class kotlin.** { *; }"
    );
    expect(ctRegressionProguardRules).toContain(
      "-keep class androidx.tracing.Trace { *; }"
    );
    expect(appBuildGradle).toContain("verifyCtRegressionSecurityDependencies");
    expect(appBuildGradle).toContain("ctRegressionRuntimeClasspath");
    expect(architecture).toContain("compiling with SDK 36 or newer");
    expect(architecture).toMatch(/target SDK 35\s+remains valid/);
    expect(instrumentedTest).toContain("isCleartextTrafficPermitted");
    expect(instrumentedTest).toContain(
      "isCertificateTransparencyVerificationRequired"
    );
    expect(instrumentedTest).toContain("customer-api.example");
    expect(instrumentedTest).toContain(
      'isCleartextTrafficPermitted("localhost")'
    );
    expect(instrumentedTest).toContain(
      'isCleartextTrafficPermitted("127.0.0.1")'
    );
    expect(instrumentedTest).toContain("https://api.secpal.dev/");
    expect(instrumentedTest).toContain("secpalLiveCtProbe");
    expect(instrumentedTest).toContain("secpalLiveCtProbeUrl");
    expect(exampleInstrumentedTest).toContain("BuildConfig.APPLICATION_ID");
    expect(exampleInstrumentedTest).not.toContain('assertEquals("app.secpal",');
    expect(api36Policy).toContain('<certificateTransparency enabled="true"');
    expect(api36Policy).not.toContain("<domain-config");
    expect(api37Policy).toContain('<certificateTransparency enabled="true"');
    expect(api37Policy).toContain(">localhost</domain>");
    expect(workflow).toMatch(
      /api-level: >-\s+\${{\s+fromJSON\(\s+\(github\.event_name == 'push' \|\| github\.event_name == 'pull_request'\)\s+&& '\[24,29,35,36,37\]'\s+\|\| '\[36,37\]'\s+\)\s+}}/
    );
    expect(workflow).not.toContain("matrix.api-level >= 36");
    expect(workflow).not.toContain("experimental:");
    expect(workflow).not.toContain("continue-on-error:");
    for (const harnessDependency of [
      "package.json",
      "package-lock.json",
      "scripts/start-android-emulator.sh",
      "scripts/wait-for-android-device.sh",
      "scripts/run-android-connected-test.sh",
      "scripts/with-android-env.sh",
      "android/app/src/ctRegression/AndroidManifest.xml",
    ]) {
      expect(workflow.split(`- "${harnessDependency}"`)).toHaveLength(2);
      expect(workflow).toContain(`"${harnessDependency}",`);
    }
    expect(workflow).toMatch(
      /sdkmanager --channel="\$SDK_CHANNEL" \\\s+"platform-tools" "emulator" "\$image"/
    );
    expect(workflow).toContain(
      "bash ./scripts/with-android-env.sh adb version"
    );
    expect(workflow).not.toContain("api37-stable-availability:");
    expect(workflow).toContain("SECPAL_ANDROID_EMULATOR_GPU_MODE: software");
    expect(workflow).toContain(
      "SECPAL_ANDROID_EMULATOR_WINDOW_MODE: no-window"
    );
    expect(workflow).toContain("avd_device_args=(--device pixel_7_pro)");
    expect(workflow).toContain("export SECPAL_ANDROID_EMULATOR_MEMORY_MB=4096");
    expect(workflow).toContain(
      "export SECPAL_ANDROID_EMULATOR_PARTITION_SIZE_MB=8192"
    );
    expect(workflow).toContain(
      "BOOT_TIMEOUT: ${{ matrix.api-level >= 37 && 600 || 300 }}"
    );
    expect(workflow).toContain(
      "RECOVERY_TIMEOUT: ${{ matrix.api-level >= 37 && 240 || 180 }}"
    );
    expect(workflow).toContain(
      "IMAGE_API_LEVEL: ${{ matrix.api-level >= 37 && '37.0' || matrix.api-level }}"
    );
    expect(workflow).toMatch(
      /timeout-minutes: >-\s+\${{\s+matrix\.api-level >= 37\s+&& 35\s+\|\| \(github\.event_name == 'schedule'\s+\|\| github\.event_name == 'workflow_dispatch'\)\s+&& 25\s+\|\| 15\s+}}/
    );
    expect(workflow).toContain(
      "timeout --foreground --kill-after=5s 30s bash ./scripts/with-android-env.sh"
    );
    expect(workflow).toContain("SDK_CHANNEL: 0");
    expect(workflow).toContain(
      'npm run android:device:wait -- emulator-5570 "$BOOT_TIMEOUT"'
    );
    expect(readRepoFile("scripts", "wait-for-android-device.sh")).toContain(
      "settings get global device_provisioned"
    );
    expect(readRepoFile("scripts", "wait-for-android-device.sh")).toContain(
      "pm path android"
    );
    expect(workflow).toContain(":app:assembleCtRegressionAndroidTest");
    expect(workflow.match(/android\/build\.gradle/g)).toHaveLength(2);
    expect(workflow.match(/android\/settings\.gradle/g)).toHaveLength(2);
    expect(
      workflow.indexOf(":app:assembleCtRegressionAndroidTest")
    ).toBeLessThan(workflow.indexOf("npm run android:emulator:start"));
    expect(workflow).toContain("bash ./scripts/run-android-connected-test.sh");
    expect(
      workflow.match(/emulator-5570 "\$API_LEVEL" "\$RECOVERY_TIMEOUT"/g)
    ).toHaveLength(2);
    expect(workflow).toContain('cat "$emulator_log"');
    expect(workflow).toContain("connectedCtRegressionAndroidTest");
    expect(workflow).not.toContain("connectedDebugAndroidTest");
    expect(workflow).toContain("probe_url:");
    expect(workflow).toContain("SECPAL_LIVE_CT_PROBE_URL");
    expect(workflow).not.toContain("use_unsafe_pre22_gencode");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain(
      "/data/misc/keychain/ct/v2/current/log_list.json"
    );
    expect(workflow).toContain("log_list_timestamp");
    expect(workflow).toContain("secpalLiveCtProbe=true");
    expect(architecture).toMatch(/all\s+remote HTTPS destinations/);
    expect(architecture).toContain("connectedCtRegressionAndroidTest");
    expect(architecture).toContain("secpalLiveCtProbeUrl");
    expect(architecture).toMatch(/customer operators/i);
    expect(architecture).toContain("published clients");
    expect(architecture).toContain("user-installed CAs");
  });
});
