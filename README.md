<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Android

> SecPal – A guard's best friend

[![Quality Gates](https://github.com/SecPal/android/actions/workflows/quality.yml/badge.svg)](https://github.com/SecPal/android/actions/workflows/quality.yml)

This repository owns the Android shell for SecPal's open-source software for
physical, organizational and personnel security. Capacitor packages the shared
React and TypeScript interface from [SecPal/frontend](https://github.com/SecPal/frontend).
The native build uses the pinned frontend revision and verifies its
`android-native` build metadata before packaging.

Android owns platform permissions, native authentication and credential
storage, the WebView bridge, deployment binding, native push, and APK and AAB
packaging, signing and distribution. [SecPal/api](https://github.com/SecPal/api)
owns server authentication, authorization and product behavior.
[SecPal/contracts](https://github.com/SecPal/contracts) defines the public HTTP
interface. [SecPal/deployment](https://github.com/SecPal/deployment) owns
portable integration and self-hosting.

## Native trust boundaries

The native shell keeps bearer credentials in Keystore-backed storage and
controls bridge access from the WebView. Runtime confirmation binds sign-in
and push to the selected deployment. The separate DPC owns Device Owner or
Profile Owner enforcement. The Work app consumes authenticated managed state.

The [Android Enterprise capabilities](docs/ANDROID_ENTERPRISE_CAPABILITIES.md)
describe the current implementation and its evidence.
[ADR-026](https://github.com/SecPal/.github/blob/main/docs/adr/20261002-client-trust-offline-recovery-adr026.md)
defines the accepted target for client identity, endpoint trust, offline
authorization and recovery. Delivery of the full target remains in progress.

## Local setup

Use Node.js 26 (at least 26.11.1, below 27), npm 10 or newer, Java 21 and
an Android SDK. For native builds, use the sibling frontend checkout at
the revision in [android/frontend-revision.txt](android/frontend-revision.txt).
Use Ruby 3.3 and Bundler for the Fastlane tests in preflight.

```bash
npm ci
npm run fastlane:install
./scripts/preflight.sh
```

The [local device guide](docs/ANDROID_LOCAL_DEVICE_TESTING.md) covers
Capacitor sync, debug APKs, WebView smoke tests and device setup. See
[CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

## Documentation

| Task                                                    | Guide                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Understand native sign-in and bearer credential custody | [Authentication architecture](docs/ANDROID_AUTH_ARCHITECTURE.md)                                                                          |
| Confirm a deployment or trace runtime binding and push  | [Runtime bootstrap contract](docs/ANDROID_RUNTIME_BOOTSTRAP_CONTRACT.md)                                                                  |
| Validate device management and owner modes              | [Android Enterprise capabilities](docs/ANDROID_ENTERPRISE_CAPABILITIES.md) and [device testing](docs/ANDROID_LOCAL_DEVICE_TESTING.md)     |
| Build, sign and distribute reviewed artifacts           | [Release and distribution](docs/ANDROID_RELEASE_DISTRIBUTION.md) and [first release checklist](docs/ANDROID_FIRST_RELEASE_CHECKLIST.md)   |
| Configure Google Play or recover signing inputs         | [Play Console setup](docs/ANDROID_PLAY_CONSOLE_SETUP.md) and [keystore backup and recovery](docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md) |

Report vulnerabilities privately through [SECURITY.md](SECURITY.md).
File-level SPDX and [REUSE](REUSE.toml) metadata describe licensing. See
[LICENSE](LICENSE) for the project license.
