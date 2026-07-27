/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(repoRoot, ...segments), "utf8");

describe("Android Certificate Transparency regression contract", () => {
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
    for (const apiLevel of [24, 29, 35, 36]) {
      expect(workflow).toMatch(
        new RegExp(
          `- api-level: ${apiLevel}\\s+image-api-level: "${apiLevel}"\\s+sdk-channel: 0\\s+boot-timeout: 300`
        )
      );
    }
    expect(workflow).toMatch(
      /- api-level: 37\s+image-api-level: "37\.0"\s+sdk-channel: 0\s+boot-timeout: 600/
    );
    expect(workflow).not.toContain("experimental:");
    expect(workflow).not.toContain("continue-on-error:");
    for (const harnessDependency of [
      "package.json",
      "package-lock.json",
      "scripts/start-android-emulator.sh",
      "scripts/wait-for-android-device.sh",
      "scripts/run-android-connected-test.sh",
      "scripts/with-android-env.sh",
    ]) {
      expect(workflow.split(`- "${harnessDependency}"`)).toHaveLength(3);
    }
    expect(workflow).toMatch(
      /sdkmanager --channel="\$SDK_CHANNEL" \\\s+"platform-tools" "emulator" "\$image"/
    );
    expect(workflow).toContain(
      "bash ./scripts/with-android-env.sh adb version"
    );
    expect(workflow).toContain("matrix.api-level >= 36");
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
    expect(workflow).toContain("BOOT_TIMEOUT: ${{ matrix.boot-timeout }}");
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
    expect(
      workflow.indexOf(":app:assembleCtRegressionAndroidTest")
    ).toBeLessThan(workflow.indexOf("npm run android:emulator:start"));
    expect(workflow).toContain("bash ./scripts/run-android-connected-test.sh");
    expect(workflow).toContain('cat "$emulator_log"');
    expect(workflow).toContain("connectedCtRegressionAndroidTest");
    expect(workflow).not.toContain("connectedDebugAndroidTest");
    expect(workflow).toContain("probe_url:");
    expect(workflow).toContain("SECPAL_LIVE_CT_PROBE_URL");
    expect(workflow).toContain(
      "-Dcom.google.protobuf.use_unsafe_pre22_gencode=true"
    );
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
