<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Release And Distribution

This repository can support both SecPal distribution channels on Android:

- direct APK delivery for managed Android Enterprise and DPC-related rollouts
- Google Play distribution for the public app and managed Google Play scenarios

## Current Technical Baseline

- package/application ID: `app.secpal.app`
- current visible app name: `SecPal`
- intended publisher display name: `SecPal`
- technical Android contact: `android@secpal.app`
- public user-facing support contact: `support@secpal.app`
- debug APK build verified locally from this repository
- release version and signing parameters can be injected through environment variables

These values are now aligned with the recommended first-release baseline.

## Recommended Baseline Decisions

For the first production-ready Android rollout, the recommended baseline is:

- public app name: `SecPal`
- public developer or publisher name: `SecPal`
- application ID: `app.secpal.app`
- one shared app identity for direct download, DPC rollouts, and Google Play
- technical Android contact: `android@secpal.app`
- public user-facing support contact: `support@secpal.app`

This is the simplest durable setup because it keeps branding, upgrades, and Play distribution aligned from day one.

## Developer Identity

The Google Play Console account must always be backed by a real legal identity, but the public developer name shown in the store does not need to be a private person's name if the product should appear under an organizational brand.

For SecPal, the recommended public presentation is:

- real account holder: the legally correct natural person or company behind SecPal
- public developer name in the Play Store: `SecPal`

That keeps the store listing consistent with the app branding and avoids coupling the public product identity to an individual person's name.

## Recommended Release Model

Use one signing identity and one application ID for both channels unless there is a hard product reason to split them.

That gives you:

- one upgrade path between direct installs and Play installs
- one managed Google Play listing if the app is later distributed to enterprise tenants
- simpler support and fewer migration risks

For the current SecPal setup, this means `app.secpal.app` is the better default than Android-specific variants such as `app.secpal.android` or transitional names such as `app.secpal.app.mobile`.

The chosen SecPal baseline is to keep DPC capability inside the same `SecPal` app instead of creating a second enterprise-only package. Installation path, policy state, and managed configuration should determine behavior, not a different application ID.

## Google Developer Account

A Google Play Developer account is only required to publish through Google Play.

It is not required to:

- generate a signed release APK
- generate a signed Android App Bundle (`.aab`)
- deliver APKs directly to customers or test devices

## Direct Download And DPC Considerations

For DPC and enterprise distribution, direct APK delivery remains useful for:

- controlled customer onboarding
- EMM or MDM-based side loading flows
- early device-owner and profile-owner pilots before Play distribution is ready

Keep in mind that direct distribution still needs:

- a stable application ID
- a stable signing key
- a versioning strategy that never goes backwards

## Play Store Considerations

For Play distribution, plan for:

- Google Play App Signing
- Play Console metadata and store assets
- privacy, support, and contact details on `secpal.app`
- internal, closed, and production tracks

If Android Enterprise distribution through managed Google Play is a target, Play Console setup becomes useful even if direct APK delivery stays available.

## Environment Variables For Release Builds

The Gradle app module reads these variables when present:

- `SECPAL_ANDROID_VERSION_CODE`
- `SECPAL_ANDROID_VERSION_NAME`
- `SECPAL_ANDROID_KEYSTORE_PATH`
- `SECPAL_ANDROID_KEYSTORE_PASSWORD`
- `SECPAL_ANDROID_KEY_ALIAS`
- `SECPAL_ANDROID_KEY_PASSWORD`

Recommended local file location:

- `~/.config/secpal/android-release.env`

Recommended keystore location:

- `~/.config/secpal/android-upload.jks`

This repository provides helper scripts for that layout:

- `scripts/setup-android-release-keystore.sh`
- `scripts/load-android-release-env.sh`

Example:

```bash
bash ./scripts/setup-android-release-keystore.sh
npm run native:assemble:release:signed
npm run native:bundle:release:signed
```

The setup script creates both the keystore and the local env file, with file mode `600` to reduce accidental exposure on shared systems.

## Open Product Decisions

Before the first public release, finalize at least:

- signing-key custody and backup process

For Play Store publication, also decide whether Google Play App Signing will use the same upload key you generate locally or whether you want a dedicated rotated upload key once the Play Console is active.

See `docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md` for the operational key-handling baseline and `docs/ANDROID_FIRST_RELEASE_CHECKLIST.md` for the first public release gate.
See `docs/ANDROID_PLAY_CONSOLE_SETUP.md` for the Play Console setup flow that matches the shared-app SecPal baseline.
