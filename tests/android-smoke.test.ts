/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const smokeSource = readFileSync(
  resolve(repoRoot, "scripts/android-smoke.mjs"),
  "utf8"
);

async function loadSmokeModule(): Promise<{
  assertSmokeState: (
    checkpoint: string,
    state: Record<string, unknown>,
    expected: { email: string; runtimeOrigin: string }
  ) => void;
  clickProfileMenuItem: (globalLike: Record<string, unknown>) => {
    action: string;
  };
  sanitizeDiagnosticText: (value: string, secrets?: string[]) => string;
  inspectTenantBrowserState: (globalLike: Record<string, unknown>) => Promise<{
    cleared: boolean;
  }>;
  sanitizeSmokeState: (
    value: Record<string, unknown>
  ) => Record<string, unknown>;
}> {
  // @ts-expect-error This helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/android-smoke.mjs");
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFakeAndroidEnvironment(adbScript: string): {
  env: NodeJS.ProcessEnv;
  tempRoot: string;
} {
  const tempRoot = mkdtempSync(join(tmpdir(), "secpal-android-smoke-"));
  const fakeBinRoot = join(tempRoot, "bin");
  mkdirSync(fakeBinRoot, { recursive: true });
  writeExecutable(join(fakeBinRoot, "adb"), adbScript);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANDROID_HOME: join(tempRoot, "missing-android-sdk"),
    ANDROID_SDK_ROOT: join(tempRoot, "missing-android-sdk"),
    PATH: `${fakeBinRoot}:${process.env.PATH ?? ""}`,
  };

  return { env, tempRoot };
}

