<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Android

Android app for SecPal — operations software for German private security services. Built with Capacitor on top of the shared web frontend from `../frontend`.

## Goals

- Ship a secure SecPal mobile app for Android first
- Keep iOS support possible via Capacitor without coupling Android-specific code into shared app logic
- Support authenticated device management through the separate Android DPC

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

## Authentication Boundary

The shared UI codebase does **not** imply shared authentication mechanics.

- **Web / PWA:** session-based Laravel Sanctum SPA auth with httpOnly cookies and CSRF
- **Android app:** native bearer-token auth via `POST /v1/auth/token`

Android bearer tokens must be stored in Android-native secure storage and must never be persisted in JavaScript-accessible storage such as `localStorage`, `sessionStorage`, IndexedDB, cookies, or Capacitor `Preferences`.

See `docs/ANDROID_AUTH_ARCHITECTURE.md` for the mandatory long-term Android auth design and the prohibited shortcuts.

## Binding To A Customer Deployment

The shipped Android app is generic. It does not assume a default SecPal production API origin at login time.

To bind the app to a customer-hosted deployment:

1. Ask your supervisor for the secure HTTPS instance URL.
2. Open the app. The discovery gate appears before login.
3. Enter the instance URL and select the preferred language if needed.
4. Tap `Check instance`. The app calls the public `GET /v1/bootstrap` endpoint, validates compatibility, and shows the resolved instance name.
5. Tap `Continue to login` only after the shown instance matches the expected customer deployment.

The app stores the canonical API origin returned by bootstrap only after this confirmation step. If the deployment must be changed later, use the instance hint below the passkey button on the login screen. Confirming that reset clears local sign-in state, offline data, and cached tenant state on the device before returning to discovery.

After a deployment is confirmed, runtime restore after restart is driven by the native runtime-bootstrap payload through `SecPalNativeAuthBridge.getRuntimeBootstrap()`. The Android WebView no longer restores or confirms a deployment from browser session storage, a legacy `apiOrigin`-only payload, `SecPalNativeAuth.setApiBaseUrl(...)`, or a baked-in production origin. Runtime selection and reset require a single-use native confirmation through `SecPalNativeAuth.confirmRuntimeBootstrap(...)` or `SecPalNativeAuth.confirmRuntimeReset()`; the dialog identifies the natively validated canonical API origin, and the obsolete raw setters are not exported. An approved reset removes native bootstrap persistence, tenant-scoped credentials and browser state, retained Android push state, and injected runtime state before discovery appears again. It also best-effort revokes the push installation and authenticated server session against that confirmed origin. A persisted browser marker completes tenant-state cleanup after an interrupted reset. Cancelling the confirmation or failing native teardown leaves the existing JavaScript runtime binding and tenant browser state unchanged.

Use the customer-facing instance URL that the user received, not a copied API path such as `/v1/...`. If onboarding links are distributed centrally, the Android discovery gate can also consume `instance_url`, `server_url`, or `bootstrap_url` query parameters, but the same bootstrap validation and confirmation still happens before login.

For the current SecPal live deployment, the bootstrap/input host is `https://api.secpal.dev`. `https://app.secpal.dev` remains the browser frontend host and does not currently expose `GET /v1/bootstrap` for Android runtime binding.

When the validated bootstrap enables `features.notification_channels.android_fcm`, the generic app initializes a deployment-scoped native Firebase runtime named `secpal-runtime-push` from `notification_channels.android_fcm.public_runtime_metadata`. It does not fall back to a bundled `google-services.json`, a SecPal-owned sender configuration, or token events emitted by another Firebase app instance.

The native shell requests the FCM token on-device, but the authenticated device binding is created only after native login succeeds against the selected customer API. The app then registers `PUT /v1/me/push-devices/{installationId}` on that canonical API origin, updates the same binding when the token rotates, and revokes it on logout or `Log out and switch instance` before clearing local runtime state. If that authenticated registration later fails with `409 NOTIFICATION_RUNTIME_STATE_INVALID` or `409 NOTIFICATION_CHANNEL_UNSUPPORTED`, the app clears the selected runtime and tenant-scoped browser state before returning to discovery so stale push metadata cannot survive a deployment switch.

