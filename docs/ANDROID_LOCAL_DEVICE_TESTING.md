<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# Local testing on an Android device

Start with the [repository prerequisites](../README.md#local-setup). Install
the SDK platform and Build Tools requested by Gradle. Use the frontend checkout
at [the pinned revision](../android/frontend-revision.txt). Launcher icon
regeneration with `npm run brand:sync` needs ImageMagick 7 (`magick`) or
ImageMagick 6 (`convert`).

## Prepare the device

Use an authorized development device. Enable USB debugging, connect it over USB
and accept the host trust prompt. Select the intended device with `ANDROID_SERIAL`
if several devices are connected.

```bash
./scripts/with-android-env.sh sdkmanager --version
./scripts/with-android-env.sh adb devices
```

Expect the device state `device`. For `unauthorized`, unlock the device and
accept the prompt. Check the USB data cable and platform udev rules if the
device is missing.

Secure WebView access requires Android System WebView or Chrome version 83 or
later and AndroidX `WEB_MESSAGE_LISTENER`. A provider that lacks the feature
triggers the native update screen before Capacitor starts. Update managed
devices through their EMM or managed Google Play configuration.

## Build, install and verify

From the repository root:

```bash
npm ci
npm --prefix ../frontend ci
npm run cap:sync
npm run native:assemble:debug
./scripts/with-android-env.sh adb install -t -r android/app/build/outputs/apk/debug/app-debug.apk
./scripts/with-android-env.sh adb shell monkey -p app.secpal -c android.intent.category.LAUNCHER 1
```

After changing shared frontend code, run its affected checks before repeating
`cap:sync` and rebuilding. Use the relevant repository preflight and
`./scripts/with-android-env.sh adb logcat -v threadtime` to diagnose a run.
Final native push qualification belongs to [#601](https://github.com/SecPal/android/issues/601).

## Dedicated-device test

Use a disposable device and the separate local `testOnly` debug APKs. Assign
Device Owner to `io.secpal.dpc`. The app under test, `app.secpal`, consumes
authenticated management state. The debug broadcast configures policy through
Android's `DUMP` permission. Android grants owner authority separately.

Build with independent test certificates and public peer pins:

```bash
(
  set -euo pipefail
  npm run cap:sync
  work_signing_report="$(mktemp)"
  trap 'rm -f "$work_signing_report"' EXIT
  (cd android && ./gradlew --no-daemon :dpc:prepareDebugSigning :app:validateSigningDebug \
      :app:signingReport --console=plain) > "$work_signing_report"
  SECPAL_DPC_CERT_SHA256="$(keytool -exportcert \
      -keystore android/.gradle/dpc-debug.keystore -storepass android \
      -alias androiddebugkey | sha256sum | cut -d ' ' -f 1)"
  SECPAL_WORK_CERT_SHA256="$(awk '
      $0 == "Variant: debug" { selected = 1; next }
      selected && $1 == "SHA-256:" { gsub(":", "", $2); print tolower($2); exit }
  ' "$work_signing_report")"
  [[ "$SECPAL_DPC_CERT_SHA256" =~ ^[a-f0-9]{64}$ ]]
  [[ "$SECPAL_WORK_CERT_SHA256" =~ ^[a-f0-9]{64}$ ]]
  test "$SECPAL_DPC_CERT_SHA256" != "$SECPAL_WORK_CERT_SHA256"
  export SECPAL_DPC_CERT_SHA256 SECPAL_WORK_CERT_SHA256
  (cd android && ./gradlew --no-daemon :app:assembleDebug :dpc:assembleDebug)
  ./scripts/with-android-env.sh adb install -t -r android/dpc/build/outputs/apk/debug/dpc-debug.apk
  ./scripts/with-android-env.sh adb install -t -r android/app/build/outputs/apk/debug/app-debug.apk
  ./scripts/with-android-env.sh adb shell dpm set-device-owner io.secpal.dpc/app.secpal.SecPalDeviceAdminReceiver
)
```

These are public certificate digests. Keep production signing keys out of
this test.

Enable strict Device Owner kiosk policy, start Work so it consumes the authenticated state, then enter the managed home:

```bash
./scripts/with-android-env.sh adb shell am broadcast --include-stopped-packages \
    -a app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY \
    --ez secpal_kiosk_mode_enabled true \
    -n io.secpal.dpc/app.secpal.DebugEnterprisePolicyReceiver
./scripts/with-android-env.sh adb shell am start -n app.secpal/.MainActivity
./scripts/with-android-env.sh adb shell input keyevent KEYCODE_HOME
```

Verify that `dpm list-owners` identifies the DPC as Device Owner and that
`dumpsys activity activities` reports `mLockTaskModeState=LOCKED`. The app
enters lock task after Android grants eligibility. Profile Owner policy is
limited to the managed profile. See the
[Android Enterprise capabilities](ANDROID_ENTERPRISE_CAPABILITIES.md) for
the owner boundaries and the Samsung qualification evidence.

Clear debug policy without removing the owner:

```bash
./scripts/with-android-env.sh adb shell am broadcast --include-stopped-packages \
    -a app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY \
    -n io.secpal.dpc/app.secpal.DebugEnterprisePolicyReceiver
./scripts/with-android-env.sh adb shell am start -n app.secpal/.MainActivity
```

Work disables its dedicated HOME component after the authenticated kiosk state ends. Missing or unavailable DPC state grants no capability and cannot itself exit an existing lock task. Existing Work-owned installations require explicit reprovisioning; installing these APKs does not transfer ownership.

Rollback the debug owner:

```bash
./scripts/with-android-env.sh adb shell dpm remove-active-admin io.secpal.dpc/app.secpal.SecPalDeviceAdminReceiver
```

If ADB rollback is unavailable, use the test device's manufacturer recovery
procedure. A factory reset erases the device's data.
