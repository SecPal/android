<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Release And Distribution

This repository can support both SecPal distribution channels on Android:

- direct APK delivery for managed Android Enterprise and DPC-related rollouts
- Google Play distribution for the public app and managed Google Play scenarios

## Work release identity

The current Work build uses `app.secpal` (Android application ID). The
separate DPC has its own package and signing authority. The
[local device testing procedure](ANDROID_LOCAL_DEVICE_TESTING.md)
covers the two builds; [ADR-026](https://github.com/SecPal/.github/blob/main/docs/adr/20261002-client-trust-offline-recovery-adr026.md)
owns future client-family identity and endpoint trust.

Direct packaging uses the local Work signing key. Google Play App Signing
separates the upload key from the certificate Play uses on delivered builds.
Verify the effective distribution certificates before promising upgrades
between channels.

## Repository Security Before Signing Or Publication

Release from a clean, committed source with a successful **main-push Quality
Checks** run for that exact commit. Run
`node scripts/verify-repository-security.mjs` on the release workstation with
GitHub CLI authenticated for read access to this repository's Actions evidence.
The signed-build wrappers and Fastlane signing/publication boundaries enforce
this read-only precondition before signing, Play upload or Direct APK mutation.
The check records the accepted commit, run and evidence artifact reference.

Only authenticated v2 evidence from the accepted shared scanner/policy with a
CLEAN gate and a still-fresh database is acceptable. Missing, malformed, failed,
skipped, ACTIONABLE, REVIEW_REQUIRED and UNKNOWN_STALE evidence blocks release.
If the database evidence has expired, rerun Quality Checks on that exact main
commit and wait for successful fresh evidence. A successful build alone is
insufficient. Commit any packaging/source changes and obtain evidence for that
new commit before signing.

The reviewed country-reference exception is bound to the exact source blob and
expires at **2026-10-18T00:00:00Z**. The current release acceptance also stops at
that boundary; old artifacts cannot extend it. Any successor requires fresh
independent central policy review and an explicit reviewed adoption update.
There are no Android-local scanner exceptions or signing secrets in scanning CI.

Repository source scanning covers supported npm and Bundler lockfile dependency
surfaces, supported configuration rules and secrets. It does not establish a
Gradle vulnerability inventory from this repository's unlocked build scripts,
AndroidManifest semantics, or final signed APK/AAB safety. Existing packaging,
runtime-schema, signing identity, version and publication-lock checks remain
independent requirements. Release credentials stay on the operator workstation.

## Google Developer Account

A Google Play Developer account is only required to publish through Google Play.

It is not required to:

- generate a signed release APK
- generate a signed Android App Bundle (`.aab`)
- deliver APKs directly to customers or test devices

## Direct Download And DPC Considerations

For DPC and enterprise distribution, direct APK delivery remains useful for:

- controlled customer onboarding
- EMM or MDM-based side loading flows
- early device-owner and profile-owner pilots before Play distribution is ready

Keep in mind that direct distribution still needs:

- a stable application ID
- a stable signing key
- a versioning strategy that never goes backwards

Runtime discovery and notification contracts are maintained in
[Android runtime bootstrap](ANDROID_RUNTIME_BOOTSTRAP_CONTRACT.md) and the
[SecPal API contract](https://github.com/SecPal/contracts).

## Play Store Considerations

For Play distribution, plan for:

- Google Play App Signing
- Play Console metadata and store assets
- privacy, support, and contact details on `secpal.app`
- internal, closed, and production tracks

If Android Enterprise distribution through managed Google Play is a target, Play Console setup becomes useful even if direct APK delivery stays available.

## Environment Variables For Release Builds

The Gradle app module reads the canonical visible app version from the root `VERSION` file. `package.json` and `package-lock.json` must match it; verify this with `npm run version:check`. `SECPAL_ANDROID_VERSION_NAME` is obsolete and has no effect.

Release code and signing inputs are separated as follows:

- `SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE`: local baseline of the last successful publication
- `SECPAL_ANDROID_DEPLOY_VERSION_CODE`: optional publishing-only operator override
- `SECPAL_ANDROID_VERSION_CODE`: temporary current Gradle build code; build-only Fastlane lanes require it explicitly
- `SECPAL_ANDROID_KEYSTORE_PATH`
- `SECPAL_ANDROID_KEYSTORE_PASSWORD`
- `SECPAL_ANDROID_KEY_ALIAS`
- `SECPAL_ANDROID_KEY_PASSWORD`

Recommended local file location:

- `~/.config/secpal/android-release.env`

Recommended keystore location:

- `~/.config/secpal/android-upload.jks`

This repository provides helper scripts for that layout:

- `scripts/setup-android-release-keystore.sh`
- `scripts/load-android-release-env.sh`

The build-only example uses today's UTC date with suffix `01`. It neither
reserves nor publishes that code. Publication uses the Fastlane code allocator.

```bash
bash ./scripts/setup-android-release-keystore.sh
BUILD_ONLY_VERSION_CODE="$(date -u +%Y%m%d)01"
SECPAL_ANDROID_VERSION_CODE="$BUILD_ONLY_VERSION_CODE" \
  npm run native:assemble:release:signed
SECPAL_ANDROID_VERSION_CODE="$BUILD_ONLY_VERSION_CODE" \
  npm run native:bundle:release:signed
```

The setup script creates both the keystore and the local env file, with file mode `600` to reduce accidental exposure on shared systems. It writes neither a visible version nor a current build code. When an older env file contains a `SECPAL_ANDROID_VERSION_CODE` baseline, the loader exposes it as `SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE` to the child process only. It does not modify or delete entries in the file. A legacy `SECPAL_ANDROID_VERSION_NAME` is warned about, ignored, and removed from the child environment.

## Fastlane For Local Build And Play Upload

Fastlane should reuse the existing local signing baseline instead of introducing a second signing path.

- keep the upload keystore in `~/.config/secpal/android-upload.jks`
- keep the release env file in `~/.config/secpal/android-release.env`
- keep the Google Play service-account JSON outside the repository as well, for example at `~/.config/secpal/google-play-service-account.json`

Fastlane lanes in this repository call the existing signed Gradle build flow and expect these local prerequisites:

- `bundle install`
- `SECPAL_ANDROID_CONFIG_DIR` when the complete release context should live outside the default `~/.config/secpal`
- `SECPAL_ANDROID_RELEASE_ENV_FILE` when you do not use the default `~/.config/secpal/android-release.env`
- `SECPAL_ANDROID_PLAY_JSON_KEY_PATH` for every publication, including Direct Stable and Direct Beta
- `SECPAL_ANDROID_DIRECT_SSH_HOST` when publishing the direct APK to a non-default SSH host; the default is `secpal-uberspace`
- `SECPAL_ANDROID_DIRECT_ROOT` when the target root differs from `/var/www/virtual/secpal/apk.secpal.app`
- `SECPAL_ANDROID_DIRECT_CHANNEL` when publishing to the `beta` direct-download channel instead of `stable`

Signed build-only commands do not reserve or persist a code. Both native signed-build scripts and the Fastlane `build_signed_apk` and `build_signed_aab` lanes require an explicit valid `SECPAL_ANDROID_VERSION_CODE` in `YYYYMMDDXX` format and abort if it is absent. Debug and store-listing builds keep their independent Gradle defaults.

All publishing lanes share one allocator. It reads the local baseline, Direct Stable metadata, Direct Beta metadata, and the Google Play tracks `internal`, `alpha`, `beta`, and `production`. Every configured source is required: one unreadable Play track or Direct channel aborts the publication. New custom or closed-testing Play tracks must be added to `PLAY_VERSION_CODE_TRACKS` before they are used for a release. Direct publication cannot run without working Google Play credentials because otherwise the shared monotonic sequence cannot be proven.

The allocator uses UTC ranges `YYYYMMDD01` through `YYYYMMDD99`. It selects `01` when today has no known code, otherwise increments today's highest known code. It aborts on `99`, on a known future code, or on invalid source data. A `SECPAL_ANDROID_DEPLOY_VERSION_CODE` override must use the same format, fall in today's UTC range, and exceed every known code. Historical nine-digit codes remain valid monotonic floors but are never generated. Google Play's `2,100,000,000` limit means this date scheme is valid through 2099 and intentionally fails for 2100 dates.

The local signing workstation is the authorized release runner; Uberspace is the authorized release publication target. Google Play, Direct Stable, and Direct Beta publishing all hold the same non-blocking local `flock`-backed `android-publish.lock` for source collection, allocation, build, upload, and baseline persistence. The shell loader exports the exact release env file it selected so Fastlane reads and persists the same context even when loaded values change `HOME`. Independently, the lock is runner-account-wide at `~/.config/secpal/android-publish.lock`; its home directory comes from the operating-system account, so `SECPAL_ANDROID_CONFIG_DIR`, `SECPAL_ANDROID_RELEASE_ENV_FILE`, and a process-level `HOME` override cannot split publishers across different locks. A missing lock directory is created with mode `700`; symlinked, foreign-owned, or group/world-accessible lock directories are rejected. A concurrent process aborts, and the lock is released on success, failure, or process termination. This runner-local lock is not a substitute for a future central release reservation service.

Fastlane writes `SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE` only after the upload has succeeded. During build and upload, the selected code exists only as `SECPAL_ANDROID_VERSION_CODE` and is removed afterwards.

For direct APK publication on `apk.secpal.app`, the repository now treats the canonical machine-facing URLs as `stable` plus `beta`, while keeping `/android/...` as the stable alias:

- `https://apk.secpal.app/android/latest.json`
- `https://apk.secpal.app/android/app.secpal-latest.apk`
- `https://apk.secpal.app/android/SHA256SUMS.txt`
- `https://apk.secpal.app/android/stable/latest.json`
- `https://apk.secpal.app/android/stable/app.secpal-latest.apk`
- `https://apk.secpal.app/android/stable/SHA256SUMS.txt`
- `https://apk.secpal.app/android/beta/latest.json`
- `https://apk.secpal.app/android/beta/app.secpal-latest.apk`
- `https://apk.secpal.app/android/beta/SHA256SUMS.txt`
- `https://apk.secpal.app/android/releases/{version}/metadata.json`
- `https://apk.secpal.app/android/releases/{version}/app.secpal-{version}.apk`
- `https://apk.secpal.app/android/releases/{version}/SHA256SUMS.txt`

The `fastlane android deploy_direct_apk` lane builds the signed release APK, uploads the versioned release files to Uberspace, refreshes the `stable` channel under `/android/stable/`, and also refreshes the stable aliases under `/android/`.
The `fastlane android deploy_direct_apk_beta` lane publishes the same signed release APK under `/android/beta/` without replacing the stable aliases.
Direct Stable/Beta deploys hold the same canonical remote artifact-root lock from version selection through publication. A second deployment fails before changing remote state. If an ungraceful process or host termination leaves the empty `${SECPAL_ANDROID_DIRECT_ROOT}.release.lock` directory behind, verify that no direct release mutation is still running and remove only that empty directory with `rmdir` before retrying.
All repository-provided signed build lanes and npm commands first verify that
the signed APK and AAB embed the production `android-native` frontend metadata
and one inventoried, content-hashed, same-origin canonical schema-4 Android
bridge at exactly the artifact-type-specific WebView path. Publication fails
before any upload when the index, metadata, bridge path, filename hash, bytes,
inventory, strict CSP, or notification-registration schema is missing,
duplicated, stale, or non-canonical.

The resulting latest-channel endpoints are:

- `https://apk.secpal.app/android/stable/latest.json`
- `https://apk.secpal.app/android/stable/app.secpal-latest.apk`
- `https://apk.secpal.app/android/stable/SHA256SUMS.txt`
- `https://apk.secpal.app/android/latest.json`
- `https://apk.secpal.app/android/app.secpal-latest.apk`
- `https://apk.secpal.app/android/SHA256SUMS.txt`
- `https://apk.secpal.app/android/beta/latest.json`
- `https://apk.secpal.app/android/beta/app.secpal-latest.apk`
- `https://apk.secpal.app/android/beta/SHA256SUMS.txt`

Example:

```bash
npm run fastlane:install
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:internal
```

```bash
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:direct-apk
```

```bash
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:direct-apk:beta
```

The `deploy_internal` lane uploads the signed AAB to the Google Play internal testing track and intentionally skips metadata, screenshots, and changelog uploads so artifact delivery stays the only responsibility of the lane.

## Release gates and key custody

Use the [first public release checklist](ANDROID_FIRST_RELEASE_CHECKLIST.md),
the [Play Console setup](ANDROID_PLAY_CONSOLE_SETUP.md) for initial account
configuration, and the [key custody runbook](ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md)
for backup and recovery.
