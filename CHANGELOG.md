<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial `android` repository scaffold with SecPal governance baseline files, hooks, and workflows
- Capacitor + React + TypeScript bootstrap with Android platform preparation scripts
- Repository-local Copilot instruction baseline and overlays for Android/Capacitor scope
- `docs/ANDROID_ENTERPRISE_ROADMAP.md` for staged DPC/profile-owner/device-owner implementation planning

### Changed

- Switched Android Capacitor workflow to reuse the sibling `frontend` repository build output (`../frontend/dist`) as the web source of truth
- Added `scripts/build-frontend-web.sh` and wired `cap:sync`/`cap:copy` to build frontend first before syncing native Android assets
- Realigned the repository to a wrapper-only architecture by removing the placeholder local web app in favor of configuration and native-wrapper validation
- Hardened governance files, preflight hooks, and repository metadata for `main`-based workflow enforcement

### Fixed

- Corrected invalid `CODEOWNERS` syntax and Android-specific copied repository metadata
- Removed local preflight bypass guidance and made tests and native Android verification blocking
- Versioned the generated `android/capacitor-cordova-android-plugins/` module so clean Android Studio syncs and Gradle builds work from a fresh clone
- Restricted Android file sharing to app-scoped paths and disabled default Android backups for a safer mobile baseline
- Corrected the domain-policy validation so mixed lines containing both allowed and forbidden `secpal.*` domains still fail the check
