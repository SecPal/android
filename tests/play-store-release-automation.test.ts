/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
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

async function loadAndroidRuntimeSchemaVerifierModule(): Promise<{
  verifyAndroidRuntimeSchemaArtifact: (
    artifactPath: string,
    stringsXmlPath: string
  ) => void;
}> {
  // @ts-expect-error The helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/verify-android-runtime-schema.mjs");
}

async function loadNativeAuthBridgeInjectorModule(): Promise<{
  buildNativeAuthBridgeBootstrapScript: (apiBaseUrl: string) => string;
}> {
  // @ts-expect-error The helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/inject-native-auth-bridge.mjs");
}

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createZipFixture(
  root: string,
  archiveName: string,
  entryRoot: string,
  indexSegments: readonly string[],
  indexHtml: string
) {
  const artifactPath = join(root, archiveName);
  writeFile(join(root, ...indexSegments, "index.html"), indexHtml);
  const zipResult = spawnSync("zip", ["-q", "-r", artifactPath, entryRoot], {
    cwd: root,
    encoding: "utf8",
  });
  const failureDetails =
    zipResult.error?.message ||
    zipResult.stderr.trim() ||
    `zip exited with status ${zipResult.status ?? "unknown"}`;
  expect(zipResult.status, failureDetails).toBe(0);
  return artifactPath;
}

