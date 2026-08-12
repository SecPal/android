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

- Added a daily and change-filtered API-35 Android emulator smoke workflow that
  builds the current frontend `main`, verifies runtime discovery and persistence,
  native password authentication, a protected profile read, foreground lifecycle,
  UI logout persistence, and instance switching, with bounded readiness checks
  failure-only diagnostics, and the verified content-hashed same-origin native
  bridge asset under the strict CSP.
- Added native Android debug JVM unit tests to the normal quality workflow,
  with bounded execution and Gradle reports retained only on test failure.
- Added bounded Android lint coverage for every supported app variant to the
  repository quality workflow, with generated reports retained on task failure;
  independent variants continue after a lint failure, and Gradle preserves the
  Java environment selected by the repository helper (issue #466).
- Added canonical Android `0.1.0` versioning, a fail-closed Ruby UTC build-code allocator, shared Play/Direct publication source checks, and a VPS publishing process lock (issue #424).
- Added the `SECPAL_ANDROID_FRONTEND_DIR` override for frontend builds so
  linked workspaces can use a frontend checkout outside the conventional
  `SecPal/{frontend,android}` layout (issue #445).
- Added generated Google Play services/Firebase open-source notices to Android release artifacts and the native notices activity for a frontend-owned entry point.

### Fixed

- Constrained the bearer-authenticated Android request broker to a reviewed
  method, canonical route, query-key, request-media-type, and response-kind
  inventory; ambiguous encodings, credential/bootstrap routes, unknown
  operations, unsupported media, oversized bodies, and every HTTP redirect now
  fail closed before credentials can leave the validated runtime origin. The
  obsolete raw `setApiBaseUrl`, `setRuntimeBootstrap`, and
  `clearRuntimeBootstrap` Capacitor exports were removed; runtime selection and
  reset now require single-use native user confirmation through the breaking
  `confirmRuntimeBootstrap` and `confirmRuntimeReset` plugin contract. The
  confirmation identifies the natively canonicalized target, cancelled or
  failed resets preserve the current frontend runtime atomically, rebinding
  clears even orphaned credentials unless the existing canonical origin is
  identical, and parity coverage keeps retired Android enrollment-session
  operations and other uncalled service routes outside the least-privilege
  inventory (issue #408).

- Allowed one additional bounded API 37 emulator recovery for the exact
  zero-test split-APK install-session broken-pipe failure while keeping
  persistent package-service failures and real instrumentation failures
  fail-closed (issue #579).
- Restored strict-CSP-compatible Android native-auth packaging by building the
  shared frontend's verified `android-native` surface, emitting the canonical
  bootstrap as one content-hashed same-origin asset before the application
  module, and binding its path, bytes, schema, metadata, overlays, and complete
  inventory across directory, debug/store-listing, APK, and AAB packaging
  paths without inline script or event-handler allowances. Verification also
  requires the meta-delivered policy to be effective before any active head
  content, reinjection restores the bridge's canonical position before the
  application module, and strict-CSP browser coverage remains mandatory in the
  quality workflow without requiring a system browser for unrelated local test
  runs (issue #508, part of #402).
- Opened the protected profile through the running frontend's user menu in the
  Android smoke, preserving the native authenticated SPA state instead of
  forcing a full WebView navigation.
- Required logout persistence checks to accept only the native
  `NO_STORED_TOKEN` result, rather than hiding network, storage, or bridge
  failures as successful logout.
- Required the Android smoke health check to observe SecPal as the foreground
  activity, so a backgrounded or covered WebView cannot pass the user journey.
- Required the API-35 smoke WebView to reach the ready development API before
  starting instance discovery, avoiding a false discovery failure while the
  freshly booted emulator is still establishing its default network.
- Derived the Android smoke APK version code from the current UTC day using the
  highest daily build sequence, so runtime discovery no longer presents the
  debug-only Gradle default build `1` to the development API compatibility gate.
- Removed a dead assignment from the Android smoke bridge CSP authorizer,
  added a focused lint regression guard, and included MJS scripts in the
  repository lint entrypoint so that guard runs locally and in CI.
- Restored readable PATCH, MINOR, and MAJOR classification for versioned
  GitHub Actions Dependabot updates, while keeping unversioned SecPal reusable
  workflows on immutable commit pins in a separate manual-review group; the
  auto-merge caller now uses reviewed target-branch code with a write-capable
  token.
- Required review provenance findings to bind full commit SHAs to the reviewed
  pull request's commit set, resolve identity and signature metadata from the
  exact commit object, and deduplicate repeated evidence (issue #563).
- Kept the CodeQL initialization and analysis actions on the same release to
  prevent configuration-version failures in the security workflow.
- Overrode the vulnerable transitive `nanoid` dependency to 3.3.17, preventing
  custom generators from looping indefinitely when invoked with a zero size
  (issue #539).
- Aligned the local Prettier pre-commit hook with `format:check`, including
  TypeScript, JavaScript, MJS, CSS, and HTML, and added a regression guard for
  future scope drift (issue #525).
- Stabilized API 37 connected tests by recognizing zero-test PackageManager
  install-write failures and allowing one emulator recovery per distinct
  infrastructure failure while failing closed on identical repeats (issue
  #509).
- Allowed one final bounded API 37 instrumentation retry when the Android
  package service remains unavailable after the first emulator recovery.
- Overrode the `uuid` transitive dependency used by the Capacitor CLI so the
  vulnerable pre-11.1.1 releases are not installed.
- Made the PR-size workflow guard accept routine Dependabot updates while still
  requiring the expected reusable workflow, least-privilege permissions, and a
  full immutable commit SHA.
- Added an always-reported certificate-transparency aggregate check that runs
  the emulator matrix only for relevant pull-request changes and fails closed
  when change detection or any matrix job fails (issue #521).
- Bounded certificate-transparency matrix jobs to 15 minutes for regular jobs
  below API 37, 25 minutes for API 36 live probes, and 35 minutes on API 37;
  limited post-reboot readiness waits to four minutes and capped emulator
  cleanup at 30 seconds.
- Recognized API 37 zero-test instrumentation command errors with diagnostic
  messages and rebooted the emulator before the bounded retry.
- Allowed the API 37 instrumentation harness one final rebooted attempt when a
  retry after a pre-test system crash or zero-test command error loses the
  Android package service, while retaining the existing retry caps for repeated
  crashes and test failures.
- Made the publish-lock permission rejection test deterministic across process
  umasks by explicitly applying the overly permissive directory mode it is
  intended to exercise (issue #513).
- Encoded the intentional Android Credential Manager provider exclusion at the
  application declaration so lint remains clean while passkeys stay gated to
  Android 14+ and the vulnerable Play services FIDO path remains forbidden
  (issue #465).
- Updated Android device readiness polling to perform one immediate probe, cap
  retry sleeps to the remaining timeout, and stop polling when the deadline is
  exhausted (issue #497).
- Made local and hosted pull-request size reporting advisory at 600 changed
  lines, removing the override file, approval label, and size-triggered push
  failure while preserving every non-size validation gate.
- Corrected the legacy Android launcher icons so standard variants retain the
  SecPal shield silhouette, round variants are genuinely circular, and repeated
  brand syncs reproduce the checked-in raster geometry deterministically,
  removing `IconLauncherShape` lint warnings without affecting adaptive icons
  (issue #463).
- Refreshed the synced Android WebView asset to the canonical schema-4 bridge,
  excluded the force-tracked generated index from PR-size accounting, made every
  native pre-build refresh the complete generated frontend tree, retained strict
  drift and shell rejection before packaging, and made bridge insertion and the
  Node preparation entry point parser- and path-safe so ignored Capacitor assets
  cannot silently produce broken apps or block Android resource and lint
  validation, while standalone Android verification builds reuse the canonical
  tracked index when frontend source is unavailable instead of requiring a
  sibling checkout; distributable packaging now fails without frontend source,
  the native-only `ctRegression` CI variant remains independently buildable, and
  the clean-checkout task-graph guard does not treat that native-only APK as a
  distributable WebView artifact; a deterministic SHA-256 inventory now binds
  every packageable frontend build output to the generated directory and signed
  APK or AAB, rejecting missing, modified, duplicate, or unexpected files
  without guessing runtime dependencies from HTML, CSS, or JavaScript source;
  the mutable inventory is generated after Capacitor adds its final Android
  assets, while standalone verification uses a separate immutable fallback and
  test fixtures generate inventories in-process; inventory generation and AAPT
  packaging now consume the same checked-in, case-insensitive exclusion policy
  so deliberately omitted frontend debris cannot poison artifact verification;
  artifact inspection now reads literal ZIP member names and streams SHA-256
  verification without a whole-file stdout limit, while the tracked fallback
  index is pinned to LF so its inventory hash is checkout-independent;
  verification still guards every release artifact task and resolves frontend
  overrides relative to the Android root (issues #487, #491, and #493).
- Removed unused Capacitor template layout, launcher vectors, legacy splash
  bitmaps and their brand-sync regeneration path, and string overrides while
  retaining the name-resolved Cordova configuration through an exact resource
  keep contract and documenting the build-time API URL source (issue #462).
- Removed unreachable Android 23 compatibility guards from Device Owner
  status-bar policy handling and made the launcher foreground drawable available
  through the unqualified resource path now that the minimum SDK is 24 (issue
  #461).
- Loaded dedicated-device home fallback icons through AppCompat resources so
  vector and themed drawables remain compatible across supported Android
  versions (issue #460).
- Allowed derived Android test application IDs only in complete, CRLF-safe,
  line-anchored uninstall, admin-component, and instrumentation-runner contexts
  while retaining linear-time, Unicode-aware whole-authority forbidden-host
  detection, including repeated terminal DNS root dots (issue #482).
- Corrected the native WebView compatibility screen's scroll-child sizing
  contract while preserving centered short content and scrollable long update
  guidance on constrained displays (issue #459).
- Normalized Android push-provider metadata with the locale-independent root
  locale so device language settings cannot alter internal identifiers (issue
  #458).
- Made kiosk managed-update policy tests select debug and release semantics
  explicitly so release-derived `ctRegression` validates both without changing
  production build-mode selection, including a device-owner instrumentation
  check that waits for Android's post-boot account compatibility scan before
  provisioning against the platform policy service (issue #479).
- Restored canonical Android manifest ordering by declaring network permissions
  before the application element, preventing the `ManifestOrder` lint finding
  without changing the permission or application contract (issue #457).
- Rebooted the API 37 emulator before the single retry for pre-test
  PackageManager broken-pipe or unavailable-service failures so the retry does
  not reuse the same damaged Android system service.
- Retried the connected-test Gradle invocation once only when an HTTP 403
  response belongs to a Maven Central dependency request, while preserving API
  37 device recovery when the retried invocation encounters a recognized
  infrastructure failure (issue #496).
- Rebooted the API 37 emulator before retrying a recognized pre-test system
  crash so the second instrumentation attempt starts from a recovered Android
  system instead of reusing the crashed instance (issue #498).
- Kept Android release network-security verification compatible with
  `@xmldom/xmldom` 0.9 by collecting parser diagnostics through its current
  `onError` callback.
- Defined explicit fail-closed Android 12+ cloud-backup and device-transfer
  rules, retained the legacy backup disable/configuration, and added focused
  manifest policy coverage (issue #456).
- Retried the complete zero-test instrumentation command-error failure once on
  API 37 without retrying it on earlier API levels or after tests have started
  (issue #473).
- Guarded Android 28 lock-task features and date/time user restrictions,
  versioned the applied Device Owner policy state, and made Android 28
  availability part of its signature so existing and OS-upgraded enterprise
  devices receive the policies available on their API level (issue #454).
- Kept the documented test-only APK replacement path available during debug
  dedicated-device kiosk tests, bumped the Device Owner policy revision, and
  cleared the legacy debug install-apps restriction during policy migration
  without weakening the corresponding release restriction.

### Changed

- Separated the persisted Android publication baseline, manual deploy override, and temporary Gradle build code; signed build-only lanes now require an explicit code and legacy version-name environment values are ignored.
- Corrected the direct-download release state by publishing non-downloadable unavailable metadata for Stable, the Stable aliases, and Beta and permanently deleting the affected schema-3 Latest, checksum, and versioned-release files. The completed one-time withdrawal machinery is not retained; future Stable/Beta publications remain serialized by the shared remote lock, restore the exact prior APK/checksum presence after an interrupted replacement, reject reuse of the retired schema-3 version codes from a tracked floor, and must pass the signed schema-4 artifact guard (issue `#434`, part of `SecPal/.github#590`).
- Enforced schema `4` as the only Android runtime-bootstrap contract: shared frontend discovery requires strict integer schema `4`, the injected bridge always emits integer schema `4` for notification registration after fresh setup or native restoration, persisted schema and minimum-version/build markers cannot override or gate that value, and signed APK/AAB builds fail before upload unless the artifact-type-specific WebView index contains exactly one canonical, executable schema-4 registration path; artifact inspection independently parses the bridge schema constant and registration assignment, rejects missing, duplicate, conflicting, commented, or non-canonical paths and tags, reports corrupt archives accurately, preserves archive-fixture process failures, and removes the superseded compatibility wording without changing authentication, push lifecycle, or Device Owner/profile-owner behavior (issue `#432`, part of `SecPal/.github#590`).
- Removed the retired frontend-issued Android enrollment bootstrap exchange, its persisted state, enterprise bridge payload, token-prefix storage abstraction, parsing helpers, and obsolete `managedAndroidEnrollment` runtime-bootstrap compatibility flag; both regular and dedicated-home app startup now delete any encrypted token and derived enrollment state left by an older installation without reading it, Android push registration uses bootstrap schema `4`, and independent Device Owner/profile-owner policy and Stable/Beta distribution behavior remain unchanged.
- Domain-policy storage-key exemptions now use fail-closed candidate and per-reference fixpoint proofs for initialized keys and reachable, zero-argument named helpers, dynamically count at most eight aggregate live helper execution paths through their target storage statements and prefixes, ignore erased type references and proven dormant declarations, closures, constructors, methods, accessors, or instance initializers without hiding live computed names or static initialization, and reject unproven prefixes, longer paths, exports, asynchronous or parameterized helpers, generators, decorators, optional calls, deferred calls, and escaped flows.
- Replaced regex-only browser-storage key exemptions in domain-policy validation with a fail-closed TypeScript syntax-tree whitelist for straight-line top-level calls and single-variable declarations, including passive declarations, classes, and directives, matching TypeScript literal annotations, erased type-only imports and exports, module-hoisted runtime dependency checks, scoped setup hazards, unrelated and repeated direct storage calls, lexical context, scope, shadowing, exact call arity, complete literal initializers, TypeScript wrappers, template-use tracking, and rejection of aliases before use, runtime exports, indirect execution, concatenation, and dual use.
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

- Pinned every external GitHub Action and reusable workflow to a verified full
  commit SHA with validated version documentation, including immutable nested
  actions in shared workflows, backed by an AST-based regression guard that
  resolves YAML aliases without maintaining a custom event parser, requires
  each reference and its version documentation on one physical line, covers
  workflow and recursively referenced composite-action paths and general Git
  tag and branch names, plus a direct semantic guard for both valid
  root-directory forms of the enabled, unfiltered GitHub Actions Dependabot
  updater and documentation of the active organization and repository
  SHA-pinning policies (issue #529).
- Raised the existing transitive `brace-expansion` override floor from
  `^5.0.8` to `^5.0.9`, resolving the high-severity denial-of-service advisory
  `GHSA-rgw5-rvv9-x895` in the ESLint dependency path (issue #515).
- Restricted debug enterprise-policy broadcasts to callers holding the
  privileged `android.permission.DUMP` permission held by the Android shell;
  Samsung hard-key broadcasts now require the platform-signature-protected
  `KNOX_CUSTOM_SETTING` permission declared by Samsung's managed-key receiver
  contract on every supported Android version (issue #455).
- Enabled Android platform Certificate Transparency enforcement for every
  remote HTTPS destination on API 36 and later so runtime-selected customer
  instances and canonical API origins receive the same policy, retained a
  separately packaged API 24-through-35 system-PKI fallback, and added
  Android 17 loopback hardening, release-equivalent emulator regressions, a
  parameterized SecPal reference/customer-chain probe, and a customer-operator
  recovery contract (issue #450).
- Removed the unaudited static Android SPKI pins that locked signed clients out
  after a legitimate certificate-chain rotation; global cleartext prohibition,
  Android system trust, and standard TLS certificate and hostname validation
  remain active (issue #449).
- Removed the unused Capacitor HTTP, cookie, and WebView path-management core
  plugins from Android's native registration boundary, retained only native
  SystemBars lifecycle/inset behavior while hiding it from plugin exports and
  rejecting all direct JavaScript dispatch to it;
  and added fail-closed install/sync plus packaged-WebView regressions so
  Capacitor upgrades cannot silently restore the capabilities (issue #409,
  part of #402).
- Updated the transitive `brace-expansion` and `js-yaml` overrides to the
  compatible patched `^5.0.8` and `^5.2.2` release lines, resolving
  `GHSA-mh99-v99m-4gvg` and `GHSA-pm4m-ph32-ghv5`, and added a CI audit that
  blocks future high-severity npm advisories (issues #438, #441).
- Updated the Vite/Vitest `postcss` override to the compatible patched
  `^8.5.15` release line, resolving the source-map disclosure advisories
  `GHSA-6g55-p6wh-862q` and `GHSA-r28c-9q8g-f849` (issue #439).
- SecPal now requires Android System WebView or Chrome 83 or later with the
  AndroidX `WEB_MESSAGE_LISTENER` capability. If detection or secure listener
  installation fails, the Capacitor bridge is not created and the app shows a
  native update screen without a WebView or network capability instead (issue
  #407). That compatibility screen now reapplies managed-device lock-task
  policy and preserves screenshot protection.
- Constrained transitive `tar` dependencies to a compatible release line
  starting at the `tar@7.5.19` floor required by `GHSA-23hp-3jrh-7fpw` and
  currently resolving to `tar@7.5.21`. The earlier
  `brace-expansion@5.0.6`/`5.0.7` remediations tracked in issue `#258` are
  superseded by the issue `#441` remediation above.
- Removed Capacitor's `addJavascriptInterface()` fallback for unavailable or failed origin-aware bridge listeners, removed retained direct legacy plugin interfaces, preserved SystemBars initialization through the native page lifecycle, and added source-drift tests that fail if an upgrade restores the insecure bridge path (issue #414, part of #407).
- Added regression coverage that keeps domain-policy storage-key exemptions
  fail-closed when browser-global aliases, storage constructors or prototypes,
  dynamic execution, or escaped storage receivers could mutate the receiver.

- Removed the Google Play services Credential Manager provider to eliminate vulnerable FIDO/Tink protobuf generated code from Android release artifacts. Passkey registration and sign-in now require Android 14 or newer; password sign-in remains available on supported older Android versions.
- Removed the WebView-accessible gesture-navigation settings bridge so JavaScript can no longer force managed dedicated devices out of lock task into Android Settings; the OEM settings hand-off remains limited to the native provisioning flow.
- disabled the WebView-accessible Android offline-vault root-key bridge so JavaScript can no longer create or unwrap device-bound vault root-key envelopes until a non-exfiltrating native read path exists
- Added `android-release.env` to the repo-local ignore rules so Android signing environment files are not accidentally staged from developer machines.
- Removed the optional `email` field from native public-passkey (`token`-mode) challenge startup so the Android wrapper, bridge, and injected plugin contract now match the discoverable-only API surface required by `SecPal/api#1101`. `SecPalNativeAuthPlugin.loginWithPasskey`, `NativeAuthHttpClient.startTokenPasskeyAuthenticationChallenge`, the typed `NativeAuthBridge.loginWithPasskey` signature, and the injected `SecPalNativeAuthBridge` no longer accept or forward an `email` argument, preventing email-scoped public passkey challenges from being issued through the Android shell (issue #225).

### Fixed

- Made Android network-policy verification parse decoded XML values, reject
  configuration-qualified policy replacements, keep the release-derived
  instrumentation package assertion variant-safe, and run the packaged
  Certificate Transparency matrix whenever its emulator harness changes. The
  scheduled probe now creates only API 36/37 jobs, the release-derived test
  manifest excludes the exported debug enterprise-policy receiver, and the API
  37 lane retries once only after a transient PackageManager broken pipe or an
  Android system crash before the first instrumented test starts. Slow negative
  emulator-readiness cases now have an explicit test timeout budget (issue
  #450).
- Kept the AndroidX tracing and Kotlin runtime boundaries in the separately
  minified Certificate Transparency regression app so AndroidJUnitRunner
  starts before the packaged policy tests on supported API levels (issue
  #450).
- Installed the current Android SDK Platform Tools alongside the API 37
  emulator image, selected a current Pixel phone profile, and allocated the
  4 GB of VM memory required by Android 17 (issue #450).
- Built the Certificate Transparency regression APK before starting the API 37
  emulator, provisioned an 8 GB data partition, and waited for both the settings
  provider and package manager before installation, avoiding attempts against a
  partially available framework or a full default data partition (issue #450).
- Upgraded AndroidX WebKit to 1.13.0 and placed Web Authentication setup inside
  its positive runtime feature guard so Android lint validates both the feature
  constant and the guarded API call without baselines or suppressions (issue
  #453).
- Declared Minitest as a locked Ruby test dependency and bound Fastlane tests
  to Bundler so fresh release machines no longer depend on system gems (issue
  #447).
- Kept the highest valid Android publication baseline across shell, persisted, and legacy values, preventing stale configuration from reusing previously issued version codes.
- Kept one runner-account-wide Android publishing lock across custom release contexts and process-level home overrides while securely creating its private directory, and kept Fastlane aligned with the exact release env file selected by the shell loader.
- Required explicit shared-sequence codes for every signed build-only entry point, honored caller-provided publication baselines, and rejected SemVer-invalid numeric prerelease identifiers.
- Pinned the third-party Ruby setup action used by Android release tests to an immutable reviewed commit.
- Made Direct release metadata validation unambiguous and fail-closed, persisted the successful publication baseline atomically, and regression-tested publication failure cleanup.
- Made the Capacitor core-plugin exclusion guard reject reformatted forbidden
  class and instance registrations while ignoring comment-only structural
  examples, blocked the direct same-origin Capacitor native HTTP interceptor,
  made comment-interrupted export and dispatch transformations fail closed,
  initialized each WebMessage reply proxy before dispatch can synchronously
  reject a call, made packaged-frontend assertions wait for React rendering,
  made child-frame isolation tests reject every native reply shape and directly
  prove child calls never execute, registered the invocation probe during bridge
  construction before the Activity reaches `STARTED`, waited for destroyed
  WebViews to leave the UI queue between instrumentation cases, and aligned
  packaged-frontend bridge tests with Capacitor's harmless web-only JavaScript
  proxies.
- Preserved the underlying process diagnostics when Android release archive fixtures cannot run `zip`, and distinguished `unzip` inspection failures from invalid AndroidX graphics-path library layouts (issue #435).
- Restored clean, reproducible Capacitor Android syncs by normalizing every generated Cordova artifact, and corrected the origin-aware bridge isolation test so its same-origin child-frame expectations and retained-plugin invocation tracking match Android WebView behavior.
- Stabilized the origin-aware Android WebView instrumentation tests by releasing callback-scoped native objects, unregistering their message listener, and waiting for a blank visual state before destroying each activity.
- Domain-policy validation now accepts approved variable-backed browser-storage keys used inside error-handling `try` blocks, including the frontend asset
  recovery key, while retaining fail-closed execution-boundary, receiver-provenance, declaration-order, eligible-helper, same-key guard, callback-suffix,
  helper-prefix, and unapproved-host checks (issue #366).
- Domain-policy validation now semantically checks executable HTML event-handler
  attributes and `javascript:` URLs, including SVG `xlink:href`, before
  exempting browser-storage keys, preserving source locations through complete
  HTML character-reference and URL decoding, incorporating page-script storage
  hazards, and rejecting shadowed browser-storage receivers (issue #393).
- Domain-policy validation now uses a WHATWG-compatible HTML parse tree to
  analyze executable inline HTML, SVG, and nested `srcdoc` scripts with
  document-ordered execution prefixes and position-aware deferred barriers,
  mutually exclusive `nomodule` fallbacks, standalone asynchronous modules,
  and fail-closed module dependencies, while preserving inert/raw-text and SVG
  markup for non-source scanning and distinguishing decoded content,
  namespaces, module grammar, cross-script shadows, and declaration
  availability at each script's execution point (#386).
- Domain-policy storage-key exemptions now trace locally resolved helper calls
  before IIFE storage uses, including nested block IIFEs, and reject unapproved
  domain-like storage keys at any position while preserving ordinary keys and
  approved domain occurrences (issue #375).
- Domain-policy storage-key exemptions now prove bounded, straight-line
  execution through concise, nested, and consecutive zero-argument IIFEs while
  execution remains synchronous, stop at async suspension or deferred
  callbacks, and validate each enclosing prefix before a storage call (issue
  #377).
- Excluded Fastlane's generated README from Markdown validation so its mixed
  setext and ATX headings no longer fail repository preflight while heading
  style enforcement remains enabled for maintained documentation (issue #360).
- Domain-policy validation now fails closed when its parser pipeline cannot
  execute, while still accepting empty filter results and avoiding
  platform-specific `xargs` behavior (issue #364).
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
- Serialized injected Android runtime-bootstrap apply/clear mutations, rejected stale applies, canonicalized shared-frontend payloads at the bridge boundary, failed closed when native clear support is unavailable, and reset the in-memory native-auth flag during successful runtime clearing.
- Hardened the injected Android runtime-bootstrap bridge so shared frontend apply/clear calls remove stale discovery UI, cannot be overwritten by an older in-flight native restore, and preserve the current frontend runtime and tenant browser state when native persistence cleanup reports a failure.
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
- Android native auth bootstrap now normalizes retained push-token `savedAt` persistence to canonical whole-second UTC timestamps with a trailing `Z`, rewrites legacy numeric storage values during hydration, and adds focused Vitest coverage so Android-side timestamp serialization aligns with the canonical API timestamp policy for issue `#257`.
- Android runtime bootstrap now consumes the canonical `features.notification_channels.android_fcm` and `notification_channels.android_fcm.public_runtime_metadata` contract, drops the injected bridge's last network fallback to legacy `android_push` bootstrap fields, clears the selected runtime plus tenant-scoped browser state when authenticated push registration reports `409 NOTIFICATION_RUNTIME_STATE_INVALID` or `409 NOTIFICATION_CHANNEL_UNSUPPORTED`, and adds focused Vitest coverage for issue `#252`.
- Android push token retention now persists trusted runtime FCM tokens into logout-safe browser storage as soon as the canonical runtime origin is known, rehydrates `__SecPalAndroidPushSyncState.currentToken` after the `/` -> `/login` recovery reload, reconciles divergent trusted storage entries by the freshest persisted token, hardens the live WebView auth smoke to reject pre-existing auth or push-sync state that would mask the reroute path, and adds focused Vitest coverage for logout-cleared storage, early-token-before-bootstrap-restore timing, and storage divergence in issue `#248`.
- Android push registration now permanently disables itself with a structured non-retryable error when secure Web Crypto UUID generation is unavailable in the injected WebView, exposes that state through `SecPalNativeAuthBridge.getAndroidPushRegistrationState()`, and adds focused Vitest coverage for issue `#244`.
- Android runtime bootstrap now ignores Android push token and error events unless they originate from the named customer runtime Firebase app, removing the last hidden fallback from customer-owned push configuration back to stale or foreign app instances and adding focused Vitest coverage for issue `#239`.
- Android runtime bootstrap now consumes retained native FCM token events in the injected auth bridge, registers and rotates the authenticated `/v1/me/push-devices/{installationId}` binding against the selected customer-hosted backend after login, revokes the device registration on logout and destructive instance reset, keeps the installation identifier deployment-scoped, and adds focused Vitest coverage for issue `#237`.
- Android runtime bootstrap now requests an FCM registration token from the deployment-scoped native Firebase runtime, retains named-app token and error events on the native auth bridge for later device-registration handling, guards against stale callbacks after `apply(null)` via generation-based cancellation, prevents late token delivery after plugin teardown via a destroy flag, propagates synchronous token-request failures to callers for correct persistence rollback, and adds focused Java coverage for issue `#241`.
- Android runtime bootstrap passes validated customer Android FCM metadata into the native auth plugin, which initializes and clears a deployment-scoped native Firebase runtime instead of relying on `google-services.json`, with focused bridge and Android unit coverage for issue `#238`.
- Android runtime bootstrap now rejects legacy `apiOrigin`-only restore state from the native plugin and requires structured persisted bootstrap metadata before rebinding after restart, closing the last hidden old-model restore path with focused Java and bridge regression coverage for issue `#232`.
- Android login now renders a small clickable instance hint directly below the passkey sign-in button, asks for confirmation before clearing the configured instance plus tenant-local browser state, and keeps the injected footer wording aligned with the existing shared frontend footer text while preserving focused regression coverage for issue `#231`.
- Android runtime bootstrap now persists the validated customer deployment in the native auth plugin, restores the selected canonical API binding on startup, and removes the hidden fallback back to the baked-in runtime API origin once a deployment was configured, with focused regression coverage for startup rebinding and fallback removal in issue `#230`.
- Added a native Android hardware-button route fallback for managed-device Samsung/XCover key events so short presses can still open `/profile` and long presses `/about` even when the injected Web listener is unavailable at runtime, resolving the remaining real-device validation gap in issue #123.

### Changed

- strengthened the provider-neutral AI-governance rollout so `AGENTS.md` now advertises the workflow-specific overlay at runtime, explicitly blesses `apk.secpal.app` as the canonical Android artifact host, and keeps the central AI-instructions validation job visible in release history
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

- Replaced the protobuf generated-code warning suppression with a verified
  buildscript pin from AGP's vulnerable Tink 1.7.0 edge to Tink 1.23.0, while
  continuing to reject Tink from the shipped release runtime graph (issue #356).
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