describe("Android smoke helpers", () => {
  it("opens the protected profile through the visible React menu item", async () => {
    const { clickProfileMenuItem } = await loadSmokeModule();
    const clicks: string[] = [];
    const buildMenuItem = (href: string, visible: boolean) => ({
      getAttribute: (name: string) => (name === "href" ? href : null),
      getClientRects: () => ({ length: visible ? 1 : 0 }),
      click: () => clicks.push(href),
    });
    const hiddenProfileItem = buildMenuItem("/profile", false);
    const settingsItem = buildMenuItem("/settings", true);
    const visibleProfileItem = buildMenuItem("/profile", true);

    expect(
      clickProfileMenuItem({
        document: {
          querySelectorAll: () => [
            hiddenProfileItem,
            settingsItem,
            visibleProfileItem,
          ],
        },
        getComputedStyle: () => ({ visibility: "visible" }),
      })
    ).toEqual({ action: "open-profile" });
    expect(clicks).toEqual(["/profile"]);
  });

  it("accepts the persisted login checkpoint without requiring push state", async () => {
    const { assertSmokeState } = await loadSmokeModule();

    expect(() =>
      assertSmokeState(
        "login-persisted",
        {
          runtimeConfigured: true,
          runtimeApiOrigin: "https://api.secpal.dev",
          nativeAuthActive: false,
          protectedUserEmail: null,
          hasLoginForm: true,
          hasDiscovery: false,
          loginError: "",
          discoveryError: "",
        },
        {
          email: "test@example.com",
          runtimeOrigin: "https://api.secpal.dev",
        }
      )
    ).not.toThrow();

    expect(smokeSource).not.toContain("__SecPalAndroidPushSyncState");
    expect(smokeSource).not.toContain("getAndroidPushRegistrationState");
  });

  it("requires an authenticated application shell after native login", async () => {
    const { assertSmokeState } = await loadSmokeModule();
    const expected = {
      email: "test@example.com",
      runtimeOrigin: "https://api.secpal.dev",
    };
    const authenticatedState = {
      runtimeConfigured: true,
      runtimeApiOrigin: expected.runtimeOrigin,
      nativeAuthActive: true,
      protectedUserEmail: expected.email,
      hasAuthenticatedShell: true,
      loginError: "",
      discoveryError: "",
    };

    expect(() =>
      assertSmokeState("authenticated", authenticatedState, expected)
    ).not.toThrow();
    expect(() =>
      assertSmokeState(
        "authenticated",
        { ...authenticatedState, hasAuthenticatedShell: false },
        expected
      )
    ).toThrow("application view");
  });

  it("requires the protected profile view and authenticated test user", async () => {
    const { assertSmokeState } = await loadSmokeModule();
    const expected = {
      email: "test@example.com",
      runtimeOrigin: "https://api.secpal.dev",
    };

    expect(() =>
      assertSmokeState(
        "protected-profile",
        {
          runtimeConfigured: true,
          runtimeApiOrigin: expected.runtimeOrigin,
          nativeAuthActive: true,
          protectedUserEmail: expected.email,
          profileEmailVisible: true,
          profileHeadingVisible: true,
          href: "https://app.secpal.dev/profile",
          loginError: "",
          discoveryError: "",
        },
        expected
      )
    ).not.toThrow();

    expect(() =>
      assertSmokeState(
        "protected-profile",
        {
          runtimeConfigured: true,
          runtimeApiOrigin: expected.runtimeOrigin,
          nativeAuthActive: true,
          protectedUserEmail: expected.email,
          profileEmailVisible: false,
          profileHeadingVisible: true,
          href: "https://app.secpal.dev/profile",
          loginError: "",
          discoveryError: "",
        },
        expected
      )
    ).toThrow("profile");
  });

  it("requires logout persistence while preserving runtime configuration", async () => {
    const { assertSmokeState } = await loadSmokeModule();

    expect(() =>
      assertSmokeState(
        "logout-persisted",
        {
          runtimeConfigured: true,
          runtimeApiOrigin: "https://api.secpal.dev",
          nativeAuthActive: false,
          protectedUserEmail: null,
          hasLoginForm: true,
          hasDiscovery: false,
          loginError: "",
          discoveryError: "",
        },
        {
          email: "test@example.com",
          runtimeOrigin: "https://api.secpal.dev",
        }
      )
    ).not.toThrow();
  });

  it("requires native runtime and tenant browser cleanup after instance switching", async () => {
    const { assertSmokeState } = await loadSmokeModule();

    expect(() =>
      assertSmokeState(
        "switched",
        {
          runtimeConfigured: false,
          nativeAuthActive: false,
          hasDiscovery: true,
          tenantBrowserStateCleared: true,
          loginError: "",
          discoveryError: "",
        },
        {
          email: "test@example.com",
          runtimeOrigin: "https://api.secpal.dev",
        }
      )
    ).not.toThrow();
  });

  it("redacts quoted, unquoted, query-string, and header auth material", async () => {
    const { sanitizeDiagnosticText } = await loadSmokeModule();
    const cases = [
      "Authorization: Bearer secret-token",
      "Authorization: Basic dGVzdDpzZWNyZXQ=",
      'password="password"',
      '"access_token":"json-token"',
      "refresh_token=plain-token",
      "id_token: colon-token",
      "https://example.test/callback?access_token=query-token&next=/",
      "FCM token=push-token",
    ];

    for (const diagnostic of cases) {
      const sanitized = sanitizeDiagnosticText(diagnostic, ["password"]);
      expect(sanitized).not.toMatch(
        /secret-token|dGVzdDpzZWNyZXQ=|password|json-token|plain-token|colon-token|query-token|push-token/
      );
      expect(sanitized).toContain("[REDACTED]");
    }
  });

  it("requires every tenant persistence surface to be empty", async () => {
    const { inspectTenantBrowserState } = await loadSmokeModule();
    const buildState = ({
      localKeys = ["secpal-locale"],
      sessionLength = 0,
      cacheNames = [],
      databaseNames = [],
      registrations = [],
    }: {
      localKeys?: string[];
      sessionLength?: number;
      cacheNames?: string[];
      databaseNames?: string[];
      registrations?: unknown[];
    }) => ({
      localStorage: {
        length: localKeys.length,
        key: (index: number) => localKeys[index] ?? null,
      },
      sessionStorage: { length: sessionLength },
      caches: { keys: async () => cacheNames },
      indexedDB: {
        databases: async () => databaseNames.map((name) => ({ name })),
      },
      navigator: {
        serviceWorker: { getRegistrations: async () => registrations },
      },
    });

    await expect(inspectTenantBrowserState(buildState({}))).resolves.toEqual({
      cleared: true,
    });

    for (const dirtyState of [
      buildState({ localKeys: ["secpal-locale", "tenant:selected"] }),
      buildState({ sessionLength: 1 }),
      buildState({ cacheNames: ["api-cache"] }),
      buildState({ databaseNames: ["SecPalDB"] }),
      buildState({ registrations: [{}] }),
    ]) {
      await expect(inspectTenantBrowserState(dirtyState)).resolves.toEqual({
        cleared: false,
      });
    }
  });

  it("only exposes the allowlisted smoke state fields", async () => {
    const { sanitizeSmokeState } = await loadSmokeModule();
    const sanitized = sanitizeSmokeState({
      href: "https://app.secpal.dev/login",
      runtimeConfigured: true,
      nativeAuthActive: false,
      token: "must-not-leak",
      authorization: "must-not-leak",
      androidPushSyncState: { currentToken: "must-not-leak" },
    });

    expect(sanitized).toEqual({
      href: "https://app.secpal.dev/login",
      runtimeConfigured: true,
      nativeAuthActive: false,
    });
  });

  it("replaces a stale forward with the current WebView PID", () => {
    const statePath = join(tmpdir(), `secpal-forward-state-${process.pid}`);
    const adbLogPath = join(tmpdir(), `secpal-forward-adb-${process.pid}.log`);
    const { env, tempRoot } = createFakeAndroidEnvironment(`#!/usr/bin/env bash
printf '%s\n' "$*" >> "${adbLogPath}"
shift 2
if [[ "$1 $2 $3" == "shell pidof app.secpal" ]]; then
  count="$(head -n 1 "${statePath}" 2>/dev/null || echo 0)"
  count=$((count + 1))
  printf '%s\n' "$count" > "${statePath}"
  if (( count == 1 )); then echo 111; else echo 222; fi
elif [[ "$1 $2 $3" == "shell cat /proc/net/unix" ]]; then
  count="$(head -n 1 "${statePath}")"
  if (( count == 1 )); then echo '@webview_devtools_remote_111'; else echo '@webview_devtools_remote_222'; fi
fi
`);
    const curlPath = join(tempRoot, "bin", "curl");
    writeExecutable(
      curlPath,
      `#!/usr/bin/env bash
count="$(head -n 1 "${statePath}")"
if (( count == 1 )); then echo '[]'; else echo '[{"type":"page"}]'; fi
`
    );
    env.PATH = `${resolve(curlPath, "..")}:${env.PATH ?? ""}`;

    try {
      const result = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts/forward-android-webview.sh"),
          "emulator-5570",
          "9223",
          "5",
        ],
        { cwd: repoRoot, env, encoding: "utf8" }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("pid=222");
      const adbLog = readFileSync(adbLogPath, "utf8");
      expect(adbLog).toContain(
        "forward tcp:9223 localabstract:webview_devtools_remote_111"
      );
      expect(adbLog).toContain("forward --remove tcp:9223");
      expect(adbLog).toContain(
        "forward tcp:9223 localabstract:webview_devtools_remote_222"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(statePath, { force: true });
      rmSync(adbLogPath, { force: true });
    }
  });

  it("scopes fatal-exception and ANR health failures to app.secpal", () => {
    const healthScript = resolve(
      repoRoot,
      "scripts/check-android-app-health.sh"
    );
    const scenarios = [
      {
        fatalProcess: "com.android.systemui",
        anrProcess: "",
        resumedActivityMarker: "topResumedActivity",
        resumedActivity: "app.secpal/.MainActivity",
        status: 0,
      },
      {
        fatalProcess: "app.secpal",
        anrProcess: "",
        resumedActivity: "app.secpal/.MainActivity",
        status: 1,
      },
      {
        fatalProcess: "",
        anrProcess: "com.android.systemui",
        resumedActivity: "app.secpal/.MainActivity",
        status: 0,
      },
      {
        fatalProcess: "",
        anrProcess: "app.secpal",
        resumedActivity: "app.secpal/.MainActivity",
        status: 1,
      },
      {
        fatalProcess: "",
        anrProcess: "",
        resumedActivity: "com.android.launcher/.Launcher",
        status: 1,
      },
    ];

    for (const scenario of scenarios) {
      const { env, tempRoot } =
        createFakeAndroidEnvironment(`#!/usr/bin/env bash
shift 2
if [[ "$1 $2 $3" == "shell pidof app.secpal" ]]; then
  echo 321
elif [[ "$1 $2 $3" == "shell dumpsys activity" ]]; then
  if [[ "$4" == "activities" ]]; then
    echo 'Hist #0: ActivityRecord{ app.secpal/.MainActivity } state=STOPPED mVisible=false'
    echo '${scenario.resumedActivityMarker ?? "mResumedActivity"} ${scenario.resumedActivity}'
  elif [[ "$4" == "lastanr" && -n "${scenario.anrProcess}" ]]; then
    echo 'ANR in ${scenario.anrProcess}'
  fi
elif [[ "$1 $2" == "logcat -d" && -n "${scenario.fatalProcess}" ]]; then
  echo 'FATAL EXCEPTION: main'
  echo 'Process: ${scenario.fatalProcess}, PID: 321'
fi
`);

      try {
        const result = spawnSync("bash", [healthScript, "emulator-5570"], {
          cwd: repoRoot,
          env,
          encoding: "utf8",
        });
        expect(result.status).toBe(scenario.status);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("rejects unsafe device serials before invoking adb", () => {
    for (const scriptName of [
      "forward-android-webview.sh",
      "check-android-app-health.sh",
    ]) {
      const result = spawnSync(
        "bash",
        [resolve(repoRoot, "scripts", scriptName), "emulator-5570;false"],
        { cwd: repoRoot, encoding: "utf8" }
      );

      expect(result.status).toBe(64);
      expect(result.stderr).toContain("unsafe characters");
    }
  });
});
