/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const locales = ["en-US", "de-DE"] as const;

async function loadPlayStoreSyncModule(): Promise<{
  syncPlayStoreAssets: (options?: {
    repoRoot?: string;
    sourceRoot?: string;
  }) => Promise<{ metadataRoot: string }>;
}> {
  // @ts-expect-error The helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/sync-play-store-assets.mjs");
}

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function installFakeMagick(root: string) {
  const binRoot = join(root, "bin");
  const magickPath = join(binRoot, "magick");

  mkdirSync(binRoot, { recursive: true });
  writeFileSync(
    magickPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "-version" ]]; then
  echo "fake-magick"
  exit 0
fi
destination="\${@: -1}"
mkdir -p "$(dirname "$destination")"
source_path=""
for argument in "$@"; do
  if [[ "$argument" != -* && "$argument" != "(" && "$argument" != ")" && -f "$argument" ]]; then
    source_path="$argument"
    break
  fi
done
if [[ -n "$source_path" ]]; then
  cp "$source_path" "$destination"
else
  : > "$destination"
fi
`
  );
  chmodSync(magickPath, 0o755);

  return binRoot;
}

function createPlayAssetSourceTree(root: string) {
  const textFiles = {
    "texts/en-US/title.txt": "SecPal EN",
    "texts/en-US/short-description.txt": "English short description",
    "texts/en-US/full-description.txt": "English full description",
    "texts/de-DE/title.txt": "SecPal DE",
    "texts/de-DE/short-description.txt": "Deutsche Kurzbeschreibung",
    "texts/de-DE/full-description.txt": "Deutsche Vollbeschreibung",
    "graphics/app-icon-512.png": "icon",
    "graphics/feature-graphic-en.png": "feature-en",
    "graphics/feature-graphic-de.png": "feature-de",
    "screenshots/phone/phone-en-1-discovery.png": "phone-en",
    "screenshots/phone/phone-de-1-discovery.png": "phone-de",
    "screenshots/tablet-7/tablet7-en-1-discovery.png": "tablet7-en",
    "screenshots/tablet-7/tablet7-de-1-discovery.png": "tablet7-de",
    "screenshots/tablet-10/tablet10-en-1-discovery.png": "tablet10-en",
    "screenshots/tablet-10/tablet10-de-1-discovery.png": "tablet10-de",
  } as const;

  for (const [relativePath, content] of Object.entries(textFiles)) {
    writeFile(join(root, relativePath), content);
  }
}

describe("Play Store release automation", () => {
  it("preserves committed Play changelogs while refreshing synced locale assets", async () => {
    const { syncPlayStoreAssets } = await loadPlayStoreSyncModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "play-store-sync-"));
    const isolatedRepoRoot = join(tempRoot, "repo");
    const isolatedSourceRoot = join(tempRoot, "source");
    const previousPath = process.env.PATH ?? "";

    try {
      createPlayAssetSourceTree(isolatedSourceRoot);
      process.env.PATH = `${installFakeMagick(tempRoot)}:${previousPath}`;

      for (const locale of locales) {
        const localeRoot = join(
          isolatedRepoRoot,
          "fastlane",
          "metadata",
          "android",
          locale
        );
        writeFile(
          join(localeRoot, "changelogs", "default.txt"),
          `${locale} default changelog`
        );
        writeFile(
          join(localeRoot, "changelogs", "2026062803.txt"),
          `${locale} versioned changelog`
        );
        writeFile(join(localeRoot, "images", "stale.png"), "stale");
      }

      await syncPlayStoreAssets({
        repoRoot: isolatedRepoRoot,
        sourceRoot: isolatedSourceRoot,
      });

      for (const locale of locales) {
        const localeRoot = join(
          isolatedRepoRoot,
          "fastlane",
          "metadata",
          "android",
          locale
        );

        expect(
          readFileSync(join(localeRoot, "changelogs", "default.txt"), "utf8")
        ).toBe(`${locale} default changelog`);
        expect(
          readFileSync(join(localeRoot, "changelogs", "2026062803.txt"), "utf8")
        ).toBe(`${locale} versioned changelog`);
        expect(existsSync(join(localeRoot, "images", "stale.png"))).toBe(false);
        expect(existsSync(join(localeRoot, "images", "icon.png"))).toBe(true);
      }
    } finally {
      process.env.PATH = previousPath;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps direct APK version generation aware of configured and published baselines", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain('require "open-uri"');
    expect(fastfile).toContain("def highest_known_direct_version_code");
    expect(fastfile).toContain("APK_DIRECT_CHANNELS.filter_map");
    expect(fastfile).toContain("direct_channel_metadata_url(channel)");
    expect(fastfile).toContain("configured_release_version_code.to_i");
    expect(fastfile).toContain("highest_known_version_code + 1");
  });
});
