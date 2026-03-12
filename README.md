<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Android

Android app repository for SecPal, based on Capacitor and the shared web app from `../frontend`.

## Goals

- Ship a secure SecPal mobile app for Android first
- Keep iOS support possible via Capacitor without coupling Android-specific code into shared app logic
- Prepare staged Android Enterprise support (DPC, profile owner/device owner flows)

## Frontend Source of Truth

This repository does not maintain a separate production frontend implementation.
Capacitor consumes the web build output from the sibling `frontend` repository:

- source: `../frontend`
- web assets used by Capacitor: `../frontend/dist`

This keeps one single UI codebase and avoids divergence between web and mobile UI.

The Android-specific responsibility in this repository is therefore limited to:

- Capacitor configuration
- Native Android project files
- DPC and Android Enterprise bridge code
- Repo-local governance, CI, and validation

## Local Setup

```bash
npm ci
npm --prefix ../frontend ci
```

For Fedora-based local builds, keep the Android toolchain available in your shell:

```bash
source ~/.zshrc
java -version
sdkmanager --version
```

Install Git hooks after cloning:

```bash
./scripts/setup-pre-commit.sh
./scripts/setup-pre-push.sh
```

## Capacitor Setup

```bash
npm run cap:add:android
npm run cap:sync
npm run cap:open:android
```

`npm run cap:sync` automatically builds `../frontend` first.

The generated native Android project is committed in this repository and validated by the local test suite.

## Native Android Builds

Debug APK:

```bash
npm run cap:sync
npm run native:assemble:debug
```

Release artifacts without Play Store publishing:

```bash
npm run native:assemble:release
npm run native:bundle:release
```

Signed release artifacts with a local upload key:

```bash
bash ./scripts/setup-android-release-keystore.sh
npm run native:assemble:release:signed
npm run native:bundle:release:signed
```

Release signing is picked up from environment variables when present:

- `SECPAL_ANDROID_VERSION_CODE`
- `SECPAL_ANDROID_VERSION_NAME`
- `SECPAL_ANDROID_KEYSTORE_PATH`
- `SECPAL_ANDROID_KEYSTORE_PASSWORD`
- `SECPAL_ANDROID_KEY_ALIAS`
- `SECPAL_ANDROID_KEY_PASSWORD`

The recommended local secret file is `~/.config/secpal/android-release.env`. It stays outside the repository and can be loaded automatically by the signed release scripts.

See `docs/ANDROID_RELEASE_DISTRIBUTION.md` for the distribution split between direct APK delivery and Google Play.
See `docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md` for the backup and recovery baseline for the Android upload key.
See `docs/ANDROID_FIRST_RELEASE_CHECKLIST.md` for the first direct-download and Play Store release gate.
See `docs/ANDROID_PLAY_CONSOLE_SETUP.md` for the concrete Play Console setup flow.

The current release baseline uses:

- public app name: `SecPal`
- public developer or publisher name: `SecPal`
- application ID: `app.secpal.app`
- technical Android contact: `android@secpal.app`
- public support contact: `support@secpal.app`

## Quality Gates

Run the same baseline checks as other SecPal repositories:

```bash
./scripts/preflight.sh
```

The preflight script blocks direct pushes from `main`, runs formatting and governance checks, and executes lint, typecheck, tests, and native Android consistency checks.

## Roadmap

See `docs/ANDROID_ENTERPRISE_ROADMAP.md` for the staged approach to DPC and admin capabilities.

The current product decision is to keep DPC-related capability inside the same `SecPal` app, with behavior depending on installation path and managed state rather than a separate Android package.
