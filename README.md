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

## Local Setup

```bash
npm ci
npm --prefix ../frontend ci
```

## Capacitor Setup

```bash
npm run cap:add:android
npm run cap:sync
npm run cap:open:android
```

`npm run cap:sync` automatically builds `../frontend` first.

## Quality Gates

Run the same baseline checks as other SecPal repositories:

```bash
./scripts/preflight.sh
```

Optional faster push flow while still validated in CI:

```bash
PREFLIGHT_RUN_TESTS=1 ./scripts/preflight.sh
```

## Roadmap

See `docs/ANDROID_ENTERPRISE_ROADMAP.md` for the staged approach to DPC and admin capabilities.
