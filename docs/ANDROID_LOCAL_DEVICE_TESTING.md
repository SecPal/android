<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Local Testing On A Physical Android Device

This guide covers the local path for building, installing, and validating the SecPal Android app on a real Android device.

## Prerequisites

On Fedora, install the baseline packages first:

```bash
sudo dnf install android-tools java-21-openjdk-devel nodejs npm
```

After installing, verify the Node and npm versions meet the minimum required by this repository (`engines` in `package.json`):

```bash
node --version   # must be >= 22.0.0
npm --version    # must be >= 10.0.0
```

Fedora's packaged `nodejs` may be older than Node 22. If `node --version` reports a lower version, install Node 22 via a version manager such as `nvm` or `fnm`, or use the NodeSource RPM repository:

```bash
# nvm (https://github.com/nvm-sh/nvm)
nvm install 22
nvm use 22

# fnm (https://github.com/Schniz/fnm)
fnm install 22
fnm use 22
```

The Android repository expects Java 21 and an Android SDK that is available under `~/Android/Sdk` unless you override it explicitly.

Required SDK components:

- Android SDK Command-Line Tools
- Android SDK Platform-Tools
- at least one Android platform matching the current Gradle configuration
- the Android Build-Tools version requested by Gradle during `assembleDebug`

If `sdkmanager` is not yet available, install the command-line tools and place them under:

```text
$HOME/Android/Sdk/cmdline-tools/latest/
```

The repository helper script automatically uses these defaults when they exist:

- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk`
- `ANDROID_SDK_ROOT=$HOME/Android/Sdk`

## Verify The Local Toolchain

Run the checks below from the Android repository root:

```bash
java -version
./scripts/with-android-env.sh bash -lc 'echo "$JAVA_HOME" && echo "$ANDROID_SDK_ROOT"'
./scripts/with-android-env.sh bash -lc 'sdkmanager --version'
./scripts/with-android-env.sh bash -lc 'adb version'
```

If you prefer to disable Capacitor CLI telemetry on your local machine, run:

```bash
npx cap telemetry off
```

## Prepare The Device

1. Open Android settings on the device.
2. Enable Developer Options.
3. Enable USB debugging.
4. Connect the device over USB.
5. Accept the host trust prompt on the device when Android asks to allow USB debugging.

Confirm that `adb` can see the device:

```bash
./scripts/with-android-env.sh bash -lc 'adb devices'
```

Expected result: the device appears with the state `device`.

If the device appears as `unauthorized`, unlock the device and accept the trust prompt.

## Build And Sync The App

Install repository dependencies once if needed:

```bash
npm ci
npm --prefix ../frontend ci
```

Build the shared frontend, sync Capacitor, and assemble a debug APK:

```bash
npm run cap:sync
npm run native:assemble:debug
```

If Gradle asks for a missing Android Build-Tools package, allow the installation or install the requested version with `sdkmanager` and rerun the command.

## Install On The Device

Install or replace the debug build on the connected device:

```bash
./scripts/with-android-env.sh bash -lc 'adb install -r android/app/build/outputs/apk/debug/app-debug.apk'
```

Launch the app manually on the device, or trigger a basic launch from the shell:

```bash
./scripts/with-android-env.sh bash -lc 'adb shell monkey -p app.secpal -c android.intent.category.LAUNCHER 1'
```

## Useful Validation Commands

Clear logcat and watch runtime logs while testing:

```bash
./scripts/with-android-env.sh bash -lc 'adb logcat -c && adb logcat -v threadtime'
```

Run the Android repo checks that matter most before testing a device build:

```bash
CI=1 npx vitest run tests/capacitor-config.test.ts
npm run native:assemble:debug
```

If your current change also affects the shared frontend authentication flow or API host handling, run the relevant frontend checks from `../frontend` before syncing again.

## Troubleshooting

### `adb devices` shows no devices

- confirm the USB cable supports data, not only charging
- reconnect the device after enabling USB debugging
- switch the device USB mode away from charge-only if Android offers the choice

### `adb devices` shows `unauthorized`

- unlock the device
- accept the USB debugging trust prompt
- if needed, revoke USB debugging authorizations on the device and reconnect

### `adb devices` shows a permission error on Linux

- ensure `android-tools` is installed
- reconnect the device after the package install
- reload udev rules if your system uses vendor-specific rules
- if the problem persists, add the appropriate udev rule for the device vendor and reconnect the device

### Gradle fails because a build-tools package is missing

- install the version Gradle requests with `sdkmanager`
- rerun `npm run native:assemble:debug`

### The app installs but shows stale web content

- rerun `npm run cap:sync`
- reinstall the APK with `adb install -r`
- if needed, uninstall the app once and install again to remove old debug state

## Safe Dedicated-Device Test Flow

If you want to test the DPC and device-owner path on a disposable device, prefer the debug APK first.

Why this is safer:

- the debug Android manifest marks the app as `testOnly`
- Android's `dpm remove-active-admin` shell command can then remove the active admin and owner role again
- you keep a rollback path over USB without having to rely on the app UI staying reachable

Recommended sequence:

```bash
npm run cap:sync
npm run native:assemble:debug
./scripts/with-android-env.sh bash -lc 'adb install -r -t android/app/build/outputs/apk/debug/app-debug.apk'
./scripts/with-android-env.sh bash -lc 'adb shell dpm set-device-owner app.secpal/.SecPalDeviceAdminReceiver'
```

Rollback path for the debug build:

```bash
./scripts/with-android-env.sh bash -lc 'adb shell dpm remove-active-admin app.secpal/.SecPalDeviceAdminReceiver'
```

Enable the strict kiosk case where only SecPal stays visible:

```bash
./scripts/with-android-env.sh bash -lc 'adb shell am broadcast -a app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY --ez secpal_kiosk_mode_enabled true app.secpal'
./scripts/with-android-env.sh bash -lc 'adb shell monkey -p app.secpal -c android.intent.category.LAUNCHER 1'
```

On the current Samsung XCover 7 test device, that launcher start is not yet the final kiosk proof by itself. After running both commands above, and specifically after the launcher start command, press HOME once or run:

```bash
./scripts/with-android-env.sh bash -lc 'adb shell input keyevent KEYCODE_HOME'
```

Expected result: `DedicatedDeviceHomeActivity` becomes the top activity and `dumpsys activity activities` reports `mLockTaskModeState=LOCKED`.

Allow SecPal plus Phone and SMS:

```bash
./scripts/with-android-env.sh bash -lc 'adb shell am broadcast -a app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY --ez secpal_kiosk_mode_enabled true --ez secpal_allow_phone true --ez secpal_allow_sms true app.secpal'
```

Allow normal navigation between SecPal and a curated app set while still keeping SecPal as HOME:

```bash
./scripts/with-android-env.sh bash -lc "adb shell am broadcast -a app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY --ez secpal_kiosk_mode_enabled true --ez secpal_lock_task_enabled false --es secpal_allowed_packages 'com.android.chrome,com.android.settings' app.secpal"
```

With that policy, the dedicated-device home screen shows only the approved apps and HOME keeps returning to that managed launcher instead of the stock launcher.

Clear the debug kiosk policy again without removing device owner:

```bash
./scripts/with-android-env.sh bash -lc 'adb shell am broadcast -a app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY app.secpal'
```

## Samsung XCover Hard-Key Validation Notes

For the current XCover 7 validation path, seed the Samsung secure settings explicitly after the device-owner and kiosk steps:

```bash
./scripts/with-android-env.sh bash -lc 'adb shell settings put secure short_press_app app.secpal/app.secpal.SamsungEmergencyShortPressAlias'
./scripts/with-android-env.sh bash -lc 'adb shell settings put secure long_press_app app.secpal/app.secpal.SamsungEmergencyLongPressAlias'
./scripts/with-android-env.sh bash -lc 'adb shell settings put secure dedicated_app_xcover app.secpal'
./scripts/with-android-env.sh bash -lc 'adb shell settings put secure dedicated_app_xcover_switch 1'
./scripts/with-android-env.sh bash -lc 'adb shell settings put secure active_key_on_lockscreen 1'
```

Known limits from real-device validation on `SM-G556B` / Android 16:

- The single physical special key currently identifiable on this device maps to Samsung `keyCode=1015` (XCover/PTT path). A raw `getevent -lt` capture exposes it as Linux input key `0x00fc`, and Android delivers it to `MainActivity` as `keyCode=1015` when SecPal is already in the foreground.
- With `MainActivity` foregrounded, the same physical key reaches SecPal through the normal `dispatchKeyEvent` path and the app emits the regular enterprise-bridge hardware-button events. In the captured run, short presses produced `hardwareButtonPressed` / `hardwareButtonShortPressed`, which proves the in-app key path works even without Samsung partner tokens.
- The kiosk-home problem remains separate: from `DedicatedDeviceHomeActivity`, the same physical key still did not produce a detectable Samsung `HARD_KEY_*` launch or bring SecPal back to `MainActivity` in the local no-token setup.
- SecPal treats long presses only at `>= 5000 ms`. If you try to validate the long-press event path in `MainActivity`, hold the special key for at least five full seconds; shorter holds still resolve to the short-press event.
- `adb shell input keyevent 1015` and `adb shell input keyevent 1079` do not reproduce the OEM Samsung hardware-button route. Even in device-owner kiosk mode with the secure settings above, the device stays on `DedicatedDeviceHomeActivity` with `mLockTaskModeState=LOCKED`.
- `adb shell am start -n app.secpal/.SamsungEmergencyShortPressAlias` is expected to fail with `Permission Denial` because the Samsung alias activities are not exported. That means plain ADB cannot simulate the external alias launch path either.
- The final proof for issue `#123` still requires a real physical XCover or SOS button press on the managed device.
- Local builds keep `app_key_ptt_data` and `app_key_sos_data` empty unless `SECPAL_ANDROID_SAMSUNG_APP_KEY_PTT_DATA` and `SECPAL_ANDROID_SAMSUNG_APP_KEY_SOS_DATA` are provided before the build. If your Samsung distribution path depends on partner-issued app-key metadata, validate with those values present instead of repeating the empty-token local build.

Important notes:

- keep USB debugging enabled before starting the device-owner test
- keep this host authorized for ADB on the device
- test the debug flow first before attempting provisioning with a release build
- if owner assignment fails or the shell path is lost, the device's stock recovery and a manual factory reset remain the fallback

On a normal retail Android device, I cannot safely promise a fully unattended factory reset purely from the current ADB shell context. The reliable last-resort reset path remains physical recovery mode on the device itself.
