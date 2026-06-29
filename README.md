<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# SecPal Android

Android app for SecPal — operations software for German private security services. Built with Capacitor on top of the shared web frontend from `../frontend`.

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

Use the customer-facing instance URL that the user received, not a copied API path such as `/v1/...`. If onboarding links are distributed centrally, the Android discovery gate can also consume `instance_url`, `server_url`, or `bootstrap_url` query parameters, but the same bootstrap validation and confirmation still happens before login.

For the current SecPal live deployment, the bootstrap/input host is `https://api.secpal.dev`. `https://app.secpal.dev` remains the browser frontend host and does not currently expose `GET /v1/bootstrap` for Android runtime binding.

When the validated bootstrap enables `features.notification_channels.android_fcm`, the generic app initializes a deployment-scoped native Firebase runtime named `secpal-runtime-push` from `notification_channels.android_fcm.public_runtime_metadata`. It does not fall back to a bundled `google-services.json`, a SecPal-owned sender configuration, or token events emitted by another Firebase app instance.

The native shell requests the FCM token on-device, but the authenticated device binding is created only after native login succeeds against the selected customer API. The app then registers `PUT /v1/me/push-devices/{installationId}` on that canonical API origin, updates the same binding when the token rotates, and revokes it on logout or `Log out and switch instance` before clearing local runtime state. If that authenticated registration later fails with `409 NOTIFICATION_RUNTIME_STATE_INVALID` or `409 NOTIFICATION_CHANNEL_UNSUPPORTED`, the app clears the selected runtime and tenant-scoped browser state before returning to discovery so stale push metadata cannot survive a deployment switch.

For operator validation on a real device, confirm the app binds to the intended customer instance, login triggers the push-device registration on the customer API host, logout or instance reset revokes that registration, and no push traffic falls back to any SecPal-owned API or legacy Firebase setup.

## Local Setup

```bash
npm ci
npm --prefix ../frontend ci
```

If you need to regenerate launcher icons or splash assets with `npm run brand:sync`, install ImageMagick first so the `magick` CLI is available in your shell.

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

Release builds always keep screenshot protection enabled on the visible SecPal activities and do not enable WebView debugging. Use debug builds when you need local WebView inspection during device testing.

Signed release artifacts with a local upload key:

```bash
bash ./scripts/setup-android-release-keystore.sh
npm run native:assemble:release:signed
npm run native:bundle:release:signed
```

Fastlane can drive the same local signing flow and optionally upload the signed AAB to the Google Play internal testing track:

```bash
npm run fastlane:install
npm run fastlane:android:sync:play-assets
npm run fastlane:android:validate:play-assets
npm run fastlane:android:build:signed-aab
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:internal
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:internal:with-metadata
SECPAL_ANDROID_DIRECT_SSH_HOST=secpal \
  npm run fastlane:android:deploy:direct-apk
SECPAL_ANDROID_DIRECT_SSH_HOST=secpal \
  npm run fastlane:android:deploy:direct-apk:beta
```

`deploy_internal` automatically generates a fresh Play-safe `SECPAL_ANDROID_VERSION_CODE` when you do not pass one explicitly. If you need to force a one-off deploy value, pass `SECPAL_ANDROID_DEPLOY_VERSION_CODE=...` on the command line. A directly exported `SECPAL_ANDROID_VERSION_CODE=...` also wins when it differs from the baseline value stored in `~/.config/secpal/android-release.env`.
`fastlane:android:sync:play-assets` imports curated texts, screenshots, and localized graphics from `./.local/play-assets` by default, or from `SECPAL_ANDROID_PLAY_ASSETS_SOURCE` when set, into `fastlane/metadata/android`, normalizing the icon to a Play-safe `512x512` canvas on the way.
`fastlane:android:validate:play-assets` checks the copied assets for required text limits, image sizes, screenshot counts, promotion-eligibility sizing, Play-safe preview image color modes, and screenshot aspect-ratio limits before a Play upload.
`deploy_internal_with_metadata` uploads the signed AAB together with the local `fastlane/metadata/android` store-listing payload and auto-materializes localized versioned Play changelogs from `fastlane/metadata/android/*/changelogs/default.txt` when the exact `versionCode` file is still missing.
`deploy_direct_apk` publishes the stable signed APK to `https://apk.secpal.app/android/stable/latest.json`, `https://apk.secpal.app/android/stable/app.secpal-latest.apk`, and `https://apk.secpal.app/android/stable/SHA256SUMS.txt`, refreshes the stable aliases at `https://apk.secpal.app/android/latest.json`, `https://apk.secpal.app/android/app.secpal-latest.apk`, and `https://apk.secpal.app/android/SHA256SUMS.txt`, and keeps versioned copies under `https://apk.secpal.app/android/releases/{version}/...`.
`deploy_direct_apk_beta` and `npm run fastlane:android:deploy:direct-apk:beta` publish the same signed APK to the beta channel under `https://apk.secpal.app/android/beta/...` without touching the stable aliases.
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

Release signing is picked up from environment variables when present:

- `SECPAL_ANDROID_VERSION_CODE`
- `SECPAL_ANDROID_VERSION_NAME`
- `SECPAL_ANDROID_KEYSTORE_PATH`
- `SECPAL_ANDROID_KEYSTORE_PASSWORD`
- `SECPAL_ANDROID_KEY_ALIAS`
- `SECPAL_ANDROID_KEY_PASSWORD`

Google Play upload through Fastlane additionally expects:

- `SECPAL_ANDROID_PLAY_JSON_KEY_PATH`

Direct APK upload to the SecPal VPS expects:

