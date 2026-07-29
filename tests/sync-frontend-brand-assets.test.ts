/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const launcherAssetHashes = {
  "android/app/src/main/res/mipmap-mdpi/ic_launcher.png":
    "d97d9a1b1272efaa6daf875bce17ff96848d8a58bc1d2b6eaf8d38231a8c9ed2",
  "android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png":
    "6ca2d306fb1dfa91b8d362932118ba3f25c2513438dcb38f4270c0df95f7b0e7",
  "android/app/src/main/res/mipmap-hdpi/ic_launcher.png":
    "701f7e3dbb26de93f1b6cc002199ed588c3c570bfc1f25bfe9c12d087705817d",
  "android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png":
    "6776f686763223111cbe0197a2399c4c5785a552d5953c512d587ddadcc4cd0a",
  "android/app/src/main/res/mipmap-xhdpi/ic_launcher.png":
    "80882d78f02c6d62a72974576d759643409bfbc784c4d928f489f4bccccadef2",
  "android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png":
    "7d91a57fb10e9e227342231b7b16755ba2893ad4c4116063b975eaf2e7c9d2db",
  "android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png":
    "7ce23314b2de418d332548b11ac8b3f95e210ed1d0bbdee10ddd5a2818eb5877",
  "android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png":
    "efc3af4658c66a4f831f8f6032ae39697179b77eb8e251638e38f20b0d6d32c1",
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png":
    "f3e42ade3207fe3cc0224b558cd514811f135493b77a97b0e0563f4ddef38bb9",
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png":
    "cfec368e48f315523787d3f914a3917ff560a735b993897b7f9112bf6bd301c6",
};

async function loadBrandSyncModule(): Promise<{
  assertFrontendBrandAssetSourcesExist: (plan: {
    launcherSource: string;
    splashIconLightSource: string;
    splashIconDarkSource: string;
  }) => void;
  buildFrontendBrandAssetPlan: (repoRoot: string) => {
    launcherSource: string;
    splashIconLightSource: string;
    splashIconDarkSource: string;
    launcherForegroundTargets: Array<{ path: string; size: number }>;
    launcherMonochromeTargets: Array<{ path: string; size: number }>;
    launcherTargets: Array<{ path: string; size: number }>;
    roundLauncherTargets: Array<{ path: string; size: number }>;
    splashIconLightTarget: string;
    splashIconDarkTarget: string;
    splashIconCanvasSize: number;
    splashIconLogoSize: number;
  };
  buildLegacyLauncherRenderArguments: (
    sourcePath: string,
    targetPath: string,
    canvasSize: number,
    logoSize: number,
    round: boolean
  ) => string[];
  calculateLegacyLauncherLogoSize: (canvasSize: number) => number;
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
    const tempRoot = mkdtempSync(join(tmpdir(), "brand-sync-missing-assets-"));
    const isolatedRepoRoot = resolve(tempRoot, "android");

    try {
      mkdirSync(isolatedRepoRoot, { recursive: true });

      expect(() =>
        assertFrontendBrandAssetSourcesExist(
          buildFrontendBrandAssetPlan(isolatedRepoRoot)
        )
      ).toThrowError(
        `Missing canonical frontend brand asset: ${resolve(
          tempRoot,
          "frontend/public/logo-source.png"
        )}`
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("maps canonical frontend logos to Android launcher and active splash outputs", async () => {
    const { buildFrontendBrandAssetPlan } = await loadBrandSyncModule();
    const plan = buildFrontendBrandAssetPlan("/workspace/android");

    expect(plan.launcherSource).toBe(
      "/workspace/frontend/public/logo-source.png"
    );
    expect(plan).not.toHaveProperty("splashSource");
    expect(plan).not.toHaveProperty("splashTargets");
    expect(plan.splashIconLightTarget).toBe(
      "/workspace/android/android/app/src/main/res/drawable-nodpi/secpal_splash_icon.png"
    );
    expect(plan.splashIconDarkTarget).toBe(
      "/workspace/android/android/app/src/main/res/drawable-night-nodpi/secpal_splash_icon.png"
    );
    expect(plan.splashIconCanvasSize).toBe(512);
    expect(plan.splashIconLogoSize).toBe(164);
  });

  it("renders legacy launcher assets with transparent and circular silhouettes", async () => {
    const {
      buildLegacyLauncherRenderArguments,
      calculateLegacyLauncherLogoSize,
    } = await loadBrandSyncModule();
    const sourcePath = "/workspace/frontend/public/logo-source.png";
    const targetPath = "/workspace/android/ic_launcher.png";

    expect([48, 72, 96, 144, 192].map(calculateLegacyLauncherLogoSize)).toEqual(
      [25, 37, 50, 75, 100]
    );

    expect(
      buildLegacyLauncherRenderArguments(sourcePath, targetPath, 48, 25, false)
    ).toEqual([
      sourcePath,
      "-trim",
      "+repage",
      "-resize",
      "25x25",
      "-background",
      "none",
      "-gravity",
      "center",
      "-extent",
      "48x48",
      "-define",
      "png:exclude-chunks=date,time",
      targetPath,
    ]);

    expect(
      buildLegacyLauncherRenderArguments(sourcePath, targetPath, 48, 25, true)
    ).toEqual([
      "-size",
      "48x48",
      "xc:none",
      "-fill",
      "#FFFFFF",
      "-draw",
      "circle 23.5,23.5 23.5,0",
      "(",
      sourcePath,
      "-trim",
      "+repage",
      "-resize",
      "25x25",
      ")",
      "-gravity",
      "center",
      "-composite",
      "-define",
      "png:exclude-chunks=date,time",
      targetPath,
    ]);
  });

  it("keeps committed launcher outputs aligned with reviewed generator snapshots", () => {
    for (const [relativePath, expectedHash] of Object.entries(
      launcherAssetHashes
    )) {
      const actualHash = createHash("sha256")
        .update(readFileSync(resolve(repoRoot, relativePath)))
        .digest("hex");

      expect(actualHash, relativePath).toBe(expectedHash);
    }
  });

  it("covers every launcher density bucket without legacy splash outputs", async () => {
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

    expect(plan).not.toHaveProperty("splashTargets");
  });
});
