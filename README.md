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

Release signing is picked up from environment variables when present:

- `SECPAL_ANDROID_VERSION_CODE`
- `SECPAL_ANDROID_VERSION_NAME`
- `SECPAL_ANDROID_KEYSTORE_PATH`
- `SECPAL_ANDROID_KEYSTORE_PASSWORD`
- `SECPAL_ANDROID_KEY_ALIAS`
- `SECPAL_ANDROID_KEY_PASSWORD`

Samsung managed-device hard-key partner metadata can also be injected through environment variables when your Knox distribution path provides those values:

- `SECPAL_ANDROID_SAMSUNG_APP_KEY_PTT_DATA`
- `SECPAL_ANDROID_SAMSUNG_APP_KEY_SOS_DATA`

If those variables are unset, SecPal keeps the manifest entries present with empty values so the Android wrapper stays buildable across non-Samsung and local development flows.

The recommended local secret file is `~/.config/secpal/android-release.env`. It stays outside the repository and can be loaded automatically by the signed release scripts.

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
