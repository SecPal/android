#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const metadataRoot = resolve(
  process.env.SECPAL_ANDROID_PLAY_METADATA_PATH ??
    join(repoRoot, "fastlane", "metadata", "android")
);

const screenshotSets = {
  phoneScreenshots: { min: 2, max: 8, promoteMin1080: 4 },
  sevenInchScreenshots: { min: 1, max: 8 },
  tenInchScreenshots: { min: 1, max: 8 },
};

const locales = ["en-US", "de-DE"];
const errors = [];
const warnings = [];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function readImageInfo(path) {
  const buffer = readFileSync(path);
  const sizeBytes = statSync(path).size;

  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      format: "png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      sizeBytes,
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1];
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        return {
          format: "jpeg",
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
          sizeBytes,
        };
      }

      if (marker === 0xd9 || marker === 0xda) {
        break;
      }

      const segmentLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }
  }

  throw new Error(`Unsupported image format: ${path}`);
}

function validateTextFile(path, label, maxLength) {
  const text = readFileSync(path, "utf8").trim();
  if (text.length === 0) {
    addError(`${label} is empty: ${path}`);
  }
  if (text.length > maxLength) {
    addError(`${label} exceeds ${maxLength} characters: ${path}`);
  }
}

function validateAspectRatio(path, width, height) {
  const portraitRatio = width / height;
  const landscapeRatio = height / width;
  const exactPortrait = 9 / 16;
  const exactLandscape = 16 / 9;
  const tolerance = 0.02;

  if (
    Math.abs(portraitRatio - exactPortrait) > tolerance &&
    Math.abs(landscapeRatio - exactLandscape) > tolerance
  ) {
    addWarning(
      `Screenshot aspect ratio is not close to 9:16 or 16:9: ${path} (${width}x${height})`
    );
  }
}

function validateScreenshotSet(directory, label, rules) {
  const files = readdirSync(directory)
    .filter((entry) => /\.(png|jpe?g)$/i.test(entry))
    .sort();

  if (files.length < rules.min || files.length > rules.max) {
    addError(
      `${label} requires ${rules.min}-${rules.max} images, found ${files.length}: ${directory}`
    );
  }

  let imagesAt1080 = 0;

  for (const file of files) {
    const path = join(directory, file);
    const { width, height, sizeBytes } = readImageInfo(path);

    if (sizeBytes > 8 * 1024 * 1024) {
      addError(`${label} exceeds 8 MB: ${path}`);
    }
    if (width < 320 || height < 320 || width > 3840 || height > 3840) {
      addError(
        `${label} must stay within 320-3840 px per side: ${path} (${width}x${height})`
      );
    }
    if (Math.min(width, height) >= 1080) {
      imagesAt1080 += 1;
    }

    validateAspectRatio(path, width, height);
  }

  if (rules.promoteMin1080 && imagesAt1080 < rules.promoteMin1080) {
    addError(
      `${label} needs at least ${rules.promoteMin1080} screenshots with both sides >= 1080 px for promotion eligibility: ${directory}`
    );
  }
}

for (const locale of locales) {
  const localeRoot = join(metadataRoot, locale);
  const imagesRoot = join(localeRoot, "images");

  validateTextFile(join(localeRoot, "title.txt"), `${locale} title`, 30);
  validateTextFile(
    join(localeRoot, "short_description.txt"),
    `${locale} short description`,
    80
  );
  validateTextFile(
    join(localeRoot, "full_description.txt"),
    `${locale} full description`,
    4000
  );
  validateTextFile(
    join(localeRoot, "changelogs", "default.txt"),
    `${locale} default changelog`,
    500
  );

  const icon = readImageInfo(join(imagesRoot, "icon.png"));
  if (icon.width !== 512 || icon.height !== 512) {
    addError(`${locale} icon must be 512x512: ${join(imagesRoot, "icon.png")}`);
  }
  if (icon.sizeBytes > 1024 * 1024) {
    addError(`${locale} icon exceeds 1 MB: ${join(imagesRoot, "icon.png")}`);
  }

  const feature = readImageInfo(join(imagesRoot, "featureGraphic.png"));
  if (feature.width !== 1024 || feature.height !== 500) {
    addError(
      `${locale} feature graphic must be 1024x500: ${join(imagesRoot, "featureGraphic.png")}`
    );
  }
  if (feature.sizeBytes > 15 * 1024 * 1024) {
    addError(
      `${locale} feature graphic exceeds 15 MB: ${join(imagesRoot, "featureGraphic.png")}`
    );
  }

  for (const [directoryName, rules] of Object.entries(screenshotSets)) {
    validateScreenshotSet(
      join(imagesRoot, directoryName),
      `${locale} ${directoryName}`,
      rules
    );
  }
}

if (errors.length > 0) {
  console.error("PLAY_ASSET_VALIDATION_FAILED");
  for (const error of errors) {
    console.error(`ERROR: ${error}`);
  }
  for (const warning of warnings) {
    console.error(`WARNING: ${warning}`);
  }
  process.exit(1);
}

console.log("PLAY_ASSET_VALIDATION_OK");
for (const warning of warnings) {
  console.log(`WARNING: ${warning}`);
}