For operator validation on a real device, confirm the app binds to the intended customer instance, login triggers the push-device registration on the customer API host, logout or instance reset revokes that registration, and no push traffic falls back to any SecPal-owned API or legacy Firebase setup.

## Local Setup

Use Node.js 26 (at least the qualified 26.11.1 patch, below Node 27) and npm 10
or newer. `.nvmrc` tracks Node 26; active CI uses exact Node 26.11.1 selectors.

```bash
npm ci
npm --prefix ../frontend ci
```

If you need to regenerate launcher icons or splash assets with `npm run brand:sync`, install ImageMagick first so its `magick` (version 7) or `convert` (version 6) CLI is available in your shell.

For Fedora-based local builds, keep the Android toolchain available in your shell:

```bash
source ~/.zshrc
java -version
sdkmanager --version
```

On Fedora, install the required binary with `sudo dnf install ImageMagick`. On Debian or Ubuntu, use `sudo apt install imagemagick`.

Install Git hooks after cloning:

```bash
./scripts/setup-pre-commit.sh
./scripts/setup-pre-push.sh
```

See `docs/ANDROID_LOCAL_DEVICE_TESTING.md` for the full Fedora and physical-device flow, including `adb` verification, debug APK installation, and Linux troubleshooting.

On pull requests, Android Smoke builds the APK from the pinned frontend, checks
native-auth route parity, and verifies unauthenticated startup on an API 35
emulator. These checks use no test account or live API. The required Vitest suite
also runs deterministic bootstrap-contract tests.

Protected `main` runs live instance discovery and the authenticated journey on a
separate runner. Set the `ANDROID_SMOKE_API_ORIGIN` variable in the existing
`android-smoke-main` environment to a dedicated test API origin only after
verifying that it serves the Android bootstrap contract, permits the packaged
`https://app.secpal.dev` WebView origin, and confines the public development
fixture to disposable synthetic data. The seeded fixture has broad management
permissions. The workflow supplies its public password only to the login command.

For a repeatable live-device login smoke against the real WebView DOM, forward the current debug WebView socket and run the repo-owned smoke script with test credentials:

```bash
adb shell cat /proc/net/unix | grep webview_devtools_remote
adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
SECPAL_TEST_EMAIL=test@example.com \
SECPAL_TEST_PASSWORD=password \
npm run test:live:webview-auth-smoke
```

The script keeps the configured runtime (or completes discovery first when needed), fills the React-controlled login form through the DOM, waits for native auth completion, and then verifies the authenticated Android push registration sync for the selected deployment when the login WebView already has a hydrated Android push token. Override `SECPAL_RUNTIME_URL`, `SECPAL_WEBVIEW_DEVTOOLS_URL`, or `SECPAL_WEBVIEW_TARGET_PATTERN` if your test target differs. If the app restarts and the `webview_devtools_remote_<pid>` socket changes, redo the `adb forward` step before rerunning the smoke command. The logout `/` -> `/login` reroute path from issue `#248` is covered by this smoke when the WebView starts from a fresh logged-out, unsynced state: the script now aborts if native auth or push sync already completed before the DOM login step, so a green run proves a fresh rehydrate-plus-login-plus-sync transition instead of reusing stale session state.

## Capacitor Setup

```bash
npm run cap:add:android
npm run cap:sync
npm run cap:open:android
```

`npm run cap:sync` automatically builds the shared frontend through its
`android-native` surface, verifies its deterministic `build-metadata.json`, and
packages the native-auth bootstrap as a content-hashed same-origin JavaScript
asset before the application module. The generated document keeps the
frontend's self-only script CSP and contains no executable inline script.

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

Release builds always keep screenshot protection enabled on the visible SecPal activities and do not enable WebView debugging. Use debug builds when you need local WebView inspection during device testing.

Signed release artifacts with a local upload key:

```bash
bash ./scripts/setup-android-release-keystore.sh
SECPAL_ANDROID_VERSION_CODE=2026072201 \
  npm run native:assemble:release:signed
SECPAL_ANDROID_VERSION_CODE=2026072201 \
  npm run native:bundle:release:signed
```

Fastlane can drive the same local signing flow and optionally upload the signed AAB to the Google Play internal testing track:

