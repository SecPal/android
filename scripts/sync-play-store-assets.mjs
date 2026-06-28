#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(scriptDir, "..");
const defaultSourceRoot = join(defaultRepoRoot, ".local", "play-assets");
const configuredSourceRoot =
  process.env.SECPAL_ANDROID_PLAY_ASSETS_SOURCE?.trim() ?? defaultSourceRoot;

const localeConfig = {
  "en-US": {
    title: "texts/en-US/title.txt",
    shortDescription: "texts/en-US/short-description.txt",
    fullDescription: "texts/en-US/full-description.txt",
    featureGraphic: "graphics/feature-graphic-en.png",
    screenshots: {
      phoneScreenshots: "screenshots/phone/phone-en-",
      sevenInchScreenshots: "screenshots/tablet-7/tablet7-en-",
      tenInchScreenshots: "screenshots/tablet-10/tablet10-en-",
    },
  },
  "de-DE": {
    title: "texts/de-DE/title.txt",
    shortDescription: "texts/de-DE/short-description.txt",
    fullDescription: "texts/de-DE/full-description.txt",
    featureGraphic: "graphics/feature-graphic-de.png",
    screenshots: {
      phoneScreenshots: "screenshots/phone/phone-de-",
      sevenInchScreenshots: "screenshots/tablet-7/tablet7-de-",
      tenInchScreenshots: "screenshots/tablet-10/tablet10-de-",
    },
  },
};

const screenshotNameMap = new Map([
  ["1-discovery.png", "01-discovery.png"],
  ["2-login.png", "02-login.png"],
  ["3-home.png", "03-home.png"],
  ["4-about.png", "04-about.png"],
]);

function sourcePath(root, relativePath) {
  return join(root, relativePath);
}

function ensureSourceFile(root, relativePath, description) {
  const path = sourcePath(root, relativePath);
  if (!existsSync(path)) {
    throw new Error(`Missing ${description}: ${path}`);
  }
  return path;
}

function ensureCleanDirectory(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

async function copyTextAsset(sourcePathname, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePathname, destinationPath);
}

function normalizeIcon(sourcePathname, destinationPathname) {
  const stat = statSync(sourcePathname);
  if (stat.size <= 0) {
    throw new Error(`Icon is empty: ${sourcePathname}`);
  }

  execFileSync(
    "magick",
    [
      sourcePathname,
      "-background",
      "none",
      "-gravity",
      "center",
      "-extent",
      "512x512",
      destinationPathname,
    ],
    { stdio: "inherit" }
  );
}

async function copyLocaleAssets(locale, config, { metadataRoot, sourceRoot }) {
  const localeRoot = join(metadataRoot, locale);
  const imagesRoot = join(localeRoot, "images");

  ensureCleanDirectory(imagesRoot);
  mkdirSync(imagesRoot, { recursive: true });

  await copyTextAsset(
    ensureSourceFile(sourceRoot, config.title, "text asset"),
    join(localeRoot, "title.txt")
  );
  await copyTextAsset(
    ensureSourceFile(sourceRoot, config.shortDescription, "text asset"),
    join(localeRoot, "short_description.txt")
  );
  await copyTextAsset(
    ensureSourceFile(sourceRoot, config.fullDescription, "text asset"),
    join(localeRoot, "full_description.txt")
  );

  normalizeIcon(
    ensureSourceFile(sourceRoot, "graphics/app-icon-512.png", "app icon"),
    join(imagesRoot, "icon.png")
  );

  cpSync(
    ensureSourceFile(sourceRoot, config.featureGraphic, "feature graphic"),
    join(imagesRoot, "featureGraphic.png")
  );

  for (const [targetDirectory, sourcePrefix] of Object.entries(
    config.screenshots
  )) {
    const destinationDirectory = join(imagesRoot, targetDirectory);
    mkdirSync(destinationDirectory, { recursive: true });

    const sourceDirectory = dirname(sourcePath(sourceRoot, sourcePrefix));
    const sourceBasenamePrefix = sourcePrefix.split("/").at(-1);
    const matchingFiles = readdirSync(sourceDirectory)
      .filter((entry) => entry.startsWith(sourceBasenamePrefix))
      .sort();

    if (matchingFiles.length === 0) {
      throw new Error(`No screenshots matched ${sourcePrefix}`);
    }

    for (const fileName of matchingFiles) {
      const suffix = fileName.slice(sourceBasenamePrefix.length);
      const destinationName = screenshotNameMap.get(suffix) ?? fileName;
      cpSync(
        join(sourceDirectory, fileName),
        join(destinationDirectory, destinationName)
      );
    }
  }
}

export async function syncPlayStoreAssets(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? defaultRepoRoot);
  const sourceRoot = resolve(options.sourceRoot ?? configuredSourceRoot);
  const metadataRoot = join(repoRoot, "fastlane", "metadata", "android");

  if (!existsSync(sourceRoot)) {
    throw new Error(
      `Missing source asset root: ${sourceRoot}. Place the curated Play assets there or override it with SECPAL_ANDROID_PLAY_ASSETS_SOURCE.`
    );
  }

  mkdirSync(metadataRoot, { recursive: true });

  for (const [locale, config] of Object.entries(localeConfig)) {
    await copyLocaleAssets(locale, config, { metadataRoot, sourceRoot });
  }

  return { metadataRoot };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { metadataRoot } = await syncPlayStoreAssets();
  console.log(`Synced Google Play assets into ${metadataRoot}`);
}
