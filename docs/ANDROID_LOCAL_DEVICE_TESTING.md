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
./scripts/with-android-env.sh bash -lc 'adb shell monkey -p app.secpal.app -c android.intent.category.LAUNCHER 1'
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