- `SECPAL_ANDROID_DIRECT_SSH_HOST`
- `SECPAL_ANDROID_DIRECT_ROOT` when the target root differs from `/home/secpal/www/apk.secpal.app`
- `SECPAL_ANDROID_DIRECT_CHANNEL` when you want to publish to `beta` instead of the default `stable`

Samsung managed-device hard-key partner metadata can also be injected through environment variables when your Knox distribution path provides those values:

- `SECPAL_ANDROID_SAMSUNG_APP_KEY_PTT_DATA`
- `SECPAL_ANDROID_SAMSUNG_APP_KEY_SOS_DATA`

If those variables are unset, SecPal keeps the manifest entries present with empty values so the Android wrapper stays buildable across non-Samsung and local development flows.

The recommended local secret file is `~/.config/secpal/android-release.env`. It stays outside the repository and can be loaded automatically by the signed release scripts.
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

## Roadmap

See `docs/ANDROID_ENTERPRISE_ROADMAP.md` for the staged approach to DPC and admin capabilities.

The current product decision is to keep DPC-related capability inside the same `SecPal` app, with behavior depending on installation path and managed state rather than a separate Android package.

## Dedicated Device Mode

The same `SecPal` app can now run in two modes:

- normal Android app behavior when it is installed later on an already-running device without owner provisioning
- dedicated-device behavior when the app is provisioned as the device policy controller during fully managed setup

In dedicated-device mode, SecPal applies native Android policy from the DPC side instead of relying on the web layer:

- SecPal becomes the persistent home activity for the device
- a dedicated native home screen shows only approved apps such as SecPal, compatible Phone/SMS handlers, and other allowlisted packages in a homescreen-like icon grid
- kiosk lock-task mode is entered automatically when policy enables it
- launchable apps outside the allowlist are hidden from the launcher surface
- status-bar shortcuts and common device-configuration surfaces are disabled while dedicated-device kiosk policy is active, and common Settings intents are redirected back to the managed home screen so users cannot pivot into Settings and change system state
- SecPal itself remains the normal app experience when launched from that managed home screen

The currently supported provisioning and managed-configuration keys are:

- `secpal_kiosk_mode_enabled`: enable dedicated-device kiosk enforcement
- `secpal_lock_task_enabled`: keep Android lock task active inside dedicated-device mode; set this to `false` only when SecPal should still act as the managed home screen but users should be able to move normally between allowed apps. If you omit this flag, SecPal keeps lock task enabled by default, including the Phone/SMS dedicated-device case.
- `secpal_allow_phone`: allow launching a compatible dialer from the dedicated-device shell when Android exposes one on the device
- `secpal_allow_sms`: allow launching a compatible SMS app from the dedicated-device shell when Android exposes one on the device
- `secpal_prefer_gesture_navigation`: prefer gesture navigation for dedicated-device provisioning; if you omit this flag, SecPal now defaults it to `true` when kiosk mode is enabled and tries to apply gesture navigation during provisioning, falling back to the official system navigation screen on first launch when a device does not accept the managed settings silently
- `secpal_allowed_packages`: additional package allowlist as a string array or comma-separated list

If the app is not device owner or profile owner, these controls stay inactive and the package behaves like a normal Android application.

For local dedicated-device testing, the debug variant is intentionally marked as a `testOnly` app. That keeps one important rollback path open: if you assign the debug build as device owner through `adb shell dpm set-device-owner`, you can remove it again with `adb shell dpm remove-active-admin app.secpal/.SecPalDeviceAdminReceiver` instead of being forced into a factory reset every time.

That safety net is for debug testing only. Release builds must not rely on it.

For debug-only kiosk testing on a real device, you can also inject enterprise policy locally over ADB without rebuilding the app around provisioning extras. The debug receiver accepts:

- `app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY`
- `app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY`

Example to enable the strict kiosk case with only SecPal visible:

```bash
adb shell am broadcast -a app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY \
    --ez secpal_kiosk_mode_enabled true \
    app.secpal
```

On an unmanaged debug device, relaunching the app after that broadcast opens the dedicated-device home activity and exposes the configured kiosk tiles inside SecPal, but it does not grant real Android device-owner lock task or persistent HOME routing.

Example to clear the debug policy again:

```bash
adb shell am broadcast -a app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY app.secpal
```

Example to keep SecPal as the managed home screen but allow normal switching among approved apps:

```bash
adb shell am broadcast -a app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY \
    --ez secpal_kiosk_mode_enabled true \
    --ez secpal_lock_task_enabled false \
    --es secpal_allowed_packages 'com.example.approvedapp' \
    app.secpal
```

When the Android wrapper runs as device owner, the web layer can also trigger the supported system gesture-navigation flow through the injected enterprise bridge:

```js
await globalThis.SecPalEnterpriseBridge?.openGestureNavigationSettings();
```

That path opens the device's official navigation-mode settings screen from SecPal itself. On managed devices, SecPal temporarily leaves lock task so the settings page can open and then re-enters lock task automatically when the user returns to SecPal. The final switch to gesture navigation still happens inside the system settings UI; Android does not offer a portable public API that lets SecPal silently force that OEM-specific system setting by itself.

During dedicated-device provisioning, SecPal now also tries to apply the gesture-navigation preference automatically as part of the provisioning flow itself. On devices where Android accepts the managed secure/global settings directly, no extra user step is required. On devices that still insist on the OEM navigation settings UI, SecPal marks that setup as pending and opens the official gesture-navigation screen automatically on the first managed launch after provisioning so the remaining step still happens inside the provisioning hand-off instead of later from an app menu.
