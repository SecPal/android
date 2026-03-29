<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android First Release Checklist

This checklist is the baseline for the first real SecPal Android release.

## Product Identity

- app name is `SecPal`
- public developer or publisher name is `SecPal`
- application ID is `app.secpal.app` (Android identifier only, not a web domain)
- one shared app identity is used for direct download, DPC rollout, and Google Play
- technical Android contact is `android@secpal.app`
- public support contact is `support@secpal.app`

## Signing And Secrets

- upload key exists outside the repository under `~/.config/secpal/`
- `android-upload.jks` and `android-release.env` are backed up together
- recovery of the keystore has been tested on a clean environment or documented dry-run
- the team understands that the same signing identity is used for direct distribution and Play uploads

## Repository Validation

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run cap:sync`
- `npm run native:assemble:debug`
- `npm run native:assemble:release:signed`
- `npm run native:bundle:release:signed`

## Direct Download Readiness

- signed release APK exists
- version code is set and does not move backwards
- upgrade path from older internal builds is understood
- installation instructions for enterprise customers are prepared
- DPC-related onboarding assumes the same app package and signature as the public app

## Google Play Readiness

- Google Play Developer account exists and is legally tied to the correct real identity
- public Play developer name is set to `SecPal`
- Google Play App Signing decision is documented
- store listing text, screenshots, icon, privacy URL, and support URL are ready
- internal testing track is prepared before production rollout

See `docs/ANDROID_PLAY_CONSOLE_SETUP.md` for the operational Play Console setup sequence.

## DPC Strategy

- DPC capability remains part of the same `SecPal` app instead of a separate enterprise-only app
- feature enablement depends on installation path, policy mode, and managed configuration rather than a separate package name
- package name and signing key are treated as long-term stable identifiers

## Go Or No-Go

Do not publish if any of these are still unclear:

- signing-key custody
- backup and recovery path
- final public support address
- Play Console owner identity
- versioning policy for updates