```bash
npm run fastlane:install
npm run fastlane:android:sync:play-assets
npm run fastlane:android:validate:play-assets
SECPAL_ANDROID_VERSION_CODE=2026072201 \
  npm run fastlane:android:build:signed-aab
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:internal
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:internal:with-metadata
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:direct-apk
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:direct-apk:beta
```

`VERSION` is the only visible app-version source and currently contains `0.1.0`; `npm run version:check` verifies its SemVer syntax, including numeric prerelease rules, and confirms that both npm metadata files match it. `SECPAL_ANDROID_VERSION_NAME` is obsolete and ignored.
Publishing lanes reserve a UTC `YYYYMMDDXX` code from `01` through `99` after reading the local baseline, Direct Stable, Direct Beta, and the configured Google Play tracks. `SECPAL_ANDROID_DEPLOY_VERSION_CODE` is the only manual publishing override. `SECPAL_ANDROID_VERSION_CODE` is only the temporary Gradle value; signed build-only commands require it explicitly and never reuse the published baseline.
`fastlane:android:sync:play-assets` imports curated texts, screenshots, and localized graphics from `./.local/play-assets` by default, or from `SECPAL_ANDROID_PLAY_ASSETS_SOURCE` when set, into `fastlane/metadata/android`, normalizing the icon to a Play-safe `512x512` canvas on the way.
`fastlane:android:validate:play-assets` checks the copied assets for required text limits, image sizes, screenshot counts, promotion-eligibility sizing, Play-safe preview image color modes, and screenshot aspect-ratio limits before a Play upload.
Every repository-provided signed release build command verifies that the signed APK and AAB embed the canonical schema-4 Android bridge before either artifact can reach a direct-download or Google Play upload step.
`deploy_internal_with_metadata` uploads the signed AAB together with the local `fastlane/metadata/android` store-listing payload and auto-materializes localized versioned Play changelogs from `fastlane/metadata/android/*/changelogs/default.txt` when the exact `versionCode` file is still missing.
`deploy_direct_apk` publishes the stable signed APK to `https://apk.secpal.app/android/stable/latest.json`, `https://apk.secpal.app/android/stable/app.secpal-latest.apk`, and `https://apk.secpal.app/android/stable/SHA256SUMS.txt`, refreshes the stable aliases at `https://apk.secpal.app/android/latest.json`, `https://apk.secpal.app/android/app.secpal-latest.apk`, and `https://apk.secpal.app/android/SHA256SUMS.txt`, and keeps versioned copies under `https://apk.secpal.app/android/releases/{version}/...`.
`deploy_direct_apk_beta` and `npm run fastlane:android:deploy:direct-apk:beta` publish the same signed APK to the beta channel under `https://apk.secpal.app/android/beta/...` without touching the stable aliases.
Direct Stable/Beta deploys share the canonical remote artifact-root lock from version selection through publication, so one deploy cannot race another. An ungraceful process or host termination can leave the empty `${SECPAL_ANDROID_DIRECT_ROOT}.release.lock` directory behind; after verifying that no direct release mutation is still running, remove only that empty directory with `rmdir` before retrying.
Direct channel endpoints are therefore:

- `https://apk.secpal.app/android/stable/latest.json`
- `https://apk.secpal.app/android/stable/app.secpal-latest.apk`
- `https://apk.secpal.app/android/stable/SHA256SUMS.txt`
- `https://apk.secpal.app/android/latest.json`
- `https://apk.secpal.app/android/app.secpal-latest.apk`
- `https://apk.secpal.app/android/SHA256SUMS.txt`
- `https://apk.secpal.app/android/beta/latest.json`
- `https://apk.secpal.app/android/beta/app.secpal-latest.apk`
- `https://apk.secpal.app/android/beta/SHA256SUMS.txt`

Release signing and version-code state use these environment variables:

