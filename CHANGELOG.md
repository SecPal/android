<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Strengthened Copilot governance: require test-impact analysis and same-commit test updates when a fix alters observable behavior, explicitly require running tests locally before pushing behavioral or security changes, and mandate `--body-file` for programmatic PR creation to prevent shell escaping issues.
- strengthened repo-local Copilot governance for AI findings: Android work now requires proof of defect before merging AI-generated fix PRs, treats green CI alone as insufficient evidence for bridge or auth cleanups, and documents focused verification of listener handles and teardown ordering
- Android domain-policy validation now composes its approved-host allowlist from named regex fragments and bounds raw `secpal.*` discovery matches, making the check easier to review while preserving the existing host policy.

### Fixed

- Samsung Knox hard-key broadcasts now require SecPal to be running as a real Android device owner or profile owner before `SamsungHardKeyReceiver` forwards them into `MainActivity`, reducing spoofable third-party foreground launches on unmanaged devices while preserving the managed-device hard-key flow.
- Samsung Knox hard-key receiver broadcasts are now explicitly left exported in the manifest, with an inline rationale that the broadcast origin is outside SecPal's UID and no verifiable public sender permission is currently documented; this removes the `exported="false"` delivery blocker for Samsung `HARD_KEY_PRESS` and `HARD_KEY_REPORT` routing on managed devices.
- Samsung managed-device hard-key setup now wires optional partner `app_key_ptt_data` and `app_key_sos_data` manifest metadata through Android build placeholders, so Knox-distributed SecPal builds can inject Samsung app-key values without forking the committed manifest while local and non-Samsung builds keep working with empty defaults.
- Samsung XCover hard-key routing now also declares and interprets Knox `HARD_KEY_REPORT` broadcasts, including Samsung key-code and report-type extras for XCover and SOS hardware buttons, so the Android wrapper can forward Samsung-origin launch events instead of relying only on the older `HARD_KEY_PRESS` path.
- Restored focused Android Java unit-test compilation after the bootstrap state API rename by aligning `ProvisioningBootstrapStoreTest` with `ProvisioningBootstrapState.getApiBaseUrl()`, so `testDebugUnitTest --tests ...` no longer fails before the requested class is compiled.
- The debug Android manifest overlay now sets `android:testOnly="true"` directly without an unnecessary replace directive, removing the Gradle manifest-merge warning during focused unit-test runs.

### Added

- Samsung Knox hardware-button launch wiring in the Android wrapper: protected hard-key broadcasts now bring `MainActivity` to the foreground, Samsung emergency launch aliases can map short- and long-press surfaces into retained enterprise-bridge events, and hardware-trigger launches request wake/keyguard dismissal so the injected bridge can still route emergency entry points while the WebView is starting or the app was backgrounded
- Regression coverage for bootstrap-store retry persistence after a failed exchange commit and for native enterprise-bridge delegation of phone, SMS, and gesture-navigation calls.
- generic Android hardware-button bridge events in the enterprise wrapper: foreground `dispatchKeyEvent` input now reaches `SecPalEnterpriseBridge` as typed pressed, short-press, and long-press callbacks so the Android shell can wire emergency navigation without Samsung-specific launch plumbing in the same PR
- typed Android enterprise bridge source API: the wrapper now ships `src/secpal/native-enterprise-bridge.ts` with strict TypeScript contracts for managed-state distribution metadata and focused tests for completed, pending, and failed bootstrap visibility, so later Android rollout/update UX can consume `SecPalEnterprise` without ad-hoc global typing
- enterprise bridge distribution-state visibility in the Android wrapper: `SecPalEnterprisePlugin.getManagedState()` now exposes the persisted bootstrap status, update channel, release metadata URL, and last bootstrap error code so later Android update UX can reason about managed-device rollout state without touching bootstrap tokens
- Android bootstrap exchange runtime for Epic SecPal/.github#327: the wrapper now persists provisioning QR bootstrap extras during Device Owner hand-off, retries the public `/v1/android/bootstrap/exchange` flow on managed app startup when connectivity is available, and stores the exchanged tenant/channel/release metadata plus managed policy profile for the single-package `app.secpal` architecture
- Android provisioning bootstrap state foundation for Epic SecPal/.github#327: device-owner provisioning extras can now persist the short-lived enrollment token securely, `KeystoreTokenStorage` supports isolated encrypted token namespaces, and dedicated bootstrap state/storage tests cover the tenant/channel metadata handoff needed for the later runtime exchange flow
- app-controlled gesture-navigation support in the Android wrapper: `SecPalEnterprisePlugin` and the injected `SecPalEnterpriseBridge` can now open the device's official navigation-mode settings screen from SecPal itself, temporarily leaving lock task for that system flow and re-entering the managed kiosk when the user returns; dedicated-device provisioning now also prefers gesture navigation by default, applies managed navigation settings during provisioning, and falls back to the official gesture-navigation screen on first managed launch when a device still requires the OEM settings UI
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

### Fixed

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

### Added

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

### Added

- Initial `android` repository scaffold with SecPal governance baseline files, hooks, and workflows
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