function writePngHeader(
  path: string,
  width: number,
  height: number,
  colorType = 2
) {
  const buffer = Buffer.alloc(26);

  buffer[0] = 0x89;
  buffer[1] = 0x50;
  buffer[2] = 0x4e;
  buffer[3] = 0x47;
  buffer[4] = 0x0d;
  buffer[5] = 0x0a;
  buffer[6] = 0x1a;
  buffer[7] = 0x0a;
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = colorType;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

function createValidPlayMetadataTree(root: string) {
  for (const locale of locales) {
    const localeRoot = join(root, locale);
    const imagesRoot = join(localeRoot, "images");

    writeFile(join(localeRoot, "title.txt"), "SecPal");
    writeFile(join(localeRoot, "short_description.txt"), "Secure operations");
    writeFile(join(localeRoot, "full_description.txt"), "Secure operations");
    writeFile(join(localeRoot, "changelogs", "default.txt"), "Release notes");
    writePngHeader(join(imagesRoot, "icon.png"), 512, 512, 6);
    writePngHeader(join(imagesRoot, "featureGraphic.png"), 1024, 500, 2);

    for (let index = 1; index <= 4; index += 1) {
      writePngHeader(
        join(imagesRoot, "phoneScreenshots", `${index}.png`),
        1080,
        1920,
        2
      );
    }

    writePngHeader(
      join(imagesRoot, "sevenInchScreenshots", "1.png"),
      1920,
      1080,
      2
    );
    writePngHeader(
      join(imagesRoot, "tenInchScreenshots", "1.png"),
      1920,
      1080,
      2
    );
  }
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

  it("falls back to stripped screenshot suffixes for unmapped Play asset names", async () => {
    const { syncPlayStoreAssets } = await loadPlayStoreSyncModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "play-store-sync-"));
    const isolatedRepoRoot = join(tempRoot, "repo");
    const isolatedSourceRoot = join(tempRoot, "source");
    const previousPath = process.env.PATH ?? "";

    try {
      createPlayAssetSourceTree(isolatedSourceRoot);
      writeFile(
        join(
          isolatedSourceRoot,
          "screenshots",
          "phone",
          "phone-en-5-settings.png"
        ),
        "phone-en-settings"
      );
      process.env.PATH = `${installFakeMagick(tempRoot)}:${previousPath}`;

      await syncPlayStoreAssets({
        repoRoot: isolatedRepoRoot,
        sourceRoot: isolatedSourceRoot,
      });

      expect(
        existsSync(
          join(
            isolatedRepoRoot,
            "fastlane",
            "metadata",
            "android",
            "en-US",
            "images",
            "phoneScreenshots",
            "5-settings.png"
          )
        )
      ).toBe(true);
      expect(
        existsSync(
          join(
            isolatedRepoRoot,
            "fastlane",
            "metadata",
            "android",
            "en-US",
            "images",
            "phoneScreenshots",
            "phone-en-5-settings.png"
          )
        )
      ).toBe(false);
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
    expect(fastfile).toContain("configured_release_version_code_value");
    expect(fastfile).toContain("highest_known_android_version_code");
    expect(fastfile).toContain("highest_known_version_code + 1");
  });

  it("keeps generated Android version codes monotonic across Play and direct APK releases", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain("def highest_known_android_version_code");
    expect(fastfile).toMatch(
      /def next_deploy_version_code[\s\S]*highest_known_android_version_code\([\s\S]*json_key_path: json_key_path[\s\S]*\)/
    );
    expect(fastfile).toMatch(
      /def next_direct_deploy_version_code[\s\S]*highest_known_android_version_code\([\s\S]*json_key_path: play_json_key_path[\s\S]*\)/
    );
    expect(fastfile).toContain("persist_configured_release_version_code!");
  });

  it("parses shell-compatible release env assignments before using the configured version baseline", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain("def release_env_assignment_value");
    expect(fastfile).toContain(
      "line.match(/\\A(?:export\\s+)?#{Regexp.escape(key)}=(.*)\\z/)"
    );
    expect(fastfile).toContain("Shellwords.split");
  });

  it("keeps direct APK metadata aligned with the actual signing key and latest checksum name", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain("def direct_signing_certificate_sha256");
    expect(fastfile).toContain('"apksigner"');
    expect(fastfile).toMatch(
      /app_signing_certificate_sha256:\s+release_available\s+\?\s+direct_signing_certificate_sha256\s+:\s+nil/
    );
    expect(fastfile).not.toContain('"keytool"');
    expect(fastfile).not.toContain('"SECPAL_ANDROID_KEYSTORE_PASSWORD"');
    expect(fastfile).not.toContain('"SECPAL_ANDROID_KEY_PASSWORD"');
    expect(fastfile).toContain("SHA256SUMS-latest.txt");
    expect(fastfile).toContain("SHA256SUMS.next.txt");
    expect(fastfile).toContain("app.secpal-latest.next.apk");
    expect(fastfile).toContain("safely_replace_remote_latest_files!(");
  });

  it("can withdraw every unsupported direct APK channel without signing credentials", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    );

    expect(packageJson.scripts["fastlane:android:withdraw:direct-apks"]).toBe(
      "bundle exec fastlane android withdraw_direct_apks"
    );
    expect(fastfile).toContain("def withdraw_direct_apk_channels!");
    expect(fastfile).toContain("APK_DIRECT_CHANNELS.flat_map");
    expect(fastfile).toContain(
      "def direct_unavailable_latest_metadata_document("
    );
    expect(fastfile).toContain("safely_replace_remote_metadata!");
    expect(fastfile).toContain("rescue StandardError => upload_error");
    expect(fastfile).toContain("Failed to clean staged withdrawal metadata");
    expect(fastfile).toContain("recover_interrupted_remote_metadata!");
    expect(fastfile).toContain("quarantine_direct_apk_artifacts!");
    expect(fastfile).toContain("ensure_non_public_withdrawal_root!");
    expect(fastfile).toContain("alias_path: true");
    expect(fastfile).toContain("lane :withdraw_direct_apks do");
    expect(fastfile).toMatch(
      /latest_apk_url:\s+release_available\s+\?\s+urls\.fetch\(:latest_apk_url\)\s+:\s+nil/
    );
    expect(fastfile).toMatch(
      /checksum_url:\s+release_available\s+\?\s+urls\.fetch\(:checksum_url\)\s+:\s+nil/
    );
    expect(fastfile).toMatch(
      /app_signing_certificate_sha256:\s+release_available\s+\?\s+direct_signing_certificate_sha256\s+:\s+nil/
    );
    expect(fastfile).toMatch(
      /signing_key_shared_with_google_play:\s+release_available\s+\?\s+APK_SIGNING_KEY_SHARED_WITH_GOOGLE_PLAY\s+:\s+nil/
    );
  });

  it("withdraws direct APK files into quarantine and publishes non-downloadable metadata", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "direct-apk-withdrawal-"));
    const publicRoot = join(tempRoot, "public");
    const quarantineRoot = join(tempRoot, "quarantine");
    const androidRoot = join(publicRoot, "android");
    const versions = ["0.0.1-261932118", "0.0.1-261932119"] as const;
    const latestRoots = [
      join(androidRoot, "stable"),
      androidRoot,
      join(androidRoot, "beta"),
    ] as const;
    const rubyAdapter = `
require "fileutils"
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
def sh(*arguments)
  case arguments.first
  when "scp"
    FileUtils.cp(arguments.fetch(1), arguments.fetch(2).split(":", 2).fetch(1))
  when "ssh"
    raise "remote command must be a single SSH argument" unless arguments.length == 3
    system(arguments.drop(2).join(" "), exception: true)
  else
    raise "Unsupported command: #{arguments.inspect}"
  end
end
withdraw_direct_apk_channels!
`;

    try {
      for (const root of latestRoots) {
        writeFile(join(root, "app.secpal-latest.apk"), "schema-3-apk");
        writeFile(join(root, "SHA256SUMS.txt"), "schema-3-checksum");
        writeFile(join(root, "latest.json"), '{"release_available":true}');
      }
      writeFile(
        join(androidRoot, "SHA256SUMS.versioned.txt"),
        "schema-3-checksum"
      );
      for (const version of versions) {
        writeFile(
          join(androidRoot, "releases", version, `app.secpal-${version}.apk`),
          "schema-3-apk"
        );
        writeFile(
          join(androidRoot, "releases", version, "metadata.json"),
          '{"release_available":true}'
        );
      }

      // Simulate an interrupted earlier metadata transaction. A new run must
      // recover it before staging the next transaction.
      writeFile(
        join(androidRoot, "stable", "latest.json.previous"),
        '{"release_available":true,"recovered":true}'
      );

      const result = spawnSync("ruby", ["-e", rubyAdapter], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_ANDROID_DIRECT_ROOT: publicRoot,
          SECPAL_ANDROID_DIRECT_WITHDRAWAL_ROOT: quarantineRoot,
          SECPAL_ANDROID_WITHDRAW_VERSIONS: versions.join(","),
          SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
        },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);

      for (const [index, root] of latestRoots.entries()) {
        const metadata = JSON.parse(
          readFileSync(join(root, "latest.json"), "utf8")
        );
        expect(metadata).toMatchObject({
          package_name: "app.secpal",
          update_channel: index === 2 ? "beta" : "stable",
          release_available: false,
          version: null,
          latest_apk_url: null,
          checksum_url: null,
        });
        expect(existsSync(join(root, "app.secpal-latest.apk"))).toBe(false);
        expect(existsSync(join(root, "SHA256SUMS.txt"))).toBe(false);
        expect(existsSync(`${join(root, "latest.json")}.previous`)).toBe(false);
        expect(existsSync(`${join(root, "latest.json")}.next`)).toBe(false);
      }
      expect(existsSync(join(androidRoot, "SHA256SUMS.versioned.txt"))).toBe(
        false
      );
      for (const version of versions) {
        expect(existsSync(join(androidRoot, "releases", version))).toBe(false);
      }

      const quarantinedFiles = spawnSync(
        "find",
        [quarantineRoot, "-type", "f"],
        { encoding: "utf8" }
      ).stdout;
      expect(quarantinedFiles).toContain("app.secpal-latest.apk");
      expect(quarantinedFiles).toContain("app.secpal-0.0.1-261932118.apk");
      expect(quarantinedFiles).toContain("app.secpal-0.0.1-261932119.apk");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("recovers an interrupted metadata transaction before a failed new upload", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "direct-apk-recovery-"));
    const publicRoot = join(tempRoot, "public");
    const androidRoot = join(publicRoot, "android");
    const stableMetadataPath = join(androidRoot, "stable", "latest.json");
    const recoveredMetadata = '{"release_available":true,"recovered":true}';
    const rubyAdapter = `
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
def sh(*arguments)
  case arguments.first
  when "scp"
    raise "injected upload failure"
  when "ssh"
    raise "remote command must be a single SSH argument" unless arguments.length == 3
    system(arguments.drop(2).join(" "), exception: true)
  else
    raise "Unsupported command"
  end
end
withdraw_direct_apk_channels!
`;

    try {
      writeFile(stableMetadataPath, '{"release_available":false}');
      writeFile(`${stableMetadataPath}.previous`, recoveredMetadata);
      writeFile(join(androidRoot, "latest.json"), '{"release_available":true}');
      writeFile(
        join(androidRoot, "beta", "latest.json"),
        '{"release_available":true}'
      );

      const result = spawnSync("ruby", ["-e", rubyAdapter], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_ANDROID_DIRECT_ROOT: publicRoot,
          SECPAL_ANDROID_DIRECT_WITHDRAWAL_ROOT: join(tempRoot, "quarantine"),
          SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("injected upload failure");
      expect(readFileSync(stableMetadataPath, "utf8")).toBe(recoveredMetadata);
      expect(existsSync(`${stableMetadataPath}.previous`)).toBe(false);
      expect(existsSync(`${stableMetadataPath}.next`)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a withdrawal quarantine inside the public artifact root", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "direct-apk-quarantine-"));
    const publicRoot = join(tempRoot, "public");
    const stableMetadataPath = join(
      publicRoot,
      "android",
      "stable",
      "latest.json"
    );
    const originalMetadata = '{"release_available":true}';
    const rubyAdapter = `
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
withdraw_direct_apk_channels!
`;

    try {
      writeFile(stableMetadataPath, originalMetadata);
      const result = spawnSync("ruby", ["-e", rubyAdapter], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_ANDROID_DIRECT_ROOT: publicRoot,
          SECPAL_ANDROID_DIRECT_WITHDRAWAL_ROOT: join(publicRoot, "withdrawn"),
          SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "must be outside the public artifact root"
      );
      expect(readFileSync(stableMetadataPath, "utf8")).toBe(originalMetadata);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reads canonical runtime bridges from packaged APK and AAB locations", async () => {
    const { verifyAndroidRuntimeSchemaArtifact } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const { buildNativeAuthBridgeBootstrapScript } =
      await loadNativeAuthBridgeInjectorModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-schema-"));
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const canonicalRuntimeBridge =
      buildNativeAuthBridgeBootstrapScript(apiBaseUrl);
    const canonicalIndexHtml = `<!doctype html><html><head><script id="secpal-native-auth-bridge-bootstrap">${canonicalRuntimeBridge}</script><script type="module" src="/assets/index.js"></script></head></html>`;

    try {
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );
      const apkPath = createZipFixture(
        tempRoot,
        "canonical.apk",
        "assets",
        ["assets", "public"],
        canonicalIndexHtml
      );
      const aabPath = createZipFixture(
        tempRoot,
        "canonical.aab",
        "base",
        ["base", "assets", "public"],
        canonicalIndexHtml
      );

      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(apkPath, stringsXmlPath)
      ).not.toThrow();
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(aabPath, stringsXmlPath)
      ).not.toThrow();

      const ambiguousAabRoot = join(tempRoot, "ambiguous-aab");
      const ambiguousAabPath = createZipFixture(
        ambiguousAabRoot,
        "ambiguous.aab",
        "base",
        ["base", "assets", "public"],
        canonicalIndexHtml.replace(
          "currentBootstrapSchemaVersion = 4",
          "currentBootstrapSchemaVersion = 3"
        )
      );
      writeFile(
        join(ambiguousAabRoot, "assets", "public", "index.html"),
        canonicalIndexHtml
      );
      const appendResult = spawnSync(
        "zip",
        ["-q", "-r", ambiguousAabPath, "assets"],
        { cwd: ambiguousAabRoot, encoding: "utf8" }
      );
      expect(
        appendResult.status,
        appendResult.error?.message || appendResult.stderr
      ).toBe(0);
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(ambiguousAabPath, stringsXmlPath)
      ).toThrow(/exactly one .* runtime index/i);

      for (const [name, extension, entryRoot, indexSegments, expectedPath] of [
        [
          "apk-with-aab-path",
          "apk",
          "base",
          ["base", "assets", "public"],
          "assets/public",
        ],
        [
          "aab-with-apk-path",
          "aab",
          "assets",
          ["assets", "public"],
          "base/assets/public",
        ],
      ] as const) {
        const misplacedArtifact = createZipFixture(
          join(tempRoot, name),
          `${name}.${extension}`,
          entryRoot,
          indexSegments,
          canonicalIndexHtml
        );
        expect(() =>
          verifyAndroidRuntimeSchemaArtifact(misplacedArtifact, stringsXmlPath)
        ).toThrow(new RegExp(expectedPath));
      }

      const expectInvalidArtifact = (
        name: string,
        indexHtml: string,
        expectedError: RegExp
      ) => {
        const artifactPath = createZipFixture(
          join(tempRoot, name),
          `${name}.apk`,
          "assets",
          ["assets", "public"],
          indexHtml
        );
        expect(() =>
          verifyAndroidRuntimeSchemaArtifact(artifactPath, stringsXmlPath)
        ).toThrow(expectedError);
      };
      expectInvalidArtifact(
        "obsolete",
        canonicalIndexHtml.replace(
          "currentBootstrapSchemaVersion = 4",
          "currentBootstrapSchemaVersion = 3"
        ),
        /must declare schema 4 independently/i
      );
      expectInvalidArtifact(
        "hardcoded-schema",
        canonicalIndexHtml.replace(
          "schema_version: currentBootstrapSchemaVersion",
          "schema_version: 4"
        ),
        /must declare schema 4 independently/i
      );
      expectInvalidArtifact(
        "mutated-bridge",
        canonicalIndexHtml.replace(
          apiBaseUrl,
          "https://unexpected-runtime.secpal.dev"
        ),
        /does not contain the canonical schema 4 runtime bridge/i
      );
      expectInvalidArtifact(
        "duplicate",
        canonicalIndexHtml.replace(
          "</head>",
          '<script data-copy id="secpal-native-auth-bridge-bootstrap"></script></head>'
        ),
        /exactly one injected Android runtime bridge/i
      );
      expectInvalidArtifact(
        "non-canonical-tag",
        canonicalIndexHtml.replace(
          '<script id="secpal-native-auth-bridge-bootstrap">',
          '<script data-runtime id="secpal-native-auth-bridge-bootstrap">'
        ),
        /non-canonical Android runtime bridge tag/i
      );
      expectInvalidArtifact(
        "commented-bridge",
        canonicalIndexHtml.replace(
          `<script id="secpal-native-auth-bridge-bootstrap">${canonicalRuntimeBridge}</script>`,
          `<!--<script id="secpal-native-auth-bridge-bootstrap">${canonicalRuntimeBridge}</script>-->`
        ),
        /exactly one injected Android runtime bridge/i
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports missing and corrupt artifacts as inspection failures", async () => {
    const { verifyAndroidRuntimeSchemaArtifact } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-schema-"));
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const missingArtifactPath = join(tempRoot, "missing.apk");
    const corruptArtifactPath = join(tempRoot, "corrupt.aab");

    try {
      writeFile(
        stringsXmlPath,
        '<resources><string name="api_base_url">https://runtime-bootstrap-required.secpal.dev</string></resources>'
      );
      writeFile(corruptArtifactPath, "not a zip archive");

      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(missingArtifactPath, stringsXmlPath)
      ).toThrow(/Unable to inspect .*missing\.apk/i);
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(corruptArtifactPath, stringsXmlPath)
      ).toThrow(/Unable to inspect .*corrupt\.aab/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps latest artifact swaps rollback-safe when remote renames fail", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain("def safely_replace_remote_latest_files!");
    expect(fastfile).toContain("app.secpal-latest.previous.apk");
    expect(fastfile).toContain("SHA256SUMS.previous.txt");
    expect(fastfile).toContain("cleanup() {");
    expect(fastfile).toContain("rollback() {");
    expect(fastfile).toContain('mv "$latest_apk_path" "$previous_apk_path"');
    expect(fastfile).toContain('mv "$next_checksum_path" "$checksum_path"');
    expect(fastfile).toContain('mv "$previous_apk_path" "$latest_apk_path"');
  });

  it("fails closed when direct-release metadata cannot be read", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain(
      "Failed to resolve the highest known direct APK version code"
    );
    expect(fastfile).not.toContain(
      "Skipping direct APK channel '#{channel}' while resolving the next version code"
    );
  });

  it("accepts valid landscape Play screenshots without aspect-ratio warnings", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "play-store-validate-"));

    try {
      createValidPlayMetadataTree(tempRoot);

      const result = spawnSync(
        "node",
        [resolve(repoRoot, "scripts", "validate-play-store-assets.mjs")],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            SECPAL_ANDROID_PLAY_METADATA_PATH: tempRoot,
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("PLAY_ASSET_VALIDATION_OK");
      expect(result.stdout).not.toContain("not close to 9:16 or 16:9");
      expect(result.stderr).not.toContain("not close to 9:16 or 16:9");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects Play preview assets that contain alpha channels", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "play-store-validate-"));

    try {
      createValidPlayMetadataTree(tempRoot);
      writePngHeader(
        join(tempRoot, "en-US", "images", "featureGraphic.png"),
        1024,
        500,
        6
      );

      const result = spawnSync(
        "node",
        [resolve(repoRoot, "scripts", "validate-play-store-assets.mjs")],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            SECPAL_ANDROID_PLAY_METADATA_PATH: tempRoot,
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("must not contain an alpha channel");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects screenshots whose longest side exceeds twice the shortest side", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "play-store-validate-"));

    try {
      createValidPlayMetadataTree(tempRoot);
      writePngHeader(
        join(tempRoot, "en-US", "images", "phoneScreenshots", "1.png"),
        1080,
        2408,
        2
      );
      writePngHeader(
        join(tempRoot, "en-US", "images", "phoneScreenshots", "2.png"),
        1080,
        2408,
        2
      );

      const result = spawnSync(
        "node",
        [resolve(repoRoot, "scripts", "validate-play-store-assets.mjs")],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            SECPAL_ANDROID_PLAY_METADATA_PATH: tempRoot,
          },
          encoding: "utf8",
        }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("must not exceed a 2:1 aspect ratio");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
