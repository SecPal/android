<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Release And Distribution

This repository can support both SecPal distribution channels on Android:

- direct APK delivery for managed Android Enterprise and DPC-related rollouts
- Google Play distribution for the public app and managed Google Play scenarios

## Current Technical Baseline

- package/application ID: `app.secpal` (Android identifier only, not a web domain)
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
- application ID: `app.secpal` (Android identifier only, not a web domain)
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

For the current SecPal setup, this means `app.secpal` is the better default than Android-specific variants such as an application ID ending in `.android` or transitional names such as an ID ending in `.mobile`.

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

## Customer-Hosted Bootstrap Contract

The generic Android app no longer ships with a baked-in production runtime API origin. Every customer-hosted deployment that should work with the generic app must expose a public unauthenticated `GET /v1/bootstrap` endpoint on the HTTPS instance URL users receive.

In the current SecPal live split, `https://api.secpal.dev` is the bootstrap/API host and `https://app.secpal.dev` remains the browser frontend host.

The bootstrap response is the binding contract for Android login and must provide at least:

- the canonical `api_base_url` for runtime API calls, as a bare HTTPS origin or its `/v1` endpoint
- `instance.display_name` so the user can confirm the correct deployment before login
- compatibility metadata such as `bootstrap_version`, `schema_version`, `minimum_supported_app_version`, and `minimum_supported_app_build`
- the feature flags required by the login shell
- when `features.notification_channels.android_fcm` is enabled, the canonical `notification_channels.android_fcm` runtime metadata required to initialize the customer-owned native runtime (`channel`, `metadata_revision`, and `public_runtime_metadata.{api_key,project_id,application_id,sender_id}`)

If the customer-facing instance URL and the canonical API host differ, keep `GET /v1/bootstrap` reachable on the customer-facing URL and let `api_base_url` point to the canonical API host. The Android app persists that canonical API origin only after the user confirms the resolved instance.

If bootstrap is missing, incompatible, or unreachable, the Android app stays on the discovery gate and does not fall back to `https://api.secpal.dev` or any other fixed production origin.

Confirmed deployments are restored only from the structured native runtime-bootstrap payload returned by `SecPalNativeAuthBridge.getRuntimeBootstrap()`. Updated builds intentionally removed the obsolete injected bridge path that confirmed or restored deployments through `SecPalNativeAuth.setApiBaseUrl(...)`, JavaScript session-storage bootstrap state, legacy `apiOrigin`-only state, or a baked-in production origin.

## Customer-Owned Android Push Runtime

When a validated bootstrap enables Android push, the generic Android app uses that deployment metadata as the only source of truth for native push runtime behavior.

- The app initializes the named native Firebase runtime `secpal-runtime-push` from the customer-owned metadata and does not rely on a bundled `google-services.json` file or a SecPal-owned default sender.
- Native FCM token retrieval happens on-device, but the authenticated backend binding is created only after native login succeeds against the selected customer API origin.
- The login flow registers `PUT /v1/me/push-devices/{installationId}` on the canonical API origin returned by bootstrap.
- Later token refreshes update that same installation binding with `lifecycle_event=token_rotated` instead of creating a second device registration.
- Logout and destructive instance reset revoke `DELETE /v1/me/push-devices/{installationId}` before the app clears local runtime state.
- If authenticated registration returns `409 NOTIFICATION_RUNTIME_STATE_INVALID` or `409 NOTIFICATION_CHANNEL_UNSUPPORTED`, the app clears the selected runtime, logout state, and tenant-scoped browser storage before discovery resumes so stale notification metadata cannot leak across deployment switches.
- Token or error events from any Firebase app instance other than `secpal-runtime-push` are ignored so a customer-owned runtime cannot silently fall back to a stale or foreign push configuration.

For operator rollout validation on a real Android device, verify at least:

- the bootstrap payload includes the expected `features.notification_channels.android_fcm` flag and canonical `notification_channels.android_fcm` metadata for the customer deployment
- login triggers `PUT /v1/me/push-devices/{installationId}` on the customer API host
- a token refresh updates the same installation binding instead of creating a second registration
- logout or `Log out and switch instance` triggers `DELETE /v1/me/push-devices/{installationId}` before local cleanup finishes
- a stale or disabled Android notification channel causes the app to clear the selected runtime and require bootstrap confirmation again before another login attempt
- no registration, rotation, or revocation request goes to a SecPal-owned API host or any other legacy push fallback path

## Rollout Notes For Replacing The Baked-In Origin Assumption

SecPal Android is still on the current `0.x` line. Breaking changes are therefore permitted when they remove obsolete or unsafe runtime-bootstrap compatibility paths.

For this rollout, SecPal intentionally preserves no backward-compatibility shim for the old baked-in-origin model. Customer-hosted deployments must expose the bootstrap contract before updated Android builds are distributed.

The same no-shim rule applies to superseded Android runtime-bootstrap follow-up paths. Operators should expect updated builds to fail closed at discovery when the native runtime-bootstrap bridge methods are unavailable, and to clear native bootstrap persistence plus tenant-scoped browser storage when the user switches instance or the frontend clears an invalid runtime.

The same `0.x` rule applies to Android push runtime behavior. Updated builds intentionally preserve no compatibility fallback to old SecPal-owned push assumptions, bundled Firebase defaults, or foreign Firebase app token events once customer-owned runtime push is configured.