- `SECPAL_ANDROID_CONFIG_DIR` to replace the default `~/.config/secpal` release context
- `SECPAL_ANDROID_RELEASE_ENV_FILE` to select an explicit release env file
- `SECPAL_ANDROID_LAST_PUBLISHED_VERSION_CODE` for the local successfully published baseline
- `SECPAL_ANDROID_DEPLOY_VERSION_CODE` for an optional publishing override
- `SECPAL_ANDROID_VERSION_CODE` for one explicit build-only invocation or Fastlane's temporary Gradle value
- `SECPAL_ANDROID_KEYSTORE_PATH`
- `SECPAL_ANDROID_KEYSTORE_PASSWORD`
- `SECPAL_ANDROID_KEY_ALIAS`
- `SECPAL_ANDROID_KEY_PASSWORD`

Every Fastlane publishing lane, including Direct Stable and Direct Beta, expects:

- `SECPAL_ANDROID_PLAY_JSON_KEY_PATH`

Direct APK upload defaults to `SECPAL_ANDROID_DIRECT_SSH_HOST=secpal-uberspace`
and `/var/www/virtual/secpal/apk.secpal.app` on Uberspace. The local signing
workstation therefore needs an SSH configuration entry named
`secpal-uberspace`. Override either setting only for a deliberate alternate
publication target:

- `SECPAL_ANDROID_DIRECT_SSH_HOST`
- `SECPAL_ANDROID_DIRECT_ROOT` when the target root differs from `/var/www/virtual/secpal/apk.secpal.app`
- `SECPAL_ANDROID_DIRECT_CHANNEL` when you want to publish to `beta` instead of the default `stable`

Samsung managed-device hard-key partner metadata can also be injected through environment variables when your Knox distribution path provides those values:

- `SECPAL_ANDROID_SAMSUNG_APP_KEY_PTT_DATA`
- `SECPAL_ANDROID_SAMSUNG_APP_KEY_SOS_DATA`

These inputs belong to the `io.secpal.dpc` receiver. Use partner metadata issued for that identity; Work no longer consumes it. Unset values remain empty for non-Samsung and local builds.

The recommended local secret file is `~/.config/secpal/android-release.env`. It stays outside the repository and can be loaded automatically by the signed release scripts. `SECPAL_ANDROID_CONFIG_DIR` changes the default release directory, while an explicit `SECPAL_ANDROID_RELEASE_ENV_FILE` takes precedence. The loader exports the exact file it selected so Fastlane reads and persists that same release context even if loaded values alter `HOME`. Fastlane keeps one runner-account-wide lock at `~/.config/secpal/android-publish.lock`, resolved from the operating-system account rather than the selected release env or process `HOME`, and creates its missing directory with mode `700`. The loader migrates an old `SECPAL_ANDROID_VERSION_CODE` baseline in memory, warns about and removes `SECPAL_ANDROID_VERSION_NAME` from the child environment, and never rewrites the file.
For Fastlane-based Play deployment, keep the Play service-account JSON outside the repository as well, for example at `~/.config/secpal/google-play-service-account.json`.

See `docs/ANDROID_RELEASE_DISTRIBUTION.md` for the distribution split between direct APK delivery and Google Play.
See `docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md` for the backup and recovery baseline for the Android upload key.
See `docs/ANDROID_FIRST_RELEASE_CHECKLIST.md` for the first direct-download and Play Store release gate.
See `docs/ANDROID_PLAY_CONSOLE_SETUP.md` for the concrete Play Console setup flow.
See `docs/ANDROID_LOCAL_DEVICE_TESTING.md` for real-device installation and local validation on Fedora/Linux.

The current release baseline uses:

- public app name: `SecPal`
- public developer or publisher name: `SecPal`
- application ID: `app.secpal` (Android identifier only, not a web domain)
- technical Android contact: `android@secpal.app`
- public support contact: `support@secpal.app`

## Quality Gates

Run the same baseline checks as other SecPal repositories:

```bash
./scripts/preflight.sh
```

The preflight script blocks direct pushes from `main`, runs formatting and governance checks, and executes lint, typecheck, tests, and native Android consistency checks.

## Licensing

SecPal-owned AGPL-covered files use `AGPL-3.0-or-later`.

Official SecPal product surfaces retain their intentional `Powered by SecPal – A guard's best friend` branding. This branding is not an additional license condition.

## Android Enterprise

See [current Android Enterprise capabilities](docs/ANDROID_ENTERPRISE_CAPABILITIES.md)
for the separate DPC, owner modes, managed configuration and qualification
boundaries.
