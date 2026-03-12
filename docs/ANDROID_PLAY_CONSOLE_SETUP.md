<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Play Console Setup

This document is the operational setup guide for the first SecPal Android publication in Google Play.

## Target Baseline

Use this baseline consistently:

- app name: `SecPal`
- public developer name: `SecPal`
- application ID: `app.secpal.app`
- technical Android contact: `android@secpal.app`
- public support contact: `support@secpal.app`
- one shared app for direct download, DPC capability, and Google Play

## 1. Create The Developer Account

Create the Google Play Developer account with the correct real legal identity behind SecPal.

Recommended rule:

- legal account owner: the real person or company legally responsible for SecPal
- public developer name in Play: `SecPal`

Do not optimize for anonymity here. Optimize for long-term control, billing clarity, and transferability.

## 2. Create The App In Play Console

Create one Android app with:

- default app name: `SecPal`
- default language: your primary store language
- app type: app
- free or paid: based on the actual business model

Use the same application identity that is already built locally:

- package name: `app.secpal.app`

## 3. App Signing Decision

Recommended model:

1. keep the existing local upload key under `~/.config/secpal/`
2. enroll in Google Play App Signing
3. upload signed artifacts using the same local upload key

That preserves compatibility with direct distribution while still using the standard Play signing model.

## 4. Upload The First Internal Build

Before any public rollout:

1. create an internal testing track
2. upload the signed AAB produced by `npm run native:bundle:release:signed`
3. verify package name, version code, and release notes
4. confirm that the uploaded app is still `app.secpal.app`

## 5. Store Listing Requirements

Prepare at least:

- short description
- full description
- app icon
- feature graphic if required by the chosen listing setup
- screenshots for supported device classes
- support email: `support@secpal.app`
- support URL on `secpal.app` when available
- privacy policy URL on `secpal.app`

Keep the wording aligned with the single-app strategy: one SecPal app, with managed and enterprise behavior depending on installation and policy state.

## 6. Policy And Compliance

Work through these Play Console sections before production:

- app access
- ads declaration
- data safety
- content rating
- target audience
- government or regulated use declarations if applicable
- permissions disclosure for sensitive Android capabilities once DPC functionality expands

Do not answer these speculatively. Complete them only against the real shipped behavior.

## 7. Testing Track Strategy

Recommended sequence:

1. internal testing
2. closed testing
3. production

If DPC-related features are introduced incrementally, keep them behind controlled enablement rather than branching into a second Play app.

## 8. Managed Google Play And DPC

The current SecPal decision is to keep DPC capability inside the same app.

That means:

- managed Google Play should distribute the same `app.secpal.app` package
- direct APK distribution should use the same package and signing identity
- enterprise behavior should be controlled by policy, provisioning mode, or configuration, not by a separate package name

## 9. First Publish Gate

Do not publish to production until all of these are true:

- signed AAB upload works
- support address is live
- privacy policy URL is live
- store assets are final enough for public exposure
- keystore backup and recovery path is documented and tested
- versioning policy is understood
- direct-download and Play paths do not diverge in package name or signing identity