Before handing the generic Android app to a tenant, operators should verify:

- `GET /v1/bootstrap` is reachable from the exact HTTPS instance URL users receive
- the bootstrap payload returns the canonical API host and the expected instance display name
- first-launch discovery binds the app to the correct deployment and reloads into login
- the login-screen `Log out and switch instance` action clears tenant-local state and returns the app to discovery

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

## Fastlane For Local Build And Play Upload

Fastlane should reuse the existing local signing baseline instead of introducing a second signing path.

- keep the upload keystore in `~/.config/secpal/android-upload.jks`
- keep the release env file in `~/.config/secpal/android-release.env`
- keep the Google Play service-account JSON outside the repository as well, for example at `~/.config/secpal/google-play-service-account.json`

Fastlane lanes in this repository call the existing signed Gradle build flow and expect these local prerequisites:

- `bundle install`
- `SECPAL_ANDROID_RELEASE_ENV_FILE` when you do not use the default `~/.config/secpal/android-release.env`
- `SECPAL_ANDROID_PLAY_JSON_KEY_PATH` when uploading to Google Play
- `SECPAL_ANDROID_DIRECT_SSH_HOST` when publishing the direct APK to a non-default SSH host
- `SECPAL_ANDROID_DIRECT_ROOT` when the target root differs from `/home/secpal/www/apk.secpal.app`
- `SECPAL_ANDROID_DIRECT_CHANNEL` when publishing to the `beta` direct-download channel instead of `stable`

For Google Play deployment, `fastlane android deploy_internal` now generates a fresh `SECPAL_ANDROID_VERSION_CODE` automatically when the caller does not provide one. If you need to force a one-off deploy value, pass `SECPAL_ANDROID_DEPLOY_VERSION_CODE=...`. A directly exported `SECPAL_ANDROID_VERSION_CODE=...` also overrides the baseline local env-file value when it differs from that stored release default.

For direct APK publication on `apk.secpal.app`, the repository now treats the canonical machine-facing URLs as `stable` plus `beta`, while keeping `/android/...` as the stable alias:

- `https://apk.secpal.app/android/latest.json`
- `https://apk.secpal.app/android/app.secpal-latest.apk`
- `https://apk.secpal.app/android/SHA256SUMS.txt`
- `https://apk.secpal.app/android/stable/latest.json`
- `https://apk.secpal.app/android/stable/app.secpal-latest.apk`
- `https://apk.secpal.app/android/stable/SHA256SUMS.txt`
- `https://apk.secpal.app/android/beta/latest.json`
- `https://apk.secpal.app/android/beta/app.secpal-latest.apk`
- `https://apk.secpal.app/android/beta/SHA256SUMS.txt`
- `https://apk.secpal.app/android/releases/{version}/metadata.json`
- `https://apk.secpal.app/android/releases/{version}/app.secpal-{version}.apk`
- `https://apk.secpal.app/android/releases/{version}/SHA256SUMS.txt`

The `fastlane android deploy_direct_apk` lane builds the signed release APK, uploads the versioned release files to the SecPal VPS, refreshes the `stable` channel under `/android/stable/`, and also refreshes the stable aliases under `/android/`.
The `fastlane android deploy_direct_apk_beta` lane publishes the same signed release APK under `/android/beta/` without replacing the stable aliases.

The resulting latest-channel endpoints are:

- `https://apk.secpal.app/android/stable/latest.json`
- `https://apk.secpal.app/android/stable/app.secpal-latest.apk`
- `https://apk.secpal.app/android/stable/SHA256SUMS.txt`
- `https://apk.secpal.app/android/latest.json`
- `https://apk.secpal.app/android/app.secpal-latest.apk`
- `https://apk.secpal.app/android/SHA256SUMS.txt`
- `https://apk.secpal.app/android/beta/latest.json`
- `https://apk.secpal.app/android/beta/app.secpal-latest.apk`
- `https://apk.secpal.app/android/beta/SHA256SUMS.txt`

Example:

```bash
npm run fastlane:install
npm run fastlane:android:build:signed-aab
SECPAL_ANDROID_PLAY_JSON_KEY_PATH="$HOME/.config/secpal/google-play-service-account.json" \
  npm run fastlane:android:deploy:internal
```

```bash
SECPAL_ANDROID_DIRECT_SSH_HOST=secpal \
  npm run fastlane:android:deploy:direct-apk
```

```bash
SECPAL_ANDROID_DIRECT_SSH_HOST=secpal \
  npm run fastlane:android:deploy:direct-apk:beta
```

The `deploy_internal` lane uploads the signed AAB to the Google Play internal testing track and intentionally skips metadata, screenshots, and changelog uploads so artifact delivery stays the only responsibility of the lane.

## Open Product Decisions

Before the first public release, finalize at least:

- signing-key custody and backup process

For Play Store publication, also decide whether Google Play App Signing will use the same upload key you generate locally or whether you want a dedicated rotated upload key once the Play Console is active.

See `docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md` for the operational key-handling baseline and `docs/ANDROID_FIRST_RELEASE_CHECKLIST.md` for the first public release gate.
See `docs/ANDROID_PLAY_CONSOLE_SETUP.md` for the Play Console setup flow that matches the shared-app SecPal baseline.
