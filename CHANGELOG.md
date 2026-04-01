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

- Android frontend-build bootstrap injection that installs the native auth bridge before the shared UI starts, so the Android wrapper can use native bearer-token auth without modifying the browser/PWA source tree
- native authenticated request execution for the Android auth bridge so the WebView can hand protected API operations to the native layer, which attaches the bearer token itself and returns only sanitized operation results
- `TokenCipher` interface and `KeystoreTokenCipher` implementation that extract the AES/GCM/NoPadding encryption logic from `KeystoreTokenStorage` into an injectable seam so cipher behavior can be exercised in unit tests without access to the production Android Keystore
- `EncryptedTokenPayload` value type that carries ciphertext and IV between the cipher and storage layers
- `KeystoreTokenStorageTest` with round-trip, empty-storage, and failed-decrypt-clears-storage scenarios exercised through `FakeTokenCipher` and `InMemorySharedPreferences`
- `NativeAuthHttpClientTest` covering URL normalisation and error-message extraction
- `SecPalNativeAuthPluginTest` covering HTTP error-code resolution and the non-HTTP fallback path
- `tests/native-auth-bridge-bootstrap.test.ts` covering the injected Android bootstrap script, bridge installation, native `/v1/` request routing, and the browser-session fallback for non-native/public traffic

### Changed

- extended the local Prettier scripts to include `.mjs` helpers so formatting checks cover Node maintenance scripts consistently; introduced a repo-local `local-prettier.yml` reusable workflow that produces the `Formatting Check / Check Code Formatting` check name required by branch protection, working around a CI failure in the shared `reusable-prettier` caused by the newly introduced `setup-node-with-deps` composite action (tracked in SecPal/.github)
- documented the ImageMagick `magick` prerequisite for `npm run brand:sync` in the Android README so launcher and splash asset sync no longer depends on undocumented local tooling
- reduced the repo-local Copilot always-on context by replacing the long runtime baseline and removing the auto-loaded overlay fallback, which lowers request size in large VS Code workspaces without dropping the Android-specific governance rules
- Android launcher icons and splash artwork are now generated from the canonical frontend SecPal logo assets via `npm run brand:sync`, so the native wrapper reuses the same brand mark instead of drifting onto Android-only placeholder artwork
- clarified across repo-local instructions, validation scripts, and Android release docs that `app.secpal.app` remains only the Android application identifier, while `api.secpal.dev` and `app.secpal.dev` are the active API/PWA hosts and `secpal.app` stays limited to the public homepage plus real email addresses; rewrote ANDROID_RELEASE_DISTRIBUTION.md example sentence to remove invented `secpal.*` identifiers and replace them with descriptive phrases so the domain policy check is not weakened by line-colocation
- strengthened `check-domains.sh` violations allowlist with proper word-boundary anchors so subdomains such as `myapi.secpal.dev` are no longer incorrectly excluded by substring matching
- the Android wrapper build now patches the generated sibling frontend `dist/index.html` with a native-auth bootstrap script so `SecPalNativeAuthBridge` is available before the shared React app resolves its auth transport, and authenticated `/v1/` API calls in the Android WebView no longer rely on browser cookies or `/sanctum/csrf-cookie`
- `SecPalNativeAuthPlugin.request`, `NativeAuthHttpClient.request`, and `native-auth-bridge.ts` now transport raw request and response bodies as Base64 so the Android wrapper can proxy JSON, multipart uploads, and binary downloads through the native bearer-token boundary while preserving HTTP status codes for the shared UI
- `SecPalNativeAuthPlugin` now resolves its API base URL from native Android resources instead of accepting a token-bearing request origin from the WebView bridge, and `NativeAuthHttpClient.normalizeBaseUrl` now parses URL components strictly to reject userinfo, paths, query strings, and fragments before any credentialed request is sent
- `api_base_url` in Android resources now stays on the canonical `api.secpal.dev` API origin; `app.secpal.app` remains only the Android application identifier and is not treated as a deployable web domain
- `decodeJsonStringFragment` in `NativeAuthHttpClient` now handles JSON `\\uXXXX` unicode escapes (including surrogate pairs) so server error messages that contain unicode escape sequences are displayed correctly
- `SecPalNativeAuthPlugin` and `native-auth-bridge.ts` now expose a dedicated authenticated request path in addition to login, current-user bootstrap, and logout so later Android flow wiring can call protected endpoints without moving the bearer token into JavaScript
- `KeystoreTokenStorage` now accepts an injectable `TokenCipher` via a package-private secondary constructor so tests can substitute a fake cipher without touching the Keystore
- `NativeAuthHttpClient.normalizeBaseUrl` and `buildErrorMessage` (formerly `extractErrorMessage`) promoted to `static` visibility for direct unit-test access; `extractErrorMessage` replaced with regex-based extraction to remove the `JSONException` dependency from the helper path
- `SecPalNativeAuthPlugin.resolveErrorCode` extracted as `static` package-private method so error-code mapping can be verified without a running Capacitor plugin instance

### Fixed

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
- Set the Capacitor Android wrapper hostname to `app.secpal.dev` so the native WebView origin matches the API CORS allowlist and the login health check no longer fails with a false "System not ready" state while still keeping the Android package ID at `app.secpal.app`

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
- Updated the Android product identity to the public `SecPal` app name with the shared application ID `app.secpal.app`
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
