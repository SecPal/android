<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: CC0-1.0
-->

# Android Enterprise capabilities

The checked-in builds separate device management and the Work app. They pin
each other's public signing certificates. The accepted
[client trust and recovery contract (ADR-026)](https://github.com/SecPal/.github/blob/main/docs/adr/20261002-client-trust-offline-recovery-adr026.md)
owns client-family identity and endpoint authorization.

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

Use the [local device testing runbook](ANDROID_LOCAL_DEVICE_TESTING.md)
for build, installation, owner assignment, debug policy and rollback. The
debug receiver requires Android's `DUMP` permission. Debug policy creates
neither owner authority nor authenticated kiosk state. Work enables its HOME
component only from an authenticated kiosk snapshot. Existing single-package
managed installations require explicit reprovisioning.

Gesture navigation is an Android and device-dependent provisioning step.
When the device requires its settings UI, the native provisioning handoff
opens the system screen. The WebView has no lock-task exit authority.

## Samsung hardware keys

The DPC accepts Samsung Knox XCover/PTT and SOS key signals in Device Owner
and Profile Owner modes. Its receiver requires the platform-signature-protected
Knox permission, checks the managed mode and verifies the configured Work
signing certificate before launching Work for an admitted short or long press.

OEM launch behavior depends on the device and its Knox configuration.
The April 2026 managed Samsung XCover 7 (`SM-G556B`, Android 16) runs
recorded physical key delivery while kiosk mode was active. The later run
provides indirect short- and long-press navigation evidence from native logs.
It used the former single-package owner layout. See the
[device investigation](https://github.com/SecPal/android/issues/145),
[April 26 run](https://github.com/SecPal/android/issues/123#issuecomment-4322776307),
and [signed historical source](https://github.com/SecPal/android/blob/9751f06ad0043cc71c9d2da877b54a5d1f8956fc/docs/ANDROID_LOCAL_DEVICE_TESTING.md#samsung-xcover-hard-key-validation-notes).

## Scope of evidence

Native policy tests cover owner-mode detection, Android-version policy
differences and screen-capture restrictions. The local dedicated-device
procedure verifies the actual owner role on a test device. Debug policy
injection exercises configuration without conferring Android owner authority.
Endpoint approval, user authorization and production distribution have their
own acceptance contracts.
