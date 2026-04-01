/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

async function loadBrandSyncModule(): Promise<{
  assertFrontendBrandAssetSourcesExist: (plan: {
    launcherSource: string;
    splashSource: string;
  }) => void;
  buildFrontendBrandAssetPlan: (repoRoot: string) => {
    launcherSource: string;
    splashSource: string;
    launcherForegroundTargets: Array<{ path: string; size: number }>;
    launcherMonochromeTargets: Array<{ path: string; size: number }>;
    launcherTargets: Array<{ path: string; size: number }>;
    roundLauncherTargets: Array<{ path: string; size: number }>;
    splashTargets: Array<{ path: string; width: number; height: number }>;
    splashIconTarget: string;
    splashIconCanvasSize: number;
    splashIconLogoSize: number;
  };
}> {
  // @ts-expect-error The helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/sync-frontend-brand-assets.mjs");
}

describe("frontend brand asset sync", () => {
  it("fails fast when the canonical frontend logo assets are unavailable", async () => {
    const {
      assertFrontendBrandAssetSourcesExist,
      buildFrontendBrandAssetPlan,
    } = await loadBrandSyncModule();

    expect(() =>
      assertFrontendBrandAssetSourcesExist(
        buildFrontendBrandAssetPlan("/tmp/brand-sync-missing-assets")
      )
    ).toThrowError(
      "Missing canonical frontend brand asset: /tmp/frontend/public/logo-light-512.png"
    );
  });

  it("maps canonical frontend logos to Android launcher and splash outputs", async () => {
    const { buildFrontendBrandAssetPlan } = await loadBrandSyncModule();
    const plan = buildFrontendBrandAssetPlan("/workspace/android");

    expect(plan.launcherSource).toBe(
      "/workspace/frontend/public/logo-light-512.png"
    );
    expect(plan.splashSource).toBe(
      "/workspace/frontend/public/logo-dark-512.png"
    );
    expect(plan.splashIconTarget).toBe(
      "/workspace/android/android/app/src/main/res/drawable-nodpi/secpal_splash_icon.png"
    );
    expect(plan.splashIconCanvasSize).toBe(512);
    expect(plan.splashIconLogoSize).toBe(164);
  });

  it("covers every Android density bucket and both splash orientations", async () => {
    const { buildFrontendBrandAssetPlan } = await loadBrandSyncModule();
    const plan = buildFrontendBrandAssetPlan("/workspace/android");

    expect(plan.launcherForegroundTargets).toEqual([
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png",
        size: 108,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png",
        size: 162,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png",
        size: 216,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png",
        size: 324,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png",
        size: 432,
      },
    ]);

    expect(plan.launcherMonochromeTargets).toEqual([
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-mdpi/ic_launcher_monochrome.png",
        size: 108,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-hdpi/ic_launcher_monochrome.png",
        size: 162,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xhdpi/ic_launcher_monochrome.png",
        size: 216,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_monochrome.png",
        size: 324,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.png",
        size: 432,
      },
    ]);

    expect(plan.launcherTargets).toEqual([
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-mdpi/ic_launcher.png",
        size: 48,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-hdpi/ic_launcher.png",
        size: 72,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png",
        size: 96,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png",
        size: 144,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
        size: 192,
      },
    ]);

    expect(plan.roundLauncherTargets).toEqual([
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png",
        size: 48,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png",
        size: 72,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png",
        size: 96,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png",
        size: 144,
      },
      {
        path: "/workspace/android/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png",
        size: 192,
      },
    ]);

    expect(plan.splashTargets).toEqual([
      {
        path: "/workspace/android/android/app/src/main/res/drawable/splash.png",
        width: 480,
        height: 320,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-port-mdpi/splash.png",
        width: 320,
        height: 480,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-port-hdpi/splash.png",
        width: 480,
        height: 800,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-port-xhdpi/splash.png",
        width: 720,
        height: 1280,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-port-xxhdpi/splash.png",
        width: 960,
        height: 1600,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-port-xxxhdpi/splash.png",
        width: 1280,
        height: 1920,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-land-mdpi/splash.png",
        width: 480,
        height: 320,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-land-hdpi/splash.png",
        width: 800,
        height: 480,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-land-xhdpi/splash.png",
        width: 1280,
        height: 720,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-land-xxhdpi/splash.png",
        width: 1600,
        height: 960,
      },
      {
        path: "/workspace/android/android/app/src/main/res/drawable-land-xxxhdpi/splash.png",
        width: 1920,
        height: 1280,
      },
    ]);
  });
});
