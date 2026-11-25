<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# Android Enterprise capabilities

Privileged device management is implemented by the separate `io.secpal.dpc`
application. The current Work build retains the `app.secpal` package
identity and an independent signing authority. The two builds pin each
other's public signing certificates. The accepted
[client trust and recovery contract (ADR-026)](https://github.com/SecPal/.github/blob/main/docs/adr/20261002-client-trust-offline-recovery-adr026.md)
defines client-family identity and endpoint authorization.

## Owner modes

Work runs normally with no authenticated DPC. The DPC reports the effective
owner mode through the authenticated management channel. Both owner modes
can enforce screen-capture policy within their Android scope. Only
Device Owner can enforce the dedicated-device policy below.

## Dedicated-device controls

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

Managed configuration and provisioning extras target `io.secpal.dpc`. Work itself is never Device Owner or Profile Owner. Without that authenticated owner, privileged controls remain inactive.

For local dedicated-device testing, build both APKs with independent local debug certificates and mutual public certificate pins. The complete build/install/owner/rollback sequence is in [Local device testing](ANDROID_LOCAL_DEVICE_TESTING.md#safe-dedicated-device-test-flow). The debug DPC is `testOnly`, so its owner role can be removed with:

```bash
adb shell dpm remove-active-admin io.secpal.dpc/app.secpal.SecPalDeviceAdminReceiver
```

Release builds cannot use that test rollback path. Existing single-package managed installations require explicit reprovisioning; updating Work does not transfer the owner role.

The DPC debug receiver accepts `app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY` and `app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY`. It requires Android’s `DUMP` permission and targets the DPC package:

```bash
adb shell am broadcast --include-stopped-packages \
    -a app.secpal.action.DEBUG_SET_ENTERPRISE_POLICY \
    --ez secpal_kiosk_mode_enabled true \
    -n io.secpal.dpc/app.secpal.DebugEnterprisePolicyReceiver
adb shell am start -n app.secpal/.MainActivity
adb shell input keyevent KEYCODE_HOME
```

Work enables its HOME component only from an authenticated kiosk snapshot. The former unmanaged debug kiosk simulation has been removed: debug policy does not manufacture an owner role or Work capabilities. To clear the test policy:

```bash
adb shell am broadcast --include-stopped-packages \
    -a app.secpal.action.DEBUG_CLEAR_ENTERPRISE_POLICY \
    -n io.secpal.dpc/app.secpal.DebugEnterprisePolicyReceiver
adb shell am start -n app.secpal/.MainActivity
```

Gesture navigation is an Android and device-dependent provisioning step.
When the device requires its settings UI, the native provisioning handoff
opens the system screen. The WebView has no lock-task exit authority.

## Scope of evidence

Native policy tests cover owner-mode detection, Android-version policy
differences and screen-capture restrictions. The local dedicated-device
procedure verifies the actual owner role on a test device. Debug policy
injection exercises configuration without conferring Android owner authority.
Endpoint approval, user authorization and production distribution have their
own acceptance contracts.
