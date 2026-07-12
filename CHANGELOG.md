<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added generated Google Play services/Firebase open-source notices to Android release artifacts and the native notices activity for a frontend-owned entry point.

### Changed

- Upgraded the Android build toolchain to compile SDK 36 and Android Gradle Plugin 8.9.1, raised the minimum SDK to 24, and moved the native open-source notices UI to Google Play services OSS licenses 17.5.1 and its v2 activity.
- Removed the injected Android WebView discovery, login-reset, and About presentation so the shared frontend exclusively owns those screens; retained the native runtime-bootstrap, authentication, push, and enterprise capability bridges.
- Corrected REUSE copyright attribution for the third-party Gradle Wrapper,
  retained Capacitor MIT provenance while placing the local Cordova Gradle
  normalization under AGPLv3, removed overlapping template annotations, and
  added third-party notices plus the remaining Android OSS notices follow-up.
- Documented the review-ready validation set for the Android runtime-discovery/bootstrap cleanup branch.
- Aligned Android runtime-bootstrap and deployment-binding documentation with the final native restore/apply/clear behavior, including the intentionally removed baked-in-origin, `setApiBaseUrl(...)`, legacy `apiOrigin`-only, and session-storage compatibility paths.
- Documented the Android runtime-bootstrap contract required by the merged shared frontend flow, including native runtime info, persisted bootstrap read/apply/clear, reset/logout behavior, payload field mapping, and bridge/runtime code that must be kept.
- Documented the Android runtime-discovery/bootstrap branch, PR, issue, and review-thread audit so the cleanup story has a current scoped baseline.
- Added `LicenseRef-SecPal-Attribution` for SecPal-owned AGPL-covered code, fastlane assets, and related metadata, linked the repo docs to the new AGPL section 7(b)/(c) terms, and tightened the Android discovery/about legal footer so it exposes the SecPal attribution terms alongside the existing `Powered by SecPal` notice.
- Added a repo-local Fastlane baseline for Android so signed APK/AAB builds and Google Play internal-track uploads can reuse the existing local keystore and `android-release.env` flow without moving signing material into the repository; the Play deploy lane now auto-generates a fresh `SECPAL_ANDROID_VERSION_CODE` when needed, supports one-off `SECPAL_ANDROID_DEPLOY_VERSION_CODE` overrides, explicit shell-provided signing overrides win over the values stored in the local env file, and the direct APK lanes now publish versioned artifacts plus the public `stable` and `beta` latest endpoints on `apk.secpal.app/android/...`, with `/android/...` remaining the stable alias.
- Replaced the repo-local `markdownlint-cli2` pre-commit and preflight path with pinned `markdownlint-cli@0.49.0` usage so markdown validation now matches the shared `.github` governance baseline.
- Extracted dedicated-device home tile rendering into `DedicatedDeviceHomeTileGridRenderer` and `DedicatedDeviceHomeTileModel`, replacing inline imperative view construction with an inflated `view_dedicated_device_home_tile` layout.
- Moved dedicated-device launcher spacing, colors, and text styling into centralized Android resources and styles.
- Added Robolectric coverage for dedicated-device launcher redirect, tile population, empty-state visibility, allowed-app clicks, and phone/SMS tile behavior through a swappable `DedicatedDeviceHomeDependencies` seam.

### Security

