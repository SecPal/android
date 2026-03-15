<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Removed the bundled Secrets product feature from the Android wrapper by syncing the updated shared frontend build without Secrets routes, UI, and related web assets.

### Security

- Scoped the transitive `yauzl` override to `native-run` and pinned it to `3.2.1` so Capacitor CLI tooling no longer resolves the vulnerable ZIP parser version reported by `npm audit`

### Added

- Initial `android` repository scaffold with SecPal governance baseline files, hooks, and workflows
- Capacitor + React + TypeScript bootstrap with Android platform preparation scripts
- Repository-local Copilot instruction baseline and overlays for Android/Capacitor scope
- `docs/ANDROID_ENTERPRISE_ROADMAP.md` for staged DPC/profile-owner/device-owner implementation planning
- Native Android helper scripts and release-distribution guidance for repeatable local debug and release builds on Fedora/Qubes developer machines
- Local release-keystore setup and signed-build helper scripts that keep Android upload secrets outside the repository under `~/.config/secpal/`
- `docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md` for the Android upload-key backup and recovery baseline on Fedora/Qubes
- `docs/ANDROID_FIRST_RELEASE_CHECKLIST.md` for the first SecPal Android release across direct download and Google Play
- `docs/ANDROID_PLAY_CONSOLE_SETUP.md` for the first Play Console setup aligned with the shared SecPal app identity

### Changed

- Refreshed the Android validation toolchain to the latest currently compatible `@types/node`, `vitest`, and `@vitest/coverage-v8` releases

- Switched Android Capacitor workflow to reuse the sibling `frontend` repository build output (`../frontend/dist`) as the web source of truth
- Added `scripts/build-frontend-web.sh` and wired `cap:sync`/`cap:copy` to build frontend first before syncing native Android assets
- Realigned the repository to a wrapper-only architecture by removing the placeholder local web app in favor of configuration and native-wrapper validation
- Hardened governance files, preflight hooks, and repository metadata for `main`-based workflow enforcement
- Upgraded the Android wrapper toolchain to Capacitor `8.2.0` across `@capacitor/android`, `@capacitor/core`, and `@capacitor/cli`
- Upgraded the repository validation toolchain to ESLint `10.0.3`, `@eslint/js` `10.0.1`, `globals` `17.4.0`, Vitest `4.0.18`, and `@vitest/coverage-v8` `4.0.18`
- Made the native Android app module read release versioning and signing inputs from environment variables so direct APK and Play Store release builds can share one Gradle path
- Updated the Android product identity to the public `SecPal` app name with the shared application ID `app.secpal.app`
- Added a structured Android release-identity baseline covering the recommended public developer name, application ID, and split between technical and user-facing support contacts
- Finalized the Android release baseline around the public `SecPal` publisher identity with `android@secpal.app` for technical Android topics and `support@secpal.app` for user-facing support
- Locked in the shared-app strategy so DPC capability remains part of the same `SecPal` package instead of a separate enterprise-only Android app

### Fixed

- Corrected invalid `CODEOWNERS` syntax and Android-specific copied repository metadata
- Removed local preflight bypass guidance and made tests and native Android verification blocking
- Versioned the generated `android/capacitor-cordova-android-plugins/` module so clean Android Studio syncs and Gradle builds work from a fresh clone
- Restricted Android file sharing to app-scoped paths and disabled default Android backups for a safer mobile baseline
- Corrected the domain-policy validation so mixed lines containing both allowed and forbidden `secpal.*` domains still fail the check
- Excluded deprecated `kotlin-stdlib-jdk7` and `kotlin-stdlib-jdk8` transitive modules from the native Android build so Debug APK assembly works with the current Capacitor and AndroidX dependency graph
- Hardened Android release helper scripts to reject unsafe env-file ownership or permissions, apply restrictive secret-file umask defaults, and escape generated env values safely
- Corrected `scripts/preflight.sh` so unstaged and untracked files are included consistently for markdown, REUSE, and local PR-size decisions
