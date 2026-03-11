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

## Quality Gates

Run the same baseline checks as other SecPal repositories:

```bash
./scripts/preflight.sh
```

The preflight script blocks direct pushes from `main`, runs formatting and governance checks, and executes lint, typecheck, tests, and native Android consistency checks.

## Roadmap

See `docs/ANDROID_ENTERPRISE_ROADMAP.md` for the staged approach to DPC and admin capabilities.
