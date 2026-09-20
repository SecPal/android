<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Android

> SecPal – A guard's best friend

[![Quality Gates](https://github.com/SecPal/android/actions/workflows/quality.yml/badge.svg)](https://github.com/SecPal/android/actions/workflows/quality.yml)
[![CodeQL](https://github.com/SecPal/android/actions/workflows/codeql.yml/badge.svg)](https://github.com/SecPal/android/actions/workflows/codeql.yml)
[![License: AGPL v3+](https://img.shields.io/badge/License-AGPL%20v3+-blue.svg)](LICENSE)

## About

SecPal supports professional security operations, including private security
services, in-house security, plant protection (`Werkschutz`), corporate
security (`Unternehmensschutz`), and comparable professional security
organisations. This repository contains the native Android application shell
for the main SecPal product.

The app packages the shared React/TypeScript interface from
[`SecPal/frontend`](https://github.com/SecPal/frontend) with Capacitor and adds
the Android-specific integration and security boundaries required for a native
application.

## Repository responsibilities

This repository owns:

- the Capacitor configuration and native Android project;
- Android platform integration, permissions, and managed-device behavior;
- native authentication, bearer-credential custody, and the authenticated
  request boundary;
- customer-instance discovery and native runtime binding;
- native push integration bound to the selected deployment and signed-in user;
- Android packaging, signing inputs, release artifacts, and publication tooling;
  and
- DPC registration, Device Owner/Profile Owner-aware managed-state handling,
  and dedicated-device integration present in the native project.

The shared product UI and UX remain in `SecPal/frontend`. The Android shell
consumes a pinned `android-native` frontend build and verifies its build metadata
before packaging it. Server authentication, authorization, tenant isolation,
and business behavior belong to `SecPal/api`; public schemas belong to
`SecPal/contracts`; infrastructure and self-hosting belong to
`SecPal/deployment`.

Native code and tests establish which managed-device capabilities are shipped.
The Android Enterprise roadmap records planned direction; it does not by itself
establish that a capability is implemented.

## Native security and trust boundaries

The Android wrapper is a security boundary, not only a packaging layer:

- Android bearer credentials remain under native custody and are encrypted with
  an Android Keystore-backed key rather than exposed to WebView storage.
- The WebView-to-native bridge constrains origin, frame, plugin, and authenticated
  request access. Shared frontend code does not make browser-session and Android
  authentication mechanics identical.
- Customer-instance discovery, runtime confirmation, switching, and reset cross
  a native trust boundary so credentials, browser state, and tenant-bound state
  cannot be silently rebound.
- Native push identity and registration are bound to the confirmed runtime and
  authenticated user context.
- Platform permissions, endpoint trust policy, packaged web assets, and signed
  APK/AAB artifacts are validated at Android-specific boundaries.
- Debug builds permit local inspection and controlled test hooks; release builds
  disable WebView debugging and protect sensitive activity screenshots.

Detailed invariants and operational procedures live in the focused documents
below.

## Technology

- Capacitor and the shared React/TypeScript frontend
- Native Android/Java with Gradle
- Android Keystore-backed credential encryption
- Firebase Cloud Messaging initialized from confirmed deployment metadata
- Fastlane-based release tooling

## Quick start

Local development requires Node.js 22 or later, npm 10 or later, Java 21, and an
Android SDK. By default, the repository expects `SecPal/frontend` as a sibling
checkout. Check out the exact frontend revision recorded in
[`android/frontend-revision.txt`](android/frontend-revision.txt) before syncing.

```bash
npm ci
npm --prefix ../frontend ci
npm run cap:sync
npm run native:assemble:debug
```

`cap:sync` builds the pinned `android-native` frontend surface, verifies its
consumer-side build metadata, installs the maintained native bridge asset, and
synchronizes the committed Android project. Run the maintained local validation
entry point with:

```bash
./scripts/preflight.sh
```

See [local and physical-device testing](docs/ANDROID_LOCAL_DEVICE_TESTING.md)
for workstation setup, APK installation, WebView smoke testing, and managed
device procedures.

## Documentation

| Intent                                                                  | Authority                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Android authentication and native credential boundary                   | [Android authentication architecture](docs/ANDROID_AUTH_ARCHITECTURE.md)                                                                        |
| Customer-instance discovery, runtime binding, reset, and push bootstrap | [Android runtime bootstrap contract](docs/ANDROID_RUNTIME_BOOTSTRAP_CONTRACT.md)                                                                |
| Workstation, WebView, physical-device, and dedicated-device testing     | [Local Android device testing](docs/ANDROID_LOCAL_DEVICE_TESTING.md)                                                                            |
| Future Android Enterprise and DPC direction                             | [Android Enterprise roadmap](docs/ANDROID_ENTERPRISE_ROADMAP.md)                                                                                |
| Build, signing, Fastlane, Google Play, and direct APK distribution      | [Android release and distribution](docs/ANDROID_RELEASE_DISTRIBUTION.md) and [first release checklist](docs/ANDROID_FIRST_RELEASE_CHECKLIST.md) |
| Google Play account and publication setup                               | [Android Play Console setup](docs/ANDROID_PLAY_CONSOLE_SETUP.md)                                                                                |
| Upload-key backup and recovery                                          | [Android keystore backup and recovery](docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md)                                                            |

## Related repositories

- [`SecPal/frontend`](https://github.com/SecPal/frontend) — shared
  React/TypeScript UI and the `android-native` web artifact.
- [`SecPal/api`](https://github.com/SecPal/api) — server authentication,
  authorization, persistence, and business behavior.
- [`SecPal/contracts`](https://github.com/SecPal/contracts) — public OpenAPI
  contract shared by clients and the API.
- [`SecPal/deployment`](https://github.com/SecPal/deployment) — integration,
  infrastructure, self-hosting, and deployment authority.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) before contributing. Use the repository's
maintained validation and signed, issue-first delivery workflow.

## Security

Do not report vulnerabilities in public issues. Follow the private reporting
process in [SECURITY.md](SECURITY.md).

## License

Repository-owned code is licensed under `AGPL-3.0-or-later` where indicated.
File-level SPDX and [REUSE](REUSE.toml) metadata are authoritative; see
[LICENSE](LICENSE) for the license text.
