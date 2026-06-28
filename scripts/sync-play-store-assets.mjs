#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourceRoot = resolve(
  process.env.SECPAL_ANDROID_PLAY_ASSETS_SOURCE ?? "~/Downloads/SecPal".replace(/^~(?=\/)/, process.env.HOME ?? "~")
);
const metadataRoot = join(repoRoot, "fastlane", "metadata", "android");

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

function sourcePath(relativePath) {
  return join(sourceRoot, relativePath);
}

function ensureSourceFile(relativePath, description) {
  const path = sourcePath(relativePath);
  if (!existsSync(path)) {
    throw new Error(`Missing ${description}: ${path}`);
  }
  return path;
}

function ensureCleanDirectory(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

async function copyTextAsset(sourceRelativePath, destinationPath) {
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(ensureSourceFile(sourceRelativePath, "text asset"), destinationPath);
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

async function copyLocaleAssets(locale, config) {
  const localeRoot = join(metadataRoot, locale);
  const imagesRoot = join(localeRoot, "images");

  ensureCleanDirectory(localeRoot);
  mkdirSync(imagesRoot, { recursive: true });

  await copyTextAsset(config.title, join(localeRoot, "title.txt"));
  await copyTextAsset(config.shortDescription, join(localeRoot, "short_description.txt"));
  await copyTextAsset(config.fullDescription, join(localeRoot, "full_description.txt"));

  normalizeIcon(
    ensureSourceFile("graphics/app-icon-512.png", "app icon"),
    join(imagesRoot, "icon.png")
  );

  cpSync(
    ensureSourceFile(config.featureGraphic, "feature graphic"),
    join(imagesRoot, "featureGraphic.png")
  );

  for (const [targetDirectory, sourcePrefix] of Object.entries(config.screenshots)) {
    const destinationDirectory = join(imagesRoot, targetDirectory);
    mkdirSync(destinationDirectory, { recursive: true });

    const sourceDirectory = dirname(sourcePath(sourcePrefix));
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
      cpSync(join(sourceDirectory, fileName), join(destinationDirectory, destinationName));
    }
  }
}

async function main() {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Missing source asset root: ${sourceRoot}`);
  }

  mkdirSync(metadataRoot, { recursive: true });

  for (const [locale, config] of Object.entries(localeConfig)) {
    await copyLocaleAssets(locale, config);
  }

  console.log(`Synced Google Play assets into ${metadataRoot}`);
}

await main();
