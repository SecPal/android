#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const defaultRepoRoot = resolve(scriptDirectory, "..");

const launcherForegroundSpecs = [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

const launcherSpecs = [
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
];

const launcherForegroundInsetFactor = 0.52;
const launcherInsetFactor = 0.52;
const splashIconCanvasSize = 512;
const splashIconInsetFactor = 0.32;
const launcherBackgroundColor = "#FFFFFF";

export function buildFrontendBrandAssetPlan(repoRoot = defaultRepoRoot) {
  const frontendPublicDirectory = resolve(repoRoot, "../frontend/public");
  const androidResourceDirectory = resolve(
    repoRoot,
    "android/app/src/main/res"
  );

  return {
    launcherSource: resolve(frontendPublicDirectory, "logo-source.png"),
    splashIconLightSource: resolve(
      frontendPublicDirectory,
      "logo-light-512.png"
    ),
    splashIconDarkSource: resolve(frontendPublicDirectory, "logo-dark-512.png"),
    launcherForegroundTargets: launcherForegroundSpecs.map(
      ([density, size]) => ({
        path: resolve(
          androidResourceDirectory,
          `mipmap-${density}/ic_launcher_foreground.png`
        ),
        size,
      })
    ),
    launcherMonochromeTargets: launcherForegroundSpecs.map(
      ([density, size]) => ({
        path: resolve(
          androidResourceDirectory,
          `mipmap-${density}/ic_launcher_monochrome.png`
        ),
        size,
      })
    ),
    launcherTargets: launcherSpecs.map(([density, size]) => ({
      path: resolve(
        androidResourceDirectory,
        `mipmap-${density}/ic_launcher.png`
      ),
      size,
    })),
    roundLauncherTargets: launcherSpecs.map(([density, size]) => ({
      path: resolve(
        androidResourceDirectory,
        `mipmap-${density}/ic_launcher_round.png`
      ),
      size,
    })),
    splashIconLightTarget: resolve(
      androidResourceDirectory,
      "drawable-nodpi/secpal_splash_icon.png"
    ),
    splashIconDarkTarget: resolve(
      androidResourceDirectory,
      "drawable-night-nodpi/secpal_splash_icon.png"
    ),
    splashIconCanvasSize,
    splashIconLogoSize: Math.round(
      splashIconCanvasSize * splashIconInsetFactor
    ),
  };
}

export function assertFrontendBrandAssetSourcesExist(plan) {
  for (const sourcePath of [
    plan.launcherSource,
    plan.splashIconLightSource,
    plan.splashIconDarkSource,
  ]) {
    if (!existsSync(sourcePath)) {
      throw new Error(
        `Missing canonical frontend brand asset: ${sourcePath}. Ensure the sibling frontend repository is available with the expected public logo assets before running brand:sync.`
      );
    }
  }
}

function ensureMagickAvailable() {
  const result = spawnSync("magick", ["-version"], { stdio: "ignore" });

  if (result.status !== 0) {
    throw new Error(
      "ImageMagick 'magick' is required to sync Android brand assets."
    );
  }
}

function runMagick(argumentsList) {
  const result = spawnSync("magick", argumentsList, { stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error(
      `ImageMagick failed for arguments: ${argumentsList.join(" ")}`
    );
  }
}

function ensureParentDirectory(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function buildLegacyLauncherRenderArguments(
  sourcePath,
  targetPath,
  canvasSize,
  logoSize,
  round
) {
  if (!round) {
    return [
      sourcePath,
      "-trim",
      "+repage",
      "-resize",
      `${logoSize}x${logoSize}`,
      "-background",
      "none",
      "-gravity",
      "center",
      "-extent",
      `${canvasSize}x${canvasSize}`,
      targetPath,
    ];
  }

  const center = canvasSize / 2;

  return [
    "-size",
    `${canvasSize}x${canvasSize}`,
    "xc:none",
    "-fill",
    launcherBackgroundColor,
    "-draw",
    `circle ${center},${center} ${center},0`,
    "(",
    sourcePath,
    "-trim",
    "+repage",
    "-resize",
    `${logoSize}x${logoSize}`,
    ")",
    "-gravity",
    "center",
    "-composite",
    targetPath,
  ];
}

function renderLegacyLauncherLogo(
  sourcePath,
  targetPath,
  canvasSize,
  logoSize,
  round
) {
  ensureParentDirectory(targetPath);
  runMagick(
    buildLegacyLauncherRenderArguments(
      sourcePath,
      targetPath,
      canvasSize,
      logoSize,
      round
    )
  );
}

function renderTransparentSquareLogo(
  sourcePath,
  targetPath,
  canvasSize,
  logoSize
) {
  ensureParentDirectory(targetPath);
  runMagick([
    sourcePath,
    "-trim",
    "+repage",
    "-resize",
    `${logoSize}x${logoSize}`,
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    `${canvasSize}x${canvasSize}`,
    targetPath,
  ]);
}

function renderMonochromeSquareLogo(
  sourcePath,
  targetPath,
  canvasSize,
  logoSize
) {
  ensureParentDirectory(targetPath);
  runMagick([
    sourcePath,
    "-trim",
    "+repage",
    "-resize",
    `${logoSize}x${logoSize}`,
    "-channel",
    "RGB",
    "-evaluate",
    "set",
    "100%",
    "+channel",
    "-background",
    "none",
    "-gravity",
    "center",
    "-extent",
    `${canvasSize}x${canvasSize}`,
    targetPath,
  ]);
}

export function syncFrontendBrandAssets(repoRoot = defaultRepoRoot) {
  const plan = buildFrontendBrandAssetPlan(repoRoot);

  assertFrontendBrandAssetSourcesExist(plan);
  ensureMagickAvailable();

  for (const target of plan.launcherForegroundTargets) {
    renderTransparentSquareLogo(
      plan.launcherSource,
      target.path,
      target.size,
      Math.round(target.size * launcherForegroundInsetFactor)
    );
  }

  for (const target of plan.launcherMonochromeTargets) {
    renderMonochromeSquareLogo(
      plan.launcherSource,
      target.path,
      target.size,
      Math.round(target.size * launcherForegroundInsetFactor)
    );
  }

  for (const target of plan.launcherTargets) {
    renderLegacyLauncherLogo(
      plan.launcherSource,
      target.path,
      target.size,
      Math.round(target.size * launcherInsetFactor),
      false
    );
  }

  for (const target of plan.roundLauncherTargets) {
    renderLegacyLauncherLogo(
      plan.launcherSource,
      target.path,
      target.size,
      Math.round(target.size * launcherInsetFactor),
      true
    );
  }

  renderTransparentSquareLogo(
    plan.splashIconLightSource,
    plan.splashIconLightTarget,
    plan.splashIconCanvasSize,
    plan.splashIconLogoSize
  );

  renderTransparentSquareLogo(
    plan.splashIconDarkSource,
    plan.splashIconDarkTarget,
    plan.splashIconCanvasSize,
    plan.splashIconLogoSize
  );

  return plan;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = syncFrontendBrandAssets();
  console.log(`Synced Android brand assets from ${plan.launcherSource}`);
}
