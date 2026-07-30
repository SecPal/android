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
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error The helper intentionally remains a Node-executable .mjs script.
import { writeAndroidWebAssetInventory } from "../scripts/android-web-asset-inventory.mjs";

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
  verifyAndroidRuntimeSchemaIndex: (
    indexHtmlPath: string,
    stringsXmlPath: string
  ) => void;
  verifyAndroidRuntimeSchemaDirectory: (
    assetRoot: string,
    stringsXmlPath: string,
    fallbackInventoryPath?: string
  ) => void;
}> {
  // @ts-expect-error The helper intentionally remains a Node-executable .mjs script.
  return import("../scripts/verify-android-runtime-schema.mjs");
}

async function loadNativeAuthBridgeInjectorModule(): Promise<{
  buildNativeAuthBridgeBootstrapScript: (apiBaseUrl: string) => string;
  injectNativeAuthBridgeIntoFile: (
    indexHtmlPath: string,
    stringsXmlPath: string
  ) => void;
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
  indexHtml: string,
  assets: string[] | Record<string, string> | false = ["assets/index.js"],
  inventoryMutation: {
    remove?: readonly string[];
    write?: Readonly<Record<string, string>>;
  } = {}
) {
  const artifactPath = join(root, archiveName);
  const assetRoot = join(root, ...indexSegments);
  writeFile(join(assetRoot, "index.html"), indexHtml);
  if (assets !== false) {
    const assetEntries = Array.isArray(assets)
      ? assets.map((assetPath) => [assetPath, ""] as const)
      : Object.entries(assets);
    for (const [assetPath, content] of assetEntries) {
      writeFile(join(assetRoot, ...assetPath.split("/")), content);
    }
  }
  writeAndroidWebAssetInventory(assetRoot);
  for (const assetPath of inventoryMutation.remove ?? []) {
    rmSync(join(assetRoot, ...assetPath.split("/")), { force: true });
  }
  for (const [assetPath, content] of Object.entries(
    inventoryMutation.write ?? {}
  )) {
    writeFile(join(assetRoot, ...assetPath.split("/")), content);
  }
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

function buildAndroidRuntimeIndexHtml(runtimeBridge?: string) {
  const runtimeScript = runtimeBridge
    ? `<script id="secpal-native-auth-bridge-bootstrap">${runtimeBridge}</script>`
    : "";

  return `<!doctype html><html><head>${runtimeScript}<script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`;
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
    expect(fastfile).toContain("def direct_channel_version_code");
    expect(fastfile).toContain("direct_channels: APK_DIRECT_CHANNELS");
    expect(fastfile).toContain("direct_channel_metadata_url(channel)");
    expect(fastfile).toContain("configured_last_published_version_code_value");
    expect(fastfile).toContain("collect_known_android_version_codes!");
    expect(fastfile).toContain("SecPalAndroidVersioning.next_version_code");
  });

  it("keeps generated Android version codes monotonic across Play and direct APK releases", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain("def with_selected_publish_version_code");
    expect(fastfile).toContain("collect_known_android_version_codes!");
    expect(fastfile).toContain("play_tracks: PLAY_VERSION_CODE_TRACKS");
    expect(fastfile).toContain("direct_channels: APK_DIRECT_CHANNELS");
    expect(fastfile).toContain("persist_last_published_version_code!");
    expect(fastfile).not.toContain("Time.now.utc.strftime");
  });

  it("rejects reuse of withdrawn direct APK version codes without external release state", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain(
      "RETIRED_ANDROID_VERSION_CODE_FLOOR = 261_932_119"
    );
    expect(fastfile).toContain(
      'known_codes["retired schema-3 floor"] = RETIRED_ANDROID_VERSION_CODE_FLOOR'
    );
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
    expect(fastfile).toMatch(
      /release_env_assignment_value\(\s*"SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE"\s*\)/
    );
    expect(fastfile).toContain(
      "SecPalAndroidRelease.resolve_last_published_version_code"
    );
    expect(fastfile).toContain("environment: ENV");
  });

  it("requires explicit codes for build-only lanes and locks every publishing lane", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toMatch(
      /lane :build_signed_apk[\s\S]*require_signed_build_version_code!\("build_signed_apk"\)/
    );
    expect(fastfile).toMatch(
      /lane :build_signed_aab[\s\S]*require_signed_build_version_code!\("build_signed_aab"\)/
    );
    expect(fastfile).toContain("SecPalAndroidPublishLock.with_lock");
    expect(fastfile).toContain(
      "SecPalAndroidPublishLock.release_paths(environment: ENV)"
    );
    expect(fastfile).not.toContain('"~/.config/secpal/android-publish.lock"');
    expect(
      fastfile.match(/^\s+with_selected_publish_version_code\(lane:/gm)
    ).toHaveLength(4);
  });

  it("keeps allocation, upload, persistence, and cleanup inside one publishing lock", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "secpal-fastlane-publish-flow-")
    );
    const releaseEnvPath = join(tempRoot, "android-release.env");
    const playKeyPath = join(tempRoot, "google-play.json");
    const eventsPath = join(tempRoot, "events.txt");
    const rubyAdapter = `
module UI
  module_function

  def user_error!(message)
    raise message
  end

  def message(*) = nil
  def important(*) = nil
end

$secpal_test_lanes = {}
def default_platform(*) = nil
def desc(*) = nil
def platform(*)
  yield
end
def lane(name, &block)
  $secpal_test_lanes[name] = block
end

load ENV.fetch("SECPAL_TEST_FASTFILE")

class << Time
  def now
    Time.utc(2026, 7, 22, 12, 0, 0)
  end
end

def google_play_track_version_codes(**)
  [2_026_072_208]
end

def direct_channel_version_code(_channel)
  2_026_072_207
end

alias secpal_test_persist_last_published_version_code! persist_last_published_version_code!

def record_publish_stage(stage)
  unless ENV["SECPAL_ANDROID_VERSION_CODE"] == "2026072210"
    raise "#{stage} observed the wrong temporary build code"
  end

  begin
    SecPalAndroidPublishLock.with_lock(PUBLISH_LOCK_FILE) {}
  rescue SecPalAndroidPublishLock::LockUnavailableError
    File.open(ENV.fetch("SECPAL_TEST_EVENTS"), "a") { |file| file.puts(stage) }
    return
  end

  raise "#{stage} ran without the publishing lock"
end

def build_signed_aab
  record_publish_stage("build")
end

def upload_to_play_store(**)
  record_publish_stage("upload")
end

def persist_last_published_version_code!(version_code)
  record_publish_stage("persist")
  secpal_test_persist_last_published_version_code!(version_code)
end

$secpal_test_lanes.fetch(:deploy_internal).call
raise "temporary build code leaked" if ENV.key?("SECPAL_ANDROID_VERSION_CODE")

lock_reacquired = false
SecPalAndroidPublishLock.with_lock(PUBLISH_LOCK_FILE) do
  lock_reacquired = true
end
raise "publishing lock was not released" unless lock_reacquired

puts File.read(ENV.fetch("SECPAL_ANDROID_RELEASE_ENV_FILE"))
`;
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE: "2026072204",
      SECPAL_ANDROID_PLAY_JSON_KEY_PATH: playKeyPath,
      SECPAL_ANDROID_RELEASE_ENV_FILE: releaseEnvPath,
      SECPAL_TEST_EVENTS: eventsPath,
      SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
    };
    delete environment.SECPAL_ANDROID_DEPLOY_VERSION_CODE;
    delete environment.SECPAL_ANDROID_VERSION_CODE;
    delete environment.SECPAL_ANDROID_VERSION_NAME;

    try {
      writeFileSync(
        releaseEnvPath,
        "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE=2026072209\n"
      );
      writeFileSync(playKeyPath, "{}\n");
      chmodSync(releaseEnvPath, 0o600);
      chmodSync(playKeyPath, 0o600);

      const result = spawnSync(
        "bash",
        [
          resolve(repoRoot, "scripts", "load-android-release-env.sh"),
          "ruby",
          "-e",
          rubyAdapter,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: environment,
        }
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(readFileSync(eventsPath, "utf8")).toBe("build\nupload\npersist\n");
      expect(result.stdout.trim()).toBe(
        "SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE=2026072210"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps direct APK metadata aligned with the actual signing key and latest checksum name", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );

    expect(fastfile).toContain("def direct_signing_certificate_sha256");
    expect(fastfile).toContain('"apksigner"');
    expect(fastfile).toContain(
      "app_signing_certificate_sha256: direct_signing_certificate_sha256"
    );
    expect(fastfile).not.toContain("release_available ?");
    expect(fastfile).not.toContain('"keytool"');
    expect(fastfile).not.toContain('"SECPAL_ANDROID_KEYSTORE_PASSWORD"');
    expect(fastfile).not.toContain('"SECPAL_ANDROID_KEY_PASSWORD"');
    expect(fastfile).toContain("SHA256SUMS-latest.txt");
    expect(fastfile).toContain("SHA256SUMS.next.txt");
    expect(fastfile).toContain("app.secpal-latest.next.apk");
    expect(fastfile).toContain("safely_replace_remote_latest_files!(");
  });

  it("does not retain the one-time schema-3 withdrawal machinery", () => {
    const fastfile = readFileSync(
      resolve(repoRoot, "fastlane", "Fastfile"),
      "utf8"
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8")
    );

    expect(
      packageJson.scripts["fastlane:android:withdraw:direct-apks"]
    ).toBeUndefined();
    expect(fastfile).not.toContain("def withdraw_direct_apk_channels!");
    expect(fastfile).not.toContain("safely_replace_remote_metadata!");
    expect(fastfile).not.toContain("quarantine_direct_apk_artifacts!");
    expect(fastfile).not.toContain("APK_DIRECT_WITHDRAWAL_ROOT");
    expect(fastfile).not.toContain("direct_release_urls(version = nil");
    expect(fastfile).not.toContain("versioned_release_root&.+");
    expect(fastfile).toContain("def with_direct_release_lock");
    expect(fastfile).toContain("def upload_direct_apk_artifacts(apk_path)");
    expect(fastfile).not.toContain("upload_direct_apk_artifacts_locked");
    expect(fastfile).toMatch(
      /lane :deploy_direct_apk do\s+with_direct_release_lock do/
    );
    expect(fastfile).toMatch(
      /lane :deploy_direct_apk_beta do\s+with_direct_release_lock do/
    );
    expect(fastfile).not.toContain("lane :withdraw_direct_apks do");
  });

  it("keeps the shared direct-deploy lock around the complete mutation", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "direct-apk-lock-"));
    const publicRoot = join(tempRoot, "public");
    const lockRoot = `${publicRoot}.release.lock`;
    const rubyAdapter = `
require "open3"
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
def sh(*arguments)
  raise "remote command must be a single SSH argument" unless arguments.length == 3
  output, status = Open3.capture2e(arguments.fetch(2))
  raise output unless status.success?
  output
end
with_direct_release_lock do
  raise "direct release lock was not held" unless Dir.exist?(ENV.fetch("SECPAL_TEST_LOCK_ROOT"))
  competing_error = begin
    with_direct_release_lock do
      raise "competing direct release unexpectedly acquired the lock"
    end
  rescue StandardError => error
    error
  end
  unless competing_error.message.include?("Another direct APK release mutation is already running.")
    raise competing_error
  end
end
raise "direct release lock was not released" if Dir.exist?(ENV.fetch("SECPAL_TEST_LOCK_ROOT"))
begin
  with_direct_release_lock do
    raise "release body failed"
  end
rescue StandardError => error
  raise error unless error.message == "release body failed"
end
raise "failed release body retained the lock" if Dir.exist?(ENV.fetch("SECPAL_TEST_LOCK_ROOT"))
`;

    try {
      const result = spawnSync("ruby", ["-e", rubyAdapter], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_ANDROID_DIRECT_ROOT: publicRoot,
          SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
          SECPAL_TEST_LOCK_ROOT: lockRoot,
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(existsSync(lockRoot)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes latest-artifact replacement as one quoted SSH remote command", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "direct-apk-latest-ssh-"));
    const remoteRoot = join(tempRoot, "stable");
    const sourceApkPath = join(tempRoot, "source.apk");
    const sourceChecksumPath = join(tempRoot, "source-checksum.txt");
    const rubyAdapter = `
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
def sh(*arguments)
  raise "remote command must be a single SSH argument" unless arguments.length == 3
  system(arguments.fetch(2), exception: true)
end
safely_replace_remote_latest_files!(
  remote_root: ENV.fetch("SECPAL_TEST_REMOTE_ROOT"),
  source_apk_path: ENV.fetch("SECPAL_TEST_SOURCE_APK"),
  source_checksum_path: ENV.fetch("SECPAL_TEST_SOURCE_CHECKSUM")
)
`;

    try {
      mkdirSync(remoteRoot, { recursive: true });
      writeFile(sourceApkPath, "schema-4-apk");
      writeFile(sourceChecksumPath, "schema-4-checksum");

      const result = spawnSync("ruby", ["-e", rubyAdapter], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
          SECPAL_TEST_REMOTE_ROOT: remoteRoot,
          SECPAL_TEST_SOURCE_APK: sourceApkPath,
          SECPAL_TEST_SOURCE_CHECKSUM: sourceChecksumPath,
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(
        readFileSync(join(remoteRoot, "app.secpal-latest.apk"), "utf8")
      ).toBe("schema-4-apk");
      expect(readFileSync(join(remoteRoot, "SHA256SUMS.txt"), "utf8")).toBe(
        "schema-4-checksum"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not restore stale backups when replacement fails before mutation", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "direct-apk-stale-backup-"));
    const remoteRoot = join(tempRoot, "stable");
    const sourceApkPath = join(tempRoot, "source.apk");
    const sourceChecksumPath = join(tempRoot, "source-checksum.txt");
    const latestApkPath = join(remoteRoot, "app.secpal-latest.apk");
    const latestChecksumPath = join(remoteRoot, "SHA256SUMS.txt");
    const rubyAdapter = `
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
script = remote_latest_files_replacement_script(
  remote_root: ENV.fetch("SECPAL_TEST_REMOTE_ROOT"),
  source_apk_path: ENV.fetch("SECPAL_TEST_SOURCE_APK"),
  source_checksum_path: ENV.fetch("SECPAL_TEST_SOURCE_CHECKSUM")
)
script = script.sub("\\ncp ", "\\nfalse\\ncp ")
system("sh", "-eu", "-c", script, exception: true)
`;

    try {
      writeFile(sourceApkPath, "future-apk");
      writeFile(sourceChecksumPath, "future-checksum");
      writeFile(latestApkPath, "current-apk");
      writeFile(latestChecksumPath, "current-checksum");
      writeFile(
        join(remoteRoot, "app.secpal-latest.previous.apk"),
        "stale-apk"
      );
      writeFile(join(remoteRoot, "SHA256SUMS.previous.txt"), "stale-checksum");

      const result = spawnSync("ruby", ["-e", rubyAdapter], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
          SECPAL_TEST_REMOTE_ROOT: remoteRoot,
          SECPAL_TEST_SOURCE_APK: sourceApkPath,
          SECPAL_TEST_SOURCE_CHECKSUM: sourceChecksumPath,
        },
      });

      expect(result.status).not.toBe(0);
      expect(readFileSync(latestApkPath, "utf8")).toBe("current-apk");
      expect(readFileSync(latestChecksumPath, "utf8")).toBe("current-checksum");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it.each(
    [
      {
        existingApk: "schema-3-apk",
        existingChecksum: "schema-3-checksum",
        initialState: "an existing APK and checksum",
      },
      {
        existingApk: "schema-3-apk",
        existingChecksum: undefined,
        initialState: "only an existing APK",
      },
      {
        existingApk: undefined,
        existingChecksum: "schema-3-checksum",
        initialState: "only an existing checksum",
      },
      {
        existingApk: undefined,
        existingChecksum: undefined,
        initialState: "an empty channel",
      },
    ].flatMap((initialState) => [
      {
        ...initialState,
        interruption: "kill -TERM $$",
        interruptionKind: "a signal",
      },
      {
        ...initialState,
        interruption: "false",
        interruptionKind: "a command failure",
      },
    ])
  )(
    "restores $initialState after $interruptionKind interrupts latest-artifact replacement",
    ({ existingApk, existingChecksum, interruption }) => {
      const tempRoot = mkdtempSync(
        join(tmpdir(), "direct-apk-latest-rollback-")
      );
      const remoteRoot = join(tempRoot, "stable");
      const sourceApkPath = join(tempRoot, "source.apk");
      const sourceChecksumPath = join(tempRoot, "source-checksum.txt");
      const latestApkPath = join(remoteRoot, "app.secpal-latest.apk");
      const latestChecksumPath = join(remoteRoot, "SHA256SUMS.txt");
      const rubyAdapter = `
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
script = remote_latest_files_replacement_script(
  remote_root: ENV.fetch("SECPAL_TEST_REMOTE_ROOT"),
  source_apk_path: ENV.fetch("SECPAL_TEST_SOURCE_APK"),
  source_checksum_path: ENV.fetch("SECPAL_TEST_SOURCE_CHECKSUM")
)
script = script.sub(
  "\\nmv \\"$next_checksum_path\\" \\"$checksum_path\\"",
  "\\nmv \\"$next_checksum_path\\" \\"$checksum_path\\"\\n#{ENV.fetch("SECPAL_TEST_INTERRUPTION")}"
)
system("sh", "-eu", "-c", script, exception: true)
`;

      try {
        writeFile(sourceApkPath, "schema-4-apk");
        writeFile(sourceChecksumPath, "schema-4-checksum");
        if (existingApk !== undefined) {
          writeFile(latestApkPath, existingApk);
        }
        if (existingChecksum !== undefined) {
          writeFile(latestChecksumPath, existingChecksum);
        }

        const result = spawnSync("ruby", ["-e", rubyAdapter], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
            SECPAL_TEST_INTERRUPTION: interruption,
            SECPAL_TEST_REMOTE_ROOT: remoteRoot,
            SECPAL_TEST_SOURCE_APK: sourceApkPath,
            SECPAL_TEST_SOURCE_CHECKSUM: sourceChecksumPath,
          },
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).not.toContain("undefined method");
        if (existingApk === undefined) {
          expect(existsSync(latestApkPath)).toBe(false);
        } else {
          expect(readFileSync(latestApkPath, "utf8")).toBe(existingApk);
        }
        if (existingChecksum === undefined) {
          expect(existsSync(latestChecksumPath)).toBe(false);
        } else {
          expect(readFileSync(latestChecksumPath, "utf8")).toBe(
            existingChecksum
          );
        }
        expect(existsSync(join(remoteRoot, "app.secpal-latest.next.apk"))).toBe(
          false
        );
        expect(existsSync(join(remoteRoot, "SHA256SUMS.next.txt"))).toBe(false);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  );

  it("keeps the committed latest artifacts when backup cleanup fails", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "direct-apk-latest-commit-"));
    const remoteRoot = join(tempRoot, "stable");
    const sourceApkPath = join(tempRoot, "source.apk");
    const sourceChecksumPath = join(tempRoot, "source-checksum.txt");
    const latestApkPath = join(remoteRoot, "app.secpal-latest.apk");
    const latestChecksumPath = join(remoteRoot, "SHA256SUMS.txt");
    const rubyAdapter = `
def default_platform(*) = nil
def platform(*) = nil
def desc(*) = nil
def lane(*) = nil
load ENV.fetch("SECPAL_TEST_FASTFILE")
script = remote_latest_files_replacement_script(
  remote_root: ENV.fetch("SECPAL_TEST_REMOTE_ROOT"),
  source_apk_path: ENV.fetch("SECPAL_TEST_SOURCE_APK"),
  source_checksum_path: ENV.fetch("SECPAL_TEST_SOURCE_CHECKSUM")
)
script = script.sub(
  "rm -f \\"$previous_apk_path\\" \\"$previous_checksum_path\\"",
  "false"
)
system("sh", "-eu", "-c", script, exception: true)
`;

    try {
      writeFile(sourceApkPath, "schema-4-apk");
      writeFile(sourceChecksumPath, "schema-4-checksum");
      writeFile(latestApkPath, "schema-3-apk");
      writeFile(latestChecksumPath, "schema-3-checksum");

      const result = spawnSync("ruby", ["-e", rubyAdapter], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_TEST_FASTFILE: resolve(repoRoot, "fastlane", "Fastfile"),
          SECPAL_TEST_REMOTE_ROOT: remoteRoot,
          SECPAL_TEST_SOURCE_APK: sourceApkPath,
          SECPAL_TEST_SOURCE_CHECKSUM: sourceChecksumPath,
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stderr).toContain(
        "Latest artifact backup cleanup failed after commit."
      );
      expect(readFileSync(latestApkPath, "utf8")).toBe("schema-4-apk");
      expect(readFileSync(latestChecksumPath, "utf8")).toBe(
        "schema-4-checksum"
      );
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
    const canonicalIndexHtml = buildAndroidRuntimeIndexHtml(
      canonicalRuntimeBridge
    );

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

      const incompleteApkPath = createZipFixture(
        join(tempRoot, "incomplete-apk"),
        "incomplete.apk",
        "assets",
        ["assets", "public"],
        canonicalIndexHtml,
        ["assets/index.js"],
        { remove: ["assets/index.js"] }
      );
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(incompleteApkPath, stringsXmlPath)
      ).toThrow(
        /missing Android web assets declared by its inventory: assets\/index\.js/i
      );

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

  it("requires packaged WebView files to match the generated inventory", async () => {
    const { verifyAndroidRuntimeSchemaArtifact } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const { buildNativeAuthBridgeBootstrapScript } =
      await loadNativeAuthBridgeInjectorModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-inventory-"));
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const canonicalRuntimeBridge =
      buildNativeAuthBridgeBootstrapScript(apiBaseUrl);
    const canonicalIndexHtml = buildAndroidRuntimeIndexHtml(
      canonicalRuntimeBridge
    ).replace(
      "</head>",
      '<script type="importmap">{"imports":{"app":"/assets/mapped.js"}}</script><style>.hero{background:url("/assets/inline.png")}</style></head>'
    );
    const completeAssets = {
      "assets/index.js":
        'import "app"; fetch("./config.json"); console.warn("./optional-worker.js");',
      "assets/mapped.js": "",
      "assets/config.json": "{}",
      "assets/inline.png": "",
      "frame.html":
        '<!doctype html><html><head><link rel="stylesheet" href="/assets/frame.css"></head><body></body></html>',
      "assets/frame.css":
        '.frame{background:url("/assets/frame-background.png")}',
      "assets/frame-background.png": "",
    };
    const missingAssets = [
      "assets/mapped.js",
      "assets/config.json",
      "assets/inline.png",
      "frame.html",
      "assets/frame.css",
      "assets/frame-background.png",
    ];

    try {
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );
      const incompleteArtifactPath = createZipFixture(
        join(tempRoot, "incomplete"),
        "incomplete.apk",
        "assets",
        ["assets", "public"],
        canonicalIndexHtml,
        completeAssets,
        { remove: missingAssets }
      );
      let incompleteArtifactError: unknown;
      try {
        verifyAndroidRuntimeSchemaArtifact(
          incompleteArtifactPath,
          stringsXmlPath
        );
      } catch (error) {
        incompleteArtifactError = error;
      }
      expect(incompleteArtifactError).toBeInstanceOf(Error);
      for (const missingAsset of missingAssets) {
        expect((incompleteArtifactError as Error).message).toContain(
          missingAsset
        );
      }

      const completeArtifactPath = createZipFixture(
        join(tempRoot, "complete"),
        "complete.apk",
        "assets",
        ["assets", "public"],
        canonicalIndexHtml,
        completeAssets
      );
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(completeArtifactPath, stringsXmlPath)
      ).not.toThrow();

      const tamperedArtifactPath = createZipFixture(
        join(tempRoot, "tampered"),
        "tampered.apk",
        "assets",
        ["assets", "public"],
        canonicalIndexHtml,
        completeAssets,
        { write: { "assets/index.js": "tampered" } }
      );
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(tamperedArtifactPath, stringsXmlPath)
      ).toThrow(/does not match its Android web asset inventory/i);

      const unexpectedArtifactPath = createZipFixture(
        join(tempRoot, "unexpected"),
        "unexpected.apk",
        "assets",
        ["assets", "public"],
        canonicalIndexHtml,
        completeAssets,
        { write: { "assets/unexpected.js": "" } }
      );
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(
          unexpectedArtifactPath,
          stringsXmlPath
        )
      ).toThrow(/not declared by its Android web asset inventory/i);

      const unsafeInventoryArtifactPath = createZipFixture(
        join(tempRoot, "unsafe-inventory"),
        "unsafe-inventory.apk",
        "assets",
        ["assets", "public"],
        canonicalIndexHtml,
        completeAssets,
        {
          write: {
            "secpal-web-assets.json":
              '{"schema_version":1,"files":[{"path":"../index.html","sha256":"ba099ae6a7e21a2b1d42e354d87ac48561720436495ebbf1955fa8b0a257f6c2"}]}',
          },
        }
      );
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(
          unsafeInventoryArtifactPath,
          stringsXmlPath
        )
      ).toThrow(/contains an invalid asset entry/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("validates the generated WebView directory before Android builds", async () => {
    const { verifyAndroidRuntimeSchemaDirectory } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const { buildNativeAuthBridgeBootstrapScript } =
      await loadNativeAuthBridgeInjectorModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-directory-"));
    const assetRoot = join(tempRoot, "public");
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";

    try {
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );
      writeFile(
        join(assetRoot, "index.html"),
        buildAndroidRuntimeIndexHtml(
          buildNativeAuthBridgeBootstrapScript(apiBaseUrl)
        )
      );
      writeFile(join(assetRoot, "assets", "index.js"), "complete");
      writeFile(join(assetRoot, "cordova.js"), "generated");
      writeFile(join(assetRoot, "cordova_plugins.js"), "generated");
      const aaptExcludedAssets = [
        "assets/source.SCC",
        "CVS/Entries",
        "assets/Thumbs.db",
        "assets/PICASA.INI",
        "assets/index.js~",
        ".hidden/metadata.json",
      ];
      for (const assetPath of aaptExcludedAssets) {
        writeFile(join(assetRoot, ...assetPath.split("/")), "excluded");
      }
      const inventoryResult = spawnSync(
        process.execPath,
        [
          join(repoRoot, "scripts", "generate-android-web-asset-inventory.mjs"),
          assetRoot,
        ],
        { encoding: "utf8" }
      );
      expect(
        inventoryResult.status,
        inventoryResult.error?.message || inventoryResult.stderr
      ).toBe(0);
      const inventory = JSON.parse(
        readFileSync(join(assetRoot, "secpal-web-assets.json"), "utf8")
      ) as { files: Array<{ path: string }> };
      expect(inventory.files.map(({ path }) => path)).toEqual(
        expect.arrayContaining(["cordova.js", "cordova_plugins.js"])
      );
      for (const assetPath of aaptExcludedAssets) {
        expect(inventory.files.map(({ path }) => path)).not.toContain(
          assetPath
        );
      }

      expect(() =>
        verifyAndroidRuntimeSchemaDirectory(assetRoot, stringsXmlPath)
      ).not.toThrow();

      writeFile(join(assetRoot, "assets", "index.js"), "tampered");
      expect(() =>
        verifyAndroidRuntimeSchemaDirectory(assetRoot, stringsXmlPath)
      ).toThrow(/does not match its Android web asset inventory/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses an immutable fallback inventory for standalone Android verification", async () => {
    const { verifyAndroidRuntimeSchemaDirectory } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const { buildNativeAuthBridgeBootstrapScript } =
      await loadNativeAuthBridgeInjectorModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-fallback-"));
    const assetRoot = join(tempRoot, "public");
    const fallbackInventoryPath = join(tempRoot, "fallback.json");
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";

    try {
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );
      writeFile(
        join(assetRoot, "index.html"),
        buildAndroidRuntimeIndexHtml(
          buildNativeAuthBridgeBootstrapScript(apiBaseUrl)
        )
      );
      writeAndroidWebAssetInventory(assetRoot);
      renameSync(
        join(assetRoot, "secpal-web-assets.json"),
        fallbackInventoryPath
      );

      expect(existsSync(join(assetRoot, "secpal-web-assets.json"))).toBe(false);
      expect(() =>
        verifyAndroidRuntimeSchemaDirectory(
          assetRoot,
          stringsXmlPath,
          fallbackInventoryPath
        )
      ).not.toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects generated Android web assets that drift from the canonical bridge", async () => {
    const { verifyAndroidRuntimeSchemaIndex } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const { buildNativeAuthBridgeBootstrapScript } =
      await loadNativeAuthBridgeInjectorModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-schema-"));
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const canonicalIndexPath = join(tempRoot, "canonical-index.html");
    const staleIndexPath = join(tempRoot, "stale-index.html");
    const canonicalRuntimeBridge =
      buildNativeAuthBridgeBootstrapScript(apiBaseUrl);
    const canonicalIndexHtml = buildAndroidRuntimeIndexHtml(
      canonicalRuntimeBridge
    );

    try {
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );
      writeFile(canonicalIndexPath, canonicalIndexHtml);
      writeFile(
        staleIndexPath,
        canonicalIndexHtml.replace(
          "currentBootstrapSchemaVersion = 4",
          "currentBootstrapSchemaVersion = 3"
        )
      );

      expect(() =>
        verifyAndroidRuntimeSchemaIndex(canonicalIndexPath, stringsXmlPath)
      ).not.toThrow();
      expect(() =>
        verifyAndroidRuntimeSchemaIndex(staleIndexPath, stringsXmlPath)
      ).toThrow(/must declare schema 4 independently/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("repairs a stale generated Android web runtime before verification", async () => {
    const { verifyAndroidRuntimeSchemaIndex } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const {
      buildNativeAuthBridgeBootstrapScript,
      injectNativeAuthBridgeIntoFile,
    } = await loadNativeAuthBridgeInjectorModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-schema-"));
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const staleIndexPath = join(tempRoot, "index.html");
    const canonicalRuntimeBridge =
      buildNativeAuthBridgeBootstrapScript(apiBaseUrl);
    const canonicalIndexHtml = buildAndroidRuntimeIndexHtml(
      canonicalRuntimeBridge
    );

    try {
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );
      writeFile(
        staleIndexPath,
        canonicalIndexHtml.replace(
          "currentBootstrapSchemaVersion = 4",
          "currentBootstrapSchemaVersion = 3"
        )
      );

      expect(() =>
        verifyAndroidRuntimeSchemaIndex(staleIndexPath, stringsXmlPath)
      ).toThrow(/must declare schema 4 independently/i);

      injectNativeAuthBridgeIntoFile(staleIndexPath, stringsXmlPath);

      expect(readFileSync(staleIndexPath, "utf8")).toBe(canonicalIndexHtml);
      expect(() =>
        verifyAndroidRuntimeSchemaIndex(staleIndexPath, stringsXmlPath)
      ).not.toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects corrupt Android web shells before injection and artifact verification", async () => {
    const { verifyAndroidRuntimeSchemaArtifact } =
      await loadAndroidRuntimeSchemaVerifierModule();
    const {
      buildNativeAuthBridgeBootstrapScript,
      injectNativeAuthBridgeIntoFile,
    } = await loadNativeAuthBridgeInjectorModule();
    const tempRoot = mkdtempSync(join(tmpdir(), "android-runtime-schema-"));
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const canonicalRuntimeBridge =
      buildNativeAuthBridgeBootstrapScript(apiBaseUrl);

    try {
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );

      for (const [name, corruptIndexHtml] of [
        ["empty", ""],
        [
          "truncated",
          '<!doctype html><html><head><script type="module" src="/assets/index.js"></script>',
        ],
      ] as const) {
        const corruptIndexPath = join(tempRoot, `${name}.html`);
        writeFile(corruptIndexPath, corruptIndexHtml);

        expect(() =>
          injectNativeAuthBridgeIntoFile(corruptIndexPath, stringsXmlPath)
        ).toThrow(/complete Android web application shell/i);
        expect(readFileSync(corruptIndexPath, "utf8")).toBe(corruptIndexHtml);
      }

      const bridgeOnlyArtifactPath = createZipFixture(
        join(tempRoot, "bridge-only"),
        "bridge-only.apk",
        "assets",
        ["assets", "public"],
        `<script id="secpal-native-auth-bridge-bootstrap">${canonicalRuntimeBridge}</script>`
      );
      expect(() =>
        verifyAndroidRuntimeSchemaArtifact(
          bridgeOnlyArtifactPath,
          stringsXmlPath
        )
      ).toThrow(/complete Android web application shell/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("executes runtime schema CLIs through URL-encoded and symlinked entry paths", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "android runtime schema-"));
    const repositoryAlias = join(tempRoot, "repository alias");
    const stringsXmlPath = join(tempRoot, "strings.xml");
    const apiBaseUrl = "https://runtime-bootstrap-required.secpal.dev";

    try {
      symlinkSync(repoRoot, repositoryAlias, "dir");
      writeFile(
        stringsXmlPath,
        `<resources><string name="api_base_url">${apiBaseUrl}</string></resources>`
      );

      for (const preserveMainSymlink of [false, true]) {
        const indexHtmlPath = join(
          tempRoot,
          preserveMainSymlink ? "preserved-index.html" : "resolved-index.html"
        );
        writeFile(indexHtmlPath, buildAndroidRuntimeIndexHtml());
        const nodeArguments = preserveMainSymlink
          ? ["--preserve-symlinks-main"]
          : [];
        const injectorResult = spawnSync(
          process.execPath,
          [
            ...nodeArguments,
            join(repositoryAlias, "scripts", "inject-native-auth-bridge.mjs"),
            indexHtmlPath,
            stringsXmlPath,
          ],
          { encoding: "utf8" }
        );

        expect(
          injectorResult.status,
          injectorResult.error?.message || injectorResult.stderr
        ).toBe(0);
        expect(readFileSync(indexHtmlPath, "utf8")).toContain(
          'id="secpal-native-auth-bridge-bootstrap"'
        );

        const verifierResult = spawnSync(
          process.execPath,
          [
            ...nodeArguments,
            join(
              repositoryAlias,
              "scripts",
              "verify-android-runtime-schema.mjs"
            ),
            indexHtmlPath,
            stringsXmlPath,
          ],
          { encoding: "utf8" }
        );
        expect(
          verifierResult.status,
          verifierResult.error?.message || verifierResult.stderr
        ).toBe(0);
        expect(verifierResult.stdout).toContain(
          "ANDROID_RUNTIME_SCHEMA_INDEX_OK"
        );
      }
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
    const releaseHelper = readFileSync(
      resolve(repoRoot, "fastlane", "lib", "secpal_android_release.rb"),
      "utf8"
    );

    expect(releaseHelper).toContain(
      "Failed to read required Direct #{channel}"
    );
    expect(releaseHelper).toContain("Failed to read required Play #{track}");
    expect(fastfile).not.toContain(
      "Skipping direct APK channel '#{channel}' while resolving the next version code"
    );
    expect(fastfile).not.toContain("Skipping Google Play track");
  });

  it("pins the third-party Ruby setup action to an immutable commit", () => {
    const qualityWorkflow = readFileSync(
      resolve(repoRoot, ".github", "workflows", "quality.yml"),
      "utf8"
    );
    const setupRubyReference = qualityWorkflow.match(
      /uses:\s*ruby\/setup-ruby@([^\s#]+)/
    );

    expect(setupRubyReference).not.toBeNull();
    expect(setupRubyReference?.[1]).toMatch(/^[0-9a-f]{40}$/);
    expect(qualityWorkflow).toContain("bundler-cache: true");
    expect(qualityWorkflow.indexOf("bundler-cache: true")).toBeLessThan(
      qualityWorkflow.indexOf("run: npm run test:coverage")
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
