/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const legacyLauncherAssetPaths = [
  "android/app/src/main/res/mipmap-mdpi/ic_launcher.png",
  "android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png",
  "android/app/src/main/res/mipmap-hdpi/ic_launcher.png",
  "android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png",
  "android/app/src/main/res/mipmap-xhdpi/ic_launcher.png",
  "android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png",
  "android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png",
  "android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png",
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png",
];
const maximumNormalizedPixelError = 0.005;

function readDecodedPngPixels(imageMagickCommand: string, path: string) {
  const result = spawnSync(
    imageMagickCommand,
    [path, "-alpha", "on", "-colorspace", "sRGB", "-depth", "8", "rgba:-"],
    {
      encoding: null,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    const detail =
      result.error?.message ?? result.stderr?.toString("utf8").trim();
    throw new Error(
      `Failed to decode launcher PNG pixels${detail ? `: ${detail}` : ""}`
    );
  }

  return result.stdout;
}

function calculateNormalizedPremultipliedPixelError(
  firstPixels: Buffer,
  secondPixels: Buffer
) {
  if (
    firstPixels.length !== secondPixels.length ||
    firstPixels.length % 4 !== 0
  ) {
    throw new Error("Launcher pixel buffers must have matching RGBA lengths");
  }

  let totalDifference = 0;

  for (let offset = 0; offset < firstPixels.length; offset += 4) {
    const firstAlpha = firstPixels[offset + 3] / 255;
    const secondAlpha = secondPixels[offset + 3] / 255;

    for (let channel = 0; channel < 3; channel += 1) {
      const firstPremultiplied = firstPixels[offset + channel] * firstAlpha;
      const secondPremultiplied = secondPixels[offset + channel] * secondAlpha;
      totalDifference += Math.abs(firstPremultiplied - secondPremultiplied);
    }

    totalDifference += Math.abs(firstAlpha - secondAlpha) * 255;
  }

  return totalDifference / (firstPixels.length * 255);
}

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
  resolveImageMagickCommand: (
    runCommand?: (command: string) => { status: number | null }
  ) => string;
  renderLegacyLauncherAssets: (plan: {
    launcherSource: string;
    launcherTargets: Array<{ path: string; size: number }>;
    roundLauncherTargets: Array<{ path: string; size: number }>;
  }) => void;
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
      resolveImageMagickCommand,
    } = await loadBrandSyncModule();
    const sourcePath = "/workspace/frontend/public/logo-source.png";
    const targetPath = "/workspace/android/ic_launcher.png";

    expect([48, 72, 96, 144, 192].map(calculateLegacyLauncherLogoSize)).toEqual(
      [25, 37, 50, 75, 100]
    );

    const probedCommands: string[] = [];
    expect(
      resolveImageMagickCommand((command) => {
        probedCommands.push(command);
        return { status: command === "convert" ? 0 : 1 };
      })
    ).toBe("convert");
    expect(probedCommands).toEqual(["magick", "convert"]);

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

  it("ignores invisible RGB data when comparing rendered launcher pixels", () => {
    const transparentBlack = Buffer.from([0, 0, 0, 0]);
    const transparentWhite = Buffer.from([255, 255, 255, 0]);

    expect(
      calculateNormalizedPremultipliedPixelError(
        transparentBlack,
        transparentWhite
      )
    ).toBe(0);
    expect(
      calculateNormalizedPremultipliedPixelError(
        Buffer.from([0, 0, 0, 255]),
        Buffer.from([255, 255, 255, 255])
      )
    ).toBe(0.75);
  });

  it("keeps committed launcher outputs aligned with freshly rendered assets", async () => {
    const {
      buildFrontendBrandAssetPlan,
      renderLegacyLauncherAssets,
      resolveImageMagickCommand,
    } = await loadBrandSyncModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "brand-sync-launchers-"));
    const isolatedRepoRoot = resolve(tempRoot, "android");
    const frontendPublicDirectory = resolve(tempRoot, "frontend/public");
    const imageMagickCommand = resolveImageMagickCommand();

    try {
      mkdirSync(frontendPublicDirectory, { recursive: true });
      copyFileSync(
        resolve(repoRoot, "tests/fixtures/logo-source.png"),
        resolve(frontendPublicDirectory, "logo-source.png")
      );

      renderLegacyLauncherAssets(buildFrontendBrandAssetPlan(isolatedRepoRoot));

      for (const relativePath of legacyLauncherAssetPaths) {
        const generatedPixels = readDecodedPngPixels(
          imageMagickCommand,
          resolve(isolatedRepoRoot, relativePath)
        );
        const committedPixels = readDecodedPngPixels(
          imageMagickCommand,
          resolve(repoRoot, relativePath)
        );

        const normalizedPixelError = calculateNormalizedPremultipliedPixelError(
          generatedPixels,
          committedPixels
        );

        expect(
          normalizedPixelError,
          `${relativePath} normalized premultiplied pixel error`
        ).toBeLessThanOrEqual(maximumNormalizedPixelError);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("provisions ImageMagick before the CI launcher render test", () => {
    const qualityWorkflow = readFileSync(
      resolve(repoRoot, ".github/workflows/quality.yml"),
      "utf8"
    );
    const installImageMagickIndex = qualityWorkflow.indexOf(
      "sudo apt-get install --yes imagemagick"
    );
    const coverageTestIndex = qualityWorkflow.indexOf(
      "run: npm run test:coverage"
    );

    expect(installImageMagickIndex).toBeGreaterThan(-1);
    expect(installImageMagickIndex).toBeLessThan(coverageTestIndex);
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