- Removed the Google Play services Credential Manager provider to eliminate vulnerable FIDO/Tink protobuf generated code from Android release artifacts. Passkey registration and sign-in now require Android 14 or newer; password sign-in remains available on supported older Android versions.
- Removed the WebView-accessible gesture-navigation settings bridge so JavaScript can no longer force managed dedicated devices out of lock task into Android Settings; the OEM settings hand-off remains limited to the native provisioning flow.
- disabled the WebView-accessible Android offline-vault root-key bridge so JavaScript can no longer create or unwrap device-bound vault root-key envelopes until a non-exfiltrating native read path exists
- Added `android-release.env` to the repo-local ignore rules so Android signing environment files are not accidentally staged from developer machines.
- Removed the optional `email` field from native public-passkey (`token`-mode) challenge startup so the Android wrapper, bridge, and injected plugin contract now match the discoverable-only API surface required by `SecPal/api#1101`. `SecPalNativeAuthPlugin.loginWithPasskey`, `NativeAuthHttpClient.startTokenPasskeyAuthenticationChallenge`, the typed `NativeAuthBridge.loginWithPasskey` signature, and the injected `SecPalNativeAuthBridge` no longer accept or forward an `email` argument, preventing email-scoped public passkey challenges from being issued through the Android shell (issue #225).
- refreshed the npm lockfile so the shared `minimatch` chain used by `eslint`, `@typescript-eslint`, and `@capacitor/cli` now resolves transitive `brace-expansion@5.0.6` instead of the GHSA-jxxr-4gwj-5jf2 vulnerable `5.0.5` release tracked in issue `#258`

### Fixed

- Domain-policy validation now recognizes hyphenated application and storage
  identifiers in browser storage calls without permitting similarly shaped
  forbidden hostnames (issue #361).
- Exposed the native `getPasskeyCapabilities()` contract through the typed Capacitor auth bridge, allowing the shared frontend to gate passkey actions on Android 14+ and show the Android-version guidance on Android API 24 through 33 (issue #349).
- Patched Capacitor Android's raw Java generics after dependency installation and sync so release verification no longer emits unchecked-operation compiler notes while awaiting the upstream fix tracked in ionic-team/capacitor#8529 (issue #354).
- Marked the pre-stripped AndroidX graphics-path native library brought in by the Google Play services OSS licenses v2 runtime as an intentional no-strip release dependency, and added APK/AAB ABI-set and 40 KB payload-budget checks.
- Pre-push YAML validation now checks only Git-tracked YAML files that still
  exist in the worktree, excluding ignored local workspace caches such as
  `.context` and avoiding failures on unrelated unstaged deletions (issue #347).
- Normalized hook-managed Android files so `pre-commit run --all-files` no
  longer changes a clean checkout.
- Replaced the `mirrors-prettier` pre-commit environment with the compatible
  system invocation of the lockfile-installed Prettier version, so npm 12 no
  longer rejects the obsolete `--ignore-prepublish` installer flag or fetches
  validation packages at hook runtime; preflight and local hooks now install
  locked Node dependencies before invoking those local validation binaries on
  a clean checkout.
- Serialized injected Android runtime-bootstrap apply/clear mutations, rejected stale applies, canonicalized shared-frontend payloads at the bridge boundary, failed closed when native clear support is unavailable, and reset the in-memory native-auth flag during runtime clearing.
- Hardened the injected Android runtime-bootstrap bridge so shared frontend apply/clear calls remove stale discovery UI, cannot be overwritten by an older in-flight native restore, and still clear tenant browser state when native persistence cleanup reports a failure.
- The injected Android `clearRuntimeBootstrap()` bridge method now clears tenant-scoped browser storage alongside native runtime persistence, preventing shared frontend instance-switch flows from carrying stale customer state into discovery.
- Removed the obsolete injected Android runtime-bootstrap compatibility path that restored or confirmed deployments through `SecPalNativeAuth.setApiBaseUrl(...)` plus session storage; the bridge now requires the merged frontend `getRuntimeBootstrap`/`setRuntimeBootstrap` native contract and fails closed when it is unavailable.
- Exposed runtime-bootstrap read/apply/clear and runtime-info methods on the injected `SecPalNativeAuthBridge`, keeping the Android WebView bridge aligned with the merged shared frontend `SecPalRuntimeBootstrap` facade.
- Removed the dead pre-Android-M connectivity fallback from `NetworkState` now that the wrapper targets `minSdkVersion 23`, added an explicit `native:compile:debug:deprecations` Gradle path for deprecation triage, and marked AndroidX DataStore's shipped `libdatastore_shared_counter.so` as an intentional keep-debug-symbols library so `npm run native:assemble:debug` no longer leaves those warnings untracked.
- Preserved Android bootstrap package version codes larger than `Integer.MAX_VALUE` in the native provisioning exchange payload.
- `scripts/load-android-release-env.sh` now preserves a shell-provided `SECPAL_ANDROID_DIRECT_CHANNEL` override when reloading `android-release.env`, so `npm run fastlane:android:deploy:direct-apk:beta` cannot be redirected back onto the stable direct-download channel by a local release env file.
- `SecPalNativeAuthPlugin.isVaultDeviceBoundWrapperAvailable()` now reports `available: false` to WebView callers while the offline-vault root-key bridge remains disabled, preventing capability probes from contradicting the blocked wrap/unwrap contract.
- the injected Android auth bootstrap now clears persisted `native-device-bound` offline-vault browser state before restoring a configured runtime, preventing upgraded devices from reopening an unreadable offline-vault state after the WebView unwrap bridge removal.
- Android release automation now keeps generated `versionCode` values monotonic across Google Play and direct APK channels, accepts standard `~/.android/avd` emulator layouts, avoids false 16:9 Play screenshot warnings, and prevents WebView CDP helper commands from hanging forever when a target closes mid-request.
- Android release helper scripts now pass ADB and emulator arguments without shell interpolation, reject unsafe emulator launch input, and normalize fallback screenshot names to stripped Fastlane metadata suffixes.
- Android deploy automation now derives direct-download signing fingerprints from the signed APK without exposing keystore secrets on the process list, fails closed when direct-channel metadata cannot be read while resolving version-code floors, stages `latest` checksum/APK swaps through temporary filenames plus rollback-safe remote replacements during channel refreshes, fails WebView CDP helper scripts on page-side evaluation exceptions or missing navigation targets, and keeps the Android emulator regression suite stable on CI runners with a preinstalled SDK.
- Play metadata validation now rejects preview assets with alpha channels and screenshots that exceed Google Play's 2:1 ratio limit, and the committed feature graphics plus phone/tablet screenshots were normalized accordingly.
- Added injected-bridge regression coverage for issue `#302` to prove Android push-device revocation failures only warn and do not block native logout or suppress the browser `secpal:native-auth-logout` event.
- `scripts/sync-play-store-assets.mjs` now refreshes only locale image trees so committed Play changelog templates and versioned changelog files remain available for sync-then-validate and metadata deploy flows.
- Direct APK Fastlane deploys now derive generated `SECPAL_ANDROID_VERSION_CODE` values from both the local release baseline and the highest published direct-download channel version, preventing same-minute version collisions from reusing an existing `apk.secpal.app` release path.
- The destructive runtime-reset flow now still dispatches the browser `secpal:native-auth-logout` event when native logout succeeds but later reset teardown aborts, so the frontend can clear its own auth state even when persistence cleanup fails.
- The injected Android native-auth bridge and the typed Capacitor bridge now dispatch a browser `secpal:native-auth-logout` event after successful native logout completion, allowing the frontend shell to clear persisted auth state and reroute protected WebView sessions back to `/login` immediately. The event is also dispatched from the destructive runtime reset path (`clearConfiguredRuntimeState`) so all logout code paths notify the frontend consistently.
- Android push registration now uses the canonical authenticated `PUT`/`DELETE /v1/me/notification-installations/{installationId}` surface, sends the current channel-aware Android FCM payload shape (`channel`, `installation_name`, nested `registration`, and `runtime.metadata_revision`), rotates credentials with the canonical `credential_rotated` lifecycle event, and keeps the injected bridge regression suite aligned with the live SecPal contract from issue `#261`.
- Android runtime bootstrap now accepts the current deployment `schema_version` 3 contract during instance discovery, keeps the injected bridge's confirmation flow aligned with the live `api.secpal.dev` bootstrap response, and sends the same schema version back on authenticated Android push-device registration payloads so the generic app no longer rejects the live SecPal instance as incompatible.
- Android native auth bootstrap now normalizes retained push-token `savedAt` persistence to canonical whole-second UTC timestamps with a trailing `Z`, rewrites legacy numeric storage values during hydration, and adds focused Vitest coverage so Android-side timestamp serialization aligns with the canonical API timestamp policy for issue `#257`.
- Android runtime bootstrap now consumes the canonical `features.notification_channels.android_fcm` and `notification_channels.android_fcm.public_runtime_metadata` contract, drops the injected bridge's last network fallback to legacy `android_push` bootstrap fields, clears the selected runtime plus tenant-scoped browser state when authenticated push registration reports `409 NOTIFICATION_RUNTIME_STATE_INVALID` or `409 NOTIFICATION_CHANNEL_UNSUPPORTED`, and adds focused Vitest coverage for issue `#252`.
- Android push token retention now persists trusted runtime FCM tokens into logout-safe browser storage as soon as the canonical runtime origin is known, rehydrates `__SecPalAndroidPushSyncState.currentToken` after the `/` -> `/login` recovery reload, reconciles divergent trusted storage entries by the freshest persisted token, hardens the live WebView auth smoke to reject pre-existing auth or push-sync state that would mask the reroute path, and adds focused Vitest coverage for logout-cleared storage, early-token-before-bootstrap-restore timing, and storage divergence in issue `#248`.
- Android push registration now permanently disables itself with a structured non-retryable error when secure Web Crypto UUID generation is unavailable in the injected WebView, exposes that state through `SecPalNativeAuthBridge.getAndroidPushRegistrationState()`, and adds focused Vitest coverage for issue `#244`.
- Android runtime bootstrap now ignores Android push token and error events unless they originate from the named customer runtime Firebase app, removing the last hidden fallback from customer-owned push configuration back to stale or foreign app instances and adding focused Vitest coverage for issue `#239`.
- Android runtime bootstrap now consumes retained native FCM token events in the injected auth bridge, registers and rotates the authenticated `/v1/me/push-devices/{installationId}` binding against the selected customer-hosted backend after login, revokes the device registration on logout and destructive instance reset, keeps the installation identifier deployment-scoped, and adds focused Vitest coverage for issue `#237`.
- Android runtime bootstrap now requests an FCM registration token from the deployment-scoped native Firebase runtime, retains named-app token and error events on the native auth bridge for later device-registration handling, guards against stale callbacks after `apply(null)` via generation-based cancellation, prevents late token delivery after plugin teardown via a destroy flag, propagates synchronous token-request failures to callers for correct persistence rollback, and adds focused Java coverage for issue `#241`.
- Android runtime bootstrap now accepts deployment `schema_version` 2 responses, carries validated `android_push` metadata into the native auth plugin, initializes or clears a deployment-scoped native Firebase runtime from that metadata at runtime instead of relying on `google-services.json`, and adds focused bridge plus Android unit coverage for issue `#238`.
- Android runtime bootstrap now rejects legacy `apiOrigin`-only restore state from the native plugin and requires structured persisted bootstrap metadata before rebinding after restart, closing the last hidden old-model restore path with focused Java and bridge regression coverage for issue `#232`.
- Android login now renders a small clickable instance hint directly below the passkey sign-in button, asks for confirmation before clearing the configured instance plus tenant-local browser state, and keeps the injected footer wording aligned with the existing shared frontend footer text while preserving focused regression coverage for issue `#231`.
- Android runtime bootstrap now persists the validated customer deployment in the native auth plugin, restores the selected canonical API binding on startup, and removes the hidden fallback back to the baked-in runtime API origin once a deployment was configured, with focused regression coverage for startup rebinding and fallback removal in issue `#230`.
- Added a native Android hardware-button route fallback for managed-device Samsung/XCover key events so short presses can still open `/profile` and long presses `/about` even when the injected Web listener is unavailable at runtime, resolving the remaining real-device validation gap in issue #123.

### Changed

- strengthened the provider-neutral AI-governance rollout so `AGENTS.md` now advertises the workflow-specific overlay at runtime, explicitly blesses `apk.secpal.app` as the canonical Android artifact host, and keeps the central AI-instructions validation job visible in release history
- the local-only `.preflight-allow-large-pr` override is no longer tracked in git; contributors can still create it locally when an exceptional branch legitimately exceeds the PR-size guard because the repo keeps the ignore rule in place for issue `#250`
- documented the generic-app customer-owned Android push lifecycle for operators, including bootstrap metadata requirements, login-time `/v1/me/push-devices/{installationId}` registration, token rotation and logout/reset cleanup behavior, and the explicit `0.x` no-compatibility rollout stance for removing obsolete SecPal-owned push assumptions
- documented the customer-hosted Android binding flow, deployment bootstrap endpoint expectations, and rollout note that the current `0.x` policy allows removal of the old baked-in-origin compatibility shim without preserving a backward-compatibility fallback
- extracted `getPersistedRuntimeBootstrap` into a package-private static `loadPersistedRuntimeBootstrap(SharedPreferences)` method, mirroring the `clearRuntimeBootstrapState` pattern, and added three focused JUnit tests covering the upgrade-path (legacy `api_base_url`-only prefs → null), structured-bootstrap restore, and corrupt-JSON self-healing
- refined the Android runtime discovery gate to match the Catalyst-based login shell much more closely, including SecPal logo/footer branding, Catalyst-aligned control and button presentation, persistent EN/DE locale switching, locale-aware bootstrap validation requests, and verified light/dark rendering on the live device for issue `#229`
- clarified the repo-local under-`1.x` policy in Copilot governance so Android work explicitly prefers removing obsolete compatibility shims over preserving them without a proven live caller
- Strengthened Copilot governance: require test-impact analysis and same-commit test updates when a fix alters observable behavior, explicitly require running tests locally before pushing behavioral or security changes, and mandate `--body-file` for programmatic PR creation to prevent shell escaping issues.
- strengthened repo-local Copilot governance for AI findings: Android work now requires proof of defect before merging AI-generated fix PRs, treats green CI alone as insufficient evidence for bridge or auth cleanups, and documents focused verification of listener handles and teardown ordering
- wired the central Copilot-instructions validator into `quality.yml` so Android pull requests now fail automatically when known bridge, back-navigation, or managed-mode AI-risk guardrails are missing from the runtime baseline
- Android domain-policy validation now composes its approved-host allowlist from named regex fragments and bounds raw `secpal.*` discovery matches, making the check easier to review while preserving the existing host policy.
- `SamsungHardwareButtonLaunch.resolveLaunchAction` now accepts an optional `LongSupplier` time-provider overload so tests can inject controlled timestamps without mutating package-private static state, removing timing brittleness and eliminating cross-test pollution from the long-press threshold test.
- `android-native-hardening` TypeScript test now validates that the Capacitor config module and its `cordova.accessOrigins` array are present and well-formed before asserting on individual entries, and extracts certificate-pin hashes and vendor-neutrality regex into named constants to improve test readability and maintainability.

### Fixed

- The debug-only `DEBUG_SET_ENTERPRISE_POLICY` path now keeps unmanaged local validation devices in the dedicated-device home experience when `secpal_kiosk_mode_enabled=true`, so relaunching the app opens `DedicatedDeviceHomeActivity` and `getManagedState()` reports `kioskActive=true` for debug kiosk validation without pretending the app is a real device owner.
- `tests/sync-frontend-brand-assets.test.ts` now uses an isolated temporary repo root for its missing-asset assertion, so the Android suite no longer depends on unrelated `/tmp/frontend` leftovers on the host machine
- Android release builds now keep `FLAG_SECURE` enforced on the visible SecPal activities and restrict WebView debugging to `BuildConfig.DEBUG`, removing the broad environment toggles that could previously weaken production hardening.
- pinned transitive `postcss` to `8.5.10` through npm overrides so the Android Vite/Vitest toolchain no longer depends on the older release tracked in issue `#175`
- bumped the repo-local `@xmldom/xmldom` npm override to `0.8.13`, clearing the high-severity processing-instruction XML injection advisory and the related xmldom audit findings from the Android Capacitor CLI dependency chain
- Android passkey auth now maps Credential Manager unsupported/provider failures via explicit AndroidX exception types instead of class-name heuristics, so unsupported-device/provider states consistently surface the native `PASSKEY_PROVIDER_UNAVAILABLE` path used by the shared login UI.
- The Android wrapper now declares `asset_statements` for `https://app.secpal.dev/.well-known/assetlinks.json` in its manifest resources, aligning the installed app with Android Credential Manager's Digital Asset Links prerequisite for passkey RP-ID validation.
- The Android Capacitor shell now enables `WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP` on its `WebView`, so Credential Manager can validate `app.secpal.dev` passkey RP IDs inside the native wrapper instead of failing after the system passkey creation dialog.
- SecPal now marks both native Android activities as secure windows and disables screen capture through the managed device-owner/profile-owner policy, blocking screenshots, screen recording, and Recents thumbnails on the visible SecPal surfaces, across the managed device in device-owner deployments, and within the managed profile in profile-owner deployments.
- `ProvisioningBootstrapStoreTest` now asserts `isAllowSms()` is false when `secpal_allow_sms` is set to false in the exchange-result policy profile, closing the coverage gap alongside the existing `isAllowPhone()` check.
- The retry-scenario test in `ProvisioningBootstrapStoreTest` now calls `applyExchangeResult` after toggling the commit flag to true and asserts the full completed state, replacing the previous stub that only verified a `markExchangeFailure` call and left the retry path untested.
- A new `resetHardKeyReportStateClearsAccumulatedState` test confirms that `resetHardKeyReportState()` clears previously accumulated DOWN timing so a subsequent UP event no longer resolves to a long press, proving the reset is effective.
- Removed placeholder issue reference `#123` from `docs/ANDROID_LOCAL_DEVICE_TESTING.md`; the note now reads as a general investigation finding rather than an anchored issue link.
- Android hardware back handling in the Capacitor shell now first replays in-WebView history before delegating to the system dispatcher, so moving back through previously visited SecPal screens matches the PWA instead of closing the app immediately.
- `SamsungHardKeyReceiver.onReceive` now short-circuits on unknown broadcast actions before making any `DevicePolicyManager` binder call, reducing DoS surface for arbitrary broadcasts sent to the exported receiver; the `DevicePolicyManager` system service is now fetched once per receive and reused for both `isDeviceOwnerApp` and `isProfileOwnerApp` instead of twice in separate private helpers.
- `DedicatedDeviceHomeActivity` now consumes supported Samsung XCover and SOS hardware keys and reuses the existing Samsung launch-duration logic to reopen `MainActivity` with the correct short- versus long-press bridge event, so managed kiosk testing no longer depends solely on Samsung partner broadcast delivery in the local no-token path; the foreground launch uses `FLAG_ACTIVITY_CLEAR_TOP | FLAG_ACTIVITY_SINGLE_TOP` without `FLAG_ACTIVITY_NEW_TASK` (matching `openSecPal()`) so the task stack and lock-task mode are preserved, and press duration is measured from the `KeyEvent` hardware timestamp for accurate short-vs-long classification independent of UI-thread dispatch delay.
- `FakeIntent` test stub extracted into a shared package-private class (`app.secpal.FakeIntent`) so `SamsungHardKeyReceiverTest` and `SamsungHardwareButtonLaunchTest` no longer duplicate the intent stub; a new `ignoresUnknownActionBroadcastsEvenInManagedMode` test case documents the filtering invariant explicitly.
- Samsung Knox hard-key broadcasts now require SecPal to be running as a real Android device owner or profile owner before `SamsungHardKeyReceiver` forwards them into `MainActivity`, reducing spoofable third-party foreground launches on unmanaged devices while preserving the managed-device hard-key flow.
- Samsung Knox hard-key receiver broadcasts are now explicitly left exported in the manifest, with an inline rationale that the broadcast origin is outside SecPal's UID and no verifiable public sender permission is currently documented; this removes the `exported="false"` delivery blocker for Samsung `HARD_KEY_PRESS` and `HARD_KEY_REPORT` routing on managed devices.
- Samsung managed-device hard-key setup now wires optional partner `app_key_ptt_data` and `app_key_sos_data` manifest metadata through Android build placeholders, so Knox-distributed SecPal builds can inject Samsung app-key values without forking the committed manifest while local and non-Samsung builds keep working with empty defaults.
- Samsung XCover hard-key routing now also declares and interprets Knox `HARD_KEY_REPORT` broadcasts, including Samsung key-code and report-type extras for XCover and SOS hardware buttons, so the Android wrapper can forward Samsung-origin launch events instead of relying only on the older `HARD_KEY_PRESS` path.
- Restored focused Android Java unit-test compilation after the bootstrap state API rename by aligning `ProvisioningBootstrapStoreTest` with `ProvisioningBootstrapState.getApiBaseUrl()`, so `testDebugUnitTest --tests ...` no longer fails before the requested class is compiled.
- The debug Android manifest overlay now sets `android:testOnly="true"` directly without an unnecessary replace directive, removing the Gradle manifest-merge warning during focused unit-test runs.

### Added

- a repo-owned live WebView auth smoke script plus focused Vitest coverage so Android real-device validation can now drive the actual React login DOM through CDP, wait for native auth completion, and confirm authenticated push-registration sync from the live login screen without falling back to direct bridge login calls; the separate retained-token reroute blocker discovered during logout-to-login recovery is tracked in issue `#248`
- the generic Android app now starts behind a pre-login deployment-discovery gate that accepts secure customer instance URLs or link-supplied bootstrap targets, validates the public `GET /v1/bootstrap` contract against the running app version, confirms the resolved instance before authentication proceeds, and rebinds the native/web runtime only after a deployment has been explicitly approved, removing the old baked-in live-origin assumption from issue `#229`
- native Android offline-vault root-key wrapping groundwork: `SecPalNativeAuthPlugin` now carries a dedicated Android Keystore wrapper for device-bound vault root-key envelopes, while WebView bridge exposure stays disabled until a non-exfiltrating native read path exists, resolving Android issue #191.
- native Android passkey registration in the auth bridge: the wrapper now maps the API registration challenge into a Credential Manager create request, returns the resulting attestation payload through the injected WebView bridge, and gives the shared frontend settings flow a native enrollment path inside the Android shell
- native Android passkey sign-in in the auth bridge: the wrapper now starts token-mode passkey challenges against the API, completes the Credential Manager authentication ceremony, verifies the returned assertion for a bearer token, and exposes `loginWithPasskey` through the injected WebView bridge used by the shared frontend login screen
- Samsung Knox hardware-button launch wiring in the Android wrapper: protected hard-key broadcasts now bring `MainActivity` to the foreground, Samsung emergency launch aliases can map short- and long-press surfaces into retained enterprise-bridge events, and hardware-trigger launches request wake/keyguard dismissal so the injected bridge can still route emergency entry points while the WebView is starting or the app was backgrounded
- Regression coverage for bootstrap-store retry persistence after a failed exchange commit and for native enterprise-bridge delegation of phone, SMS, and gesture-navigation calls.
- generic Android hardware-button bridge events in the enterprise wrapper: foreground `dispatchKeyEvent` input now reaches `SecPalEnterpriseBridge` as typed pressed, short-press, and long-press callbacks so the Android shell can wire emergency navigation without Samsung-specific launch plumbing in the same PR
- typed Android enterprise bridge source API: the wrapper now ships `src/secpal/native-enterprise-bridge.ts` with strict TypeScript contracts for managed-state distribution metadata and focused tests for completed, pending, and failed bootstrap visibility, so later Android rollout/update UX can consume `SecPalEnterprise` without ad-hoc global typing
- enterprise bridge distribution-state visibility in the Android wrapper: `SecPalEnterprisePlugin.getManagedState()` now exposes the persisted bootstrap status, update channel, release metadata URL, and last bootstrap error code so later Android update UX can reason about managed-device rollout state without touching bootstrap tokens
- Android bootstrap exchange runtime for Epic SecPal/.github#327: the wrapper now persists provisioning QR bootstrap extras during Device Owner hand-off, retries the public `/v1/android/bootstrap/exchange` flow on managed app startup when connectivity is available, and stores the exchanged tenant/channel/release metadata plus managed policy profile for the single-package `app.secpal` architecture
- Android provisioning bootstrap state foundation for Epic SecPal/.github#327: device-owner provisioning extras can now persist the short-lived enrollment token securely, `KeystoreTokenStorage` supports isolated encrypted token namespaces, and dedicated bootstrap state/storage tests cover the tenant/channel metadata handoff needed for the later runtime exchange flow
- native gesture-navigation provisioning support in the Android wrapper: dedicated-device provisioning now prefers gesture navigation by default, applies managed navigation settings during provisioning, and falls back to the official gesture-navigation screen on first managed launch only through the native provisioning flow when a device still requires the OEM settings UI
- dedicated-device launcher support for arbitrary allowlisted apps, plus a separate `secpal_lock_task_enabled` policy switch so SecPal can remain the managed HOME screen without forcing a single-app kiosk when you want users to move normally between approved apps; the managed launcher now renders as a homescreen-like icon grid instead of a plain button list
- debug-only ADB policy receiver and dedicated HOME alias so real-device kiosk tests can enable strict SecPal-only mode or Phone/SMS exceptions over `am broadcast`, while persistent-home routing now targets a dedicated home component instead of the normal launcher activity
- debug-only `android:testOnly="true"` manifest overlay for the Android app module so ADB-based device-owner test runs can be rolled back with `dpm remove-active-admin` instead of requiring a factory reset after every failed kiosk experiment
- native Android DPC foundation with `SecPalDeviceAdminReceiver`, dedicated-device provisioning metadata, and a `SecPalEnterprisePlugin` bridge so the same package can act as a fully managed device owner when provisioned during setup but remain a normal app when installed later
- dedicated-device policy parsing for `secpal_kiosk_mode_enabled`, `secpal_allow_phone`, `secpal_allow_sms`, and `secpal_allowed_packages`, including persisted provisioning extras plus managed-configuration refresh from Android application restrictions
- device-owner kiosk enforcement that pins SecPal as the persistent home activity, enters lock task automatically, hides non-allowlisted launcher apps, and exposes approved apps through a dedicated native managed home screen instead of the WebView shell
- Android frontend-build bootstrap injection that installs the native auth bridge before the shared UI starts, so the Android wrapper can use native bearer-token auth without modifying the browser/PWA source tree
- native authenticated request execution for the Android auth bridge so the WebView can hand protected API operations to the native layer, which attaches the bearer token itself and returns only sanitized operation results
- `TokenCipher` interface and `KeystoreTokenCipher` implementation that extract the AES/GCM/NoPadding encryption logic from `KeystoreTokenStorage` into an injectable seam so cipher behavior can be exercised in unit tests without access to the production Android Keystore
- `EncryptedTokenPayload` value type that carries ciphertext and IV between the cipher and storage layers
- `KeystoreTokenStorageTest` with round-trip, empty-storage, and failed-decrypt-clears-storage scenarios exercised through `FakeTokenCipher` and `InMemorySharedPreferences`
- `NativeAuthHttpClientTest` covering URL normalisation and error-message extraction
- `SecPalNativeAuthPluginTest` covering HTTP error-code resolution and the non-HTTP fallback path
- `tests/native-auth-bridge-bootstrap.test.ts` covering the injected Android bootstrap script, bridge installation, native `/v1/` request routing, and the browser-session fallback for non-native/public traffic
- `values-night/ic_launcher_background.xml` for dark-mode adaptive icon background, ensuring proper contrast and visibility in system dark theme mode
- Initial `android` repository scaffold with SecPal governance baseline files, hooks, and workflows

#### Additional fixes

- Added provisioning-bootstrap store coverage for commit-result toggling so persistence paths are validated when `InMemorySharedPreferences` switches from failed `commit()` back to success
- Expanded native enterprise bridge tests to cover `launchPhone`/`launchSms`, rejected plugin calls, and alternate managed-state payloads for stronger bridge delegation/error coverage
- Hardened and simplified domain policy scanning by bounding `secpal.*` match length, extracting allowlist regex components into named variables, and replacing brittle deprecated-host exclusion chains with path/type-based filters
- Android bootstrap exchange persistence now preserves the pending provisioning state and bootstrap token when `SharedPreferences.Editor.commit()` fails while storing the exchange result, so managed-device startup retries the exchange instead of silently dropping tenant and enrollment metadata; an explicit in-memory rollback via `apply()` now also resets the in-process `SharedPreferences` map to `STATUS_PENDING` when the disk write fails, because Android may have already applied the completed-exchange values to the in-memory map before reporting the write failure
- Android domain-policy validation now accepts `apk.secpal.app` as the canonical Android artifact and metadata host, so bridge and rollout tests can reference the approved distribution URLs without tripping repo-local governance checks
- dedicated-device persistent preferred settings routing now registers each redirected Settings action both with and without `android.intent.category.DEFAULT`, so category-less generic Settings intents are still redirected back to SecPal HOME on OEM builds that resolve them without the default category
- pinned `@xmldom/xmldom` to `0.8.12` through npm overrides so the Capacitor CLI dependency chain no longer leaves the Android repo with the open high-severity GHSA-wh4c-j3r5-mjhp audit finding during local validation
- Android domain-policy preflight no longer flags valid Android package and class identifiers from the approved application ID namespace as deprecated web-host usage, so repo checks stay compatible with native plugin references
- dedicated-device defaults now keep lock task enabled again unless `secpal_lock_task_enabled` is explicitly set to `false`; with the repaired contacts-support allowlist, Phone/SMS and dialer contact creation still work under the strict managed mode, which closes the route back into stock Settings/Developer Options that appeared in the temporarily relaxed default
- dedicated-device settings redirection now also covers the direct Developer Options action so explicit launches of that settings page are bounced back to the managed home screen
- dedicated-device managed home no longer shows duplicate telephony tiles: when Phone or SMS is enabled, SecPal now keeps the generic action tile and suppresses the duplicate launcher tile for the underlying dialer or messaging package
- dedicated-device phone support now carries the matching contacts provider and contact-editor handlers into the managed allowlist, so dialer flows such as "new contact" no longer bounce back to SecPal HOME just because the supporting contacts package was outside the approved app set
- dedicated-device policy sync now reapplies device-owner launcher and lock-task changes only when the effective managed policy, allowed handler packages, or launchable app set actually changes, eliminating the repeated full policy churn that made the phone sluggish during normal SecPal resumes while still reacting to real app and policy changes
- dedicated-device launcher reconciliation now remembers which launcher apps SecPal hid and restores them before recomputing policy, so previously hidden Phone, SMS, or other allowlisted apps can become visible again after ADB policy changes instead of staying permanently hidden until device-owner removal
- removed the stale WebView bootstrap launcher overlay from the Android app shell so dedicated-device Phone and SMS shortcuts no longer reappear inside SecPal after the native managed home screen has already hidden them
- dedicated-device kiosk policy now disables status-bar shortcuts, redirects common Settings intents back to the managed home screen, and applies device-owner user restrictions for common system configuration changes, closing the path back into Settings even when users navigate through approved apps or other system shortcuts
- dedicated-device managed home now hides Phone and SMS tiles when Android does not expose a launchable handler for those intents, and telephony intent resolution now falls back to compatible installed handlers even when no default dialer or SMS role holder is set yet
- launcher icon visibility: increased foreground inset factor from 0.35 to 0.52 and switched to logo-source.png to ensure icon is clearly visible on home screen across all density variants
- splash screen background: now respects light/dark system theme via color resource qualifiers, rendering white background in light mode and dark background in dark mode instead of always black
- splash screen logo contrast: separated splash icon assets for day/night modes using logo-light-512.png and logo-dark-512.png respectively, and removed animated icon overlay that was causing brightness wash-out
- launcher icon appearance: monochrome variant now displays the actual SecPal shield logo instead of blank/faded image, enabling proper dark-mode icon rendering on Android 12+
- launcher icon sizing: foreground SVGs resized consistently across all density buckets (mdpi, xhdpi, xxhdpi, xxxhdpi) to prevent oversized appearance on home screen

### Changed

- clarified the repo-local branch-start and post-merge readiness workflow so new Android work must start from a clean, updated local `main`, and post-merge cleanup now explicitly returns the repo to `main`, refreshes dependencies with `npm ci` where applicable, runs `npm run build` when available, and confirms a clean working tree
- restored explicit repo-local Copilot governance by making TDD-first, quality-first, one-topic-per-PR, immediate issue creation for out-of-scope findings, and EPIC-plus-sub-issue requirements always-on again; the Android runtime overlay now auto-loads repo-wide so these rules remain present while working
- clarified the repo-local PR workflow so finished Android work must be self-reviewed, committed, and pushed before any PR exists, and the first PR state must always be draft until the final PR-view self-review is clean
- renamed the Android application identifier to `app.secpal`, updated the native package namespace and debug broadcast actions to match, and removed the old identifier exception from repo-local governance and validation text
- extended the local Prettier scripts to include `.mjs` helpers so formatting checks cover Node maintenance scripts consistently, and switched Android back from the temporary repo-local `local-prettier.yml` workaround to the shared `SecPal/.github` reusable Prettier workflow after the upstream setup regression was fixed
- documented the ImageMagick `magick` prerequisite for `npm run brand:sync` in the Android README so launcher and splash asset sync no longer depends on undocumented local tooling
- Android launcher icons and splash artwork are now generated from the canonical frontend SecPal logo assets via `npm run brand:sync`, so the native wrapper reuses the same brand mark instead of drifting onto Android-only placeholder artwork
- clarified across repo-local instructions, validation scripts, and Android release docs that `app.secpal` remains only the Android application identifier, while `api.secpal.dev` and `app.secpal.dev` are the active API/PWA hosts and `secpal.app` stays limited to the public homepage plus real email addresses; rewrote ANDROID_RELEASE_DISTRIBUTION.md example sentence to remove invented `secpal.*` identifiers and replace them with descriptive phrases so the domain policy check is not weakened by line-colocation
- strengthened `check-domains.sh` violations allowlist with proper word-boundary anchors so subdomains such as `myapi.secpal.dev` are no longer incorrectly excluded by substring matching
- the Android wrapper build now patches the generated sibling frontend `dist/index.html` with a native-auth bootstrap script so `SecPalNativeAuthBridge` is available before the shared React app resolves its auth transport, and authenticated `/v1/` API calls in the Android WebView no longer rely on browser cookies or `/sanctum/csrf-cookie`
- `SecPalNativeAuthPlugin.request`, `NativeAuthHttpClient.request`, and `native-auth-bridge.ts` now transport raw request and response bodies as Base64 so the Android wrapper can proxy JSON, multipart uploads, and binary downloads through the native bearer-token boundary while preserving HTTP status codes for the shared UI
- `SecPalNativeAuthPlugin` now resolves its API base URL from native Android resources instead of accepting a token-bearing request origin from the WebView bridge, and `NativeAuthHttpClient.normalizeBaseUrl` now parses URL components strictly to reject userinfo, paths, query strings, and fragments before any credentialed request is sent
- `api_base_url` in Android resources now stays on the canonical `api.secpal.dev` API origin; `app.secpal` remains only the Android application identifier and is not treated as a deployable web domain
- `decodeJsonStringFragment` in `NativeAuthHttpClient` now handles JSON `\\uXXXX` unicode escapes (including surrogate pairs) so server error messages that contain unicode escape sequences are displayed correctly
- `SecPalNativeAuthPlugin` and `native-auth-bridge.ts` now expose a dedicated authenticated request path in addition to login, current-user bootstrap, and logout so later Android flow wiring can call protected endpoints without moving the bearer token into JavaScript
- `KeystoreTokenStorage` now accepts an injectable `TokenCipher` via a package-private secondary constructor so tests can substitute a fake cipher without touching the Keystore
- `NativeAuthHttpClient.normalizeBaseUrl` and `buildErrorMessage` (formerly `extractErrorMessage`) promoted to `static` visibility for direct unit-test access; `extractErrorMessage` replaced with regex-based extraction to remove the `JSONException` dependency from the helper path
- `SecPalNativeAuthPlugin.resolveErrorCode` extracted as `static` package-private method so error-code mapping can be verified without a running Capacitor plugin instance

### Fixed

- Reduced the generated Android launcher, Android 12 splash icon, and legacy splash logo scale so the SecPal mark no longer appears oversized on home screens and launch/loading surfaces on real devices, and added a monochrome adaptive icon asset so Android 13+ themed icons can follow launcher theming instead of staying fixed to the full-color mark.
- Fail fast on missing Android connectivity before native auth requests start and shorten the native startup `/v1/me` timeout budget, so cached-session bootstrap no longer burns the full 15-second HTTP timeout before the frontend can recover.
- Expose Android's native connectivity status to the injected auth bridge so the shared frontend can skip `GET /v1/me` revalidation when the device is truly offline, avoiding repeated startup recovery loops caused by stale WebView `navigator.onLine` state.
- Normalize the Capacitor-generated `android/capacitor-cordova-android-plugins/build.gradle` immediately after `cap sync` and `cap add android` so the reintroduced `flatDir` block from `@capacitor/cli@8.3.0` no longer leaves the Android worktree dirty or restores the Gradle metadata warning.
- Reject malformed authenticated-request `bodyBase64` payloads in `NativeAuthHttpClient` before any native bearer-token request is sent, so invalid WebView input now fails locally with `VALIDATION_ERROR` instead of being forwarded as an empty body.
- Purge stale WebView service-worker and cache directories on Android app reinstall or update so the native wrapper no longer boots an outdated cached PWA shell that bypasses the injected native auth bridge.
- Export the Android `api_base_url` into the sibling frontend production build so the packaged login health check no longer throws a missing-`VITE_API_URL` configuration error before it can reach `https://api.secpal.dev/health/ready`.
- Validate API base URL scheme in TypeScript `normalizeBaseUrl` so non-absolute or non-http(s) URLs are rejected at the bridge layer before reaching the native plugin
- Wrap `HttpURLConnection` in `try/finally` and call `disconnect()` after each request to avoid leaking sockets; close response `InputStream` via try-with-resources
- Replace `HTTP_0` error code for URL-validation failures in the native plugin with `VALIDATION_ERROR` to avoid misleading HTTP status semantics
- Align `MainActivity.java` indentation to 4-space style consistent with all other Java sources in the package
- Set the Capacitor Android wrapper hostname to `app.secpal.dev` so the native WebView origin matches the API CORS allowlist and the login health check no longer fails with a false "System not ready" state while still keeping the Android package ID at `app.secpal`

### Documentation

- `docs/ANDROID_AUTH_ARCHITECTURE.md` and README guidance that make the long-term Android auth boundary explicit: the shared WebView UI stays, but Android authentication must use native bearer tokens from `/v1/auth/token` with Keystore-backed storage and no JavaScript-visible token persistence.
- `docs/ANDROID_LOCAL_DEVICE_TESTING.md` plus README links that document the full Fedora/Linux path for testing on a physical Android device, including toolchain checks, `adb` verification, APK installation, and common USB troubleshooting.

### Changed

- Replace raw `new Thread()` calls in `SecPalNativeAuthPlugin` with a `NativeAuthTaskExecutor` backed by a single-thread `ExecutorService` so native auth work runs on a single serialized background thread and remains lifecycle-aware; shut the executor down in `handleOnDestroy()` so no threads are left detached after the plugin is destroyed
- `.github/copilot-instructions.md` now requires a branch hygiene check before any write action so Android work never starts on local `main` and dirty non-`main` branches must be assessed before continuing
- `.github/copilot-instructions.md` now requires stale `SPDX-FileCopyrightText` years in edited files and license sidecars to be normalized to `YYYY` or `YYYY-YYYY` without spaces
- `.github/copilot-instructions.md` now clarifies that if an edited file has no inline SPDX header, its companion `.license` file must be checked and updated instead
- repo-local Android instructions and overlays now also restate Copilot review handling, signed-commit checks, EPIC/sub-issue requirements, REUSE checks, 4-pass review, and the `secpal.app` vs `secpal.dev` use-case split so project-wide governance is locally complete
- repo-local Android instructions and overlays now also require warning, audit, and deprecation notices from scripts and package managers to be reviewed and either fixed or tracked immediately
- `scripts/preflight.sh` now restricts `yamllint` to repository YAML files outside dependency and build directories using a Bash 3-compatible `while read` loop instead of `mapfile` so Android validation no longer fails on third-party `node_modules` YAML errors and the script remains portable across macOS and Linux

### Removed

- Removed the bundled deleted legacy product module from the Android wrapper by syncing the updated shared frontend build without its retired routes, UI, and related web assets

### Security

- restricted the Cordova access whitelist to `https://api.secpal.dev` and `https://app.secpal.dev`, enabled R8/resource shrinking for release builds with Capacitor-safe keep rules, tightened FileProvider exports to dedicated `shared/` subdirectories, and added Android network security config that disables cleartext traffic and pins the live `api.secpal.dev` certificate chain
- Updated `package-lock.json` to remediate the current transitive `npm audit` findings by resolving `brace-expansion` to `5.0.5` and `picomatch` to `4.0.4` without changing declared dependency ranges
- Updated `package-lock.json` to resolve transitive `flatted` to `3.4.2`, removing the current high-severity `npm audit` finding without changing declared package ranges
- Scoped the transitive `yauzl` override to `native-run` and pinned it to `3.2.1` so Capacitor CLI tooling no longer resolves the vulnerable ZIP parser version reported by `npm audit`

- Capacitor + React + TypeScript bootstrap with Android platform preparation scripts
- Repository-local Copilot instruction baseline and overlays for Android/Capacitor scope
- `docs/ANDROID_ENTERPRISE_ROADMAP.md` for staged DPC/profile-owner/device-owner implementation planning
- Native Android helper scripts and release-distribution guidance for repeatable local debug and release builds on Fedora/Qubes developer machines
- Local release-keystore setup and signed-build helper scripts that keep Android upload secrets outside the repository under `~/.config/secpal/`
- `docs/ANDROID_KEYSTORE_BACKUP_AND_RECOVERY.md` for the Android upload-key backup and recovery baseline on Fedora/Qubes
- `docs/ANDROID_FIRST_RELEASE_CHECKLIST.md` for the first SecPal Android release across direct download and Google Play
- `docs/ANDROID_PLAY_CONSOLE_SETUP.md` for the first Play Console setup aligned with the shared SecPal app identity

### Changed

- Refreshed the Android validation toolchain to the latest currently compatible `@types/node`, `vitest`, and `@vitest/coverage-v8` releases

- Switched Android Capacitor workflow to reuse the sibling `frontend` repository build output (`../frontend/dist`) as the web source of truth
- Added `scripts/build-frontend-web.sh` and wired `cap:sync`/`cap:copy` to build frontend first before syncing native Android assets
- Realigned the repository to a wrapper-only architecture by removing the placeholder local web app in favor of configuration and native-wrapper validation
- Hardened governance files, preflight hooks, and repository metadata for `main`-based workflow enforcement
- Upgraded the Android wrapper toolchain to Capacitor `8.2.0` across `@capacitor/android`, `@capacitor/core`, and `@capacitor/cli`
- Upgraded the repository validation toolchain to ESLint `10.0.3`, `@eslint/js` `10.0.1`, `globals` `17.4.0`, Vitest `4.0.18`, and `@vitest/coverage-v8` `4.0.18`
- Made the native Android app module read release versioning and signing inputs from environment variables so direct APK and Play Store release builds can share one Gradle path
- Updated the Android product identity to the public `SecPal` app name with the shared application ID `app.secpal`
- Added a structured Android release-identity baseline covering the recommended public developer name, application ID, and split between technical and user-facing support contacts
- Finalized the Android release baseline around the public `SecPal` publisher identity with `android@secpal.app` for technical Android topics and `support@secpal.app` for user-facing support
- Locked in the shared-app strategy so DPC capability remains part of the same `SecPal` package instead of a separate enterprise-only Android app

### Fixed

- Scoped the protobuf legacy-generated-code warning suppression to Android OSS release verification after proving AGP's build-only Tink dependency is absent from the shipped release runtime graph
- Pinned `typescript` back to the supported `5.9.x` line so Android lint no longer emits the current `@typescript-eslint` unsupported-TypeScript warning
- Removed unused `flatDir` repositories from the native Android app and Capacitor Cordova plugin modules so Gradle no longer emits the current metadata-format warning during debug APK builds
- Normalized repository-owned YAML files by adding explicit document starts, aligning `yamllint` comment spacing with the repository Prettier style, refreshing edited SPDX year headers, and clarifying the repo-local workflow timeout rule for reusable workflow caller jobs
- Corrected invalid `CODEOWNERS` syntax and Android-specific copied repository metadata
- Removed local preflight bypass guidance and made tests and native Android verification blocking
- Versioned the generated `android/capacitor-cordova-android-plugins/` module so clean Android Studio syncs and Gradle builds work from a fresh clone
- Restricted Android file sharing to app-scoped paths and disabled default Android backups for a safer mobile baseline
- Corrected the domain-policy validation so mixed lines containing both allowed and forbidden `secpal.*` domains still fail the check
- Excluded deprecated `kotlin-stdlib-jdk7` and `kotlin-stdlib-jdk8` transitive modules from the native Android build so Debug APK assembly works with the current Capacitor and AndroidX dependency graph
- Hardened Android release helper scripts to reject unsafe env-file ownership or permissions, apply restrictive secret-file umask defaults, and escape generated env values safely
- Corrected `scripts/preflight.sh` so unstaged and untracked files are included consistently for markdown, REUSE, and local PR-size decisions
