<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
-->

# Android Runtime Bootstrap Contract

Audit date: 2026-08-12.

This contract defines the merged shared frontend runtime-discovery flow, the
Android native auth plugin, the injected WebView bridge, and persisted bootstrap
payloads. Schema `4` is the only supported Android runtime schema.

Runtime identity keeps the visible version and technical build separate. `appVersion` comes from the repository-root `VERSION` file through Android `versionName`; `appBuild` is the decimal Android `versionCode`, including the ten-digit UTC `YYYYMMDDXX` release format. The value remains below Google Play's integer ceiling and is carried through the native Java `long` and JSON number paths without truncation.

## Source Surfaces

- Frontend facade:
  [`SecPalRuntimeBootstrap`](https://github.com/SecPal/frontend/blob/main/src/native/SecPalRuntimeBootstrap.ts)
  maps canonical bootstrap JSON onto `globalThis.SecPalNativeAuthBridge`.
- Frontend discovery:
  [`discoverAndroidRuntimeBootstrap`](https://github.com/SecPal/frontend/blob/main/src/services/runtimeDiscovery.ts)
  calls `GET /v1/bootstrap` with Android runtime metadata and validates
  bootstrap version `v1` and requires strict integer schema `4`.
- Android injected bridge:
  [`scripts/inject-native-auth-bridge.mjs`](https://github.com/SecPal/android/blob/main/scripts/inject-native-auth-bridge.mjs)
  installs `globalThis.SecPalNativeAuthBridge` before the shared frontend
  starts. Packaging emits its canonical bytes as
  `/secpal-native-auth-bridge.<sha256>.js`; `index.html` contains only the empty
  same-origin script element and retains `script-src 'self'` plus
  `script-src-attr 'none'`. The CSP meta is the first head element after
  optional charset metadata so no active or resource-loading head content can
  precede enforcement.
- Android native plugin: `SecPalNativeAuthPlugin` exposes the Capacitor
  `SecPalNativeAuth` methods and persists the normalized bootstrap payload in
  `secpal_native_auth/runtime_bootstrap`.

## Canonical Schema

Frontend discovery accepts only bootstrap version `v1` with schema version `4`
encoded as a JSON integer. Every other schema value fails closed.

The packaged bridge retains its independent
`currentBootstrapSchemaVersion = 4` integrity marker but constructs no Android
notification-registration object. Native registration code owns the matching
schema-4 constant and payload. Native bootstrap persistence does not store a
schema field, and restoration normalizes persisted state to the fields listed
below. Persisted or restored runtime data therefore cannot select or override
the registration schema.
Android also requires or persists no minimum app-version or app-build field;
frontend discovery has already accepted the only supported schema before
applying the native runtime payload.

## Distribution Integrity

Stable and Beta artifacts must embed the canonical schema-4 bridge before their
metadata advertises `release_available: true`. The signed APK and AAB build
lanes inspect only the artifact-type-specific packaged WebView runtime, reject
missing, duplicate, or conflicting APK/AAB index locations, and fail closed
unless the frontend metadata is exactly the production `android-native`
surface and the one inventoried bridge asset has a filename matching the
SHA-256 of its exact canonical bytes. The bridge must contain exactly one
integer schema-4 marker and no JavaScript notification-registration assignment
or raw push-identity marker. This schema assertion is independent of the injector source
used for the final canonical byte comparison.

An artifact that emits any other runtime schema is unsupported and must not
remain available as an Android release. It must be replaced or withdrawn rather
than accepted by frontend discovery or API notification registration.

## Required Native Methods

| Frontend-required method                                          | Android implementation                                                                                                                                                                                                                                                                                                                | Keep rationale                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SecPalNativeAuthBridge.getRuntimeInfo()`                         | Injected bridge delegates to `SecPalNativeAuth.getRuntimeInfo()`, which returns `clientPlatform`, `appVersion`, and `appBuild`.                                                                                                                                                                                                       | Required before discovery so the frontend can call `/v1/bootstrap?client_platform=android&app_version=...&app_build=...`.                      |
| `SecPalNativeAuthBridge.getRuntimeBootstrap()`                    | Injected bridge delegates to `SecPalNativeAuth.getRuntimeBootstrap()`, which returns `{ configured: false }` or `{ configured: true, bootstrap }`.                                                                                                                                                                                    | Required on startup so the merged frontend can restore an already selected runtime without reopening discovery.                                |
| `SecPalNativeAuthBridge.setRuntimeBootstrap(bootstrap)`           | Injected bridge delegates to `SecPalNativeAuth.confirmRuntimeBootstrap(...)`; native code validates the payload, displays the resulting canonical API origin in a single-use confirmation, clears credentials unless the existing canonical origin is identical, then persists and rebinds.                                           | Required after discovery confirmation; JavaScript cannot directly invoke an unconfirmed or target-ambiguous native runtime setter.             |
| `SecPalNativeAuthBridge.clearRuntimeBootstrap()`                  | Injected bridge persists a recovery marker and delegates to `SecPalNativeAuth.confirmRuntimeReset()`, which binds cleanup to the confirmed native canonical origin before clearing persistence and tenant-bound credentials. Browser state is cleared only after native success, with startup recovery after an interrupted teardown. | Required for an explicit user-approved instance reset; cancellation or native failure preserves the current frontend runtime and tenant state. |
| `SecPalNativeAuthBridge.logout()` and `SecPalNativeAuth.logout()` | Native logout revokes the protected Android push binding before clearing the bearer token; the injected bridge only updates frontend auth state and dispatches `secpal:native-auth-logout` after success.                                                                                                                             | Required so raw push identity and logout ordering remain native while shared frontend auth state is updated.                                   |
| `SecPalNativeAuthBridge.request(...)`                             | Injected bridge routes allowlisted authenticated `/v1/...` frontend requests to `SecPalNativeAuth.request(...)`; native push registration does not traverse this JavaScript contract.                                                                                                                                                 | Required for ordinary authenticated frontend API operations without widening the push-identity boundary.                                       |
| `SecPalNativeAuthBridge.getAndroidPushRegistrationState()`        | Injected bridge delegates to native and returns only `state`, `configured`, `retryable`, and an optional stable `failureCode`.                                                                                                                                                                                                        | Required for UI behavior without exposing a token, UUID, timestamp, origin binding, or registration payload.                                   |
| `SecPalNativeAuthBridge.retryAndroidPushRegistration()`           | Injected bridge delegates an input-free retry to native protected state.                                                                                                                                                                                                                                                              | Required for intentional offline recovery without accepting JavaScript-supplied identity or registration data.                                 |

## Runtime Behavior

- Startup restore reads only the structured native runtime-bootstrap payload
  through `SecPalNativeAuthBridge.getRuntimeBootstrap()` and normalizes it
  without a schema field.
- Startup restores the protected push identity binding before initializing the
  named Firebase runtime, so an immediately completed token request cannot race
  ahead of tenant binding. Foreground resume re-queries the named runtime for
  its current token; native fingerprinting suppresses duplicate registration
  and treats a changed token as credential rotation.
- Discovery confirmation applies only through
  `SecPalNativeAuthBridge.setRuntimeBootstrap(...)`; the facade can complete
  only after the native confirmation callback applies the mutation.
- Runtime clearing through the public bridge method and the in-page reset flow
  both clear native bootstrap persistence, tenant-scoped browser storage,
  injected runtime state, and retained Android push state before discovery
  resumes.
- A cancelled or failed native reset is atomic from the frontend's perspective:
  it does not clear the configured origin, authenticated flag, or tenant-scoped
  browser storage. Startup compatibility recovery obeys the same rule and
  performs no logout or browser teardown before native confirmation succeeds;
  a rejected native push binding reports `reconfiguration_required` until the
  intentional reset flow is confirmed. If cancellation arrives while a synchronous
  native persistence or keystore mutation is already running, native settlement
  is deferred until that mutation reaches a safe terminal state; a committed
  reset resolves successfully so the frontend performs matching teardown,
  while a reset that did not commit rejects and preserves frontend state. After
  native persistence, credentials, and push
  runtime have cleared successfully, the reset uses the credential captured in
  memory to revoke any known server-side push installation and the authenticated
  server session on the exact confirmed origin on a best-effort basis before
  frontend teardown. An unreadable device-bound credential is treated as absent
  so it cannot prevent local reset. A durable browser marker completes tenant
  teardown on startup if the process stops after native cleanup; if native still
  reports a configured runtime, the stale marker is discarded without clearing
  tenant state. If native push cleanup fails after persistence or credentials
  were cleared, native state is restored before the reset is rejected and no
  server revocation is attempted.
- The baked-in Android resource value is a placeholder guardrail for native
  code paths that run before runtime binding. Login, authenticated requests,
  bootstrap restoration, and push registration use the selected canonical API
  origin.

## Bootstrap Payload Mapping

| Canonical frontend bootstrap field                                         | Android applied field                                    | Android behavior                                                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `api_base_url`                                                             | `rawApiBaseUrl`; `apiOrigin` is derived from its origin. | Native normalizes to a bare HTTPS origin, accepts either the origin or `/v1`, and rejects userinfo, query, fragment, or other paths. |
| `instance.display_name`                                                    | `instanceDisplayName`                                    | Persisted and returned to the bridge so runtime reset UI and restored state can show the configured instance.                        |
| `compatibility.bootstrap_version`                                          | Validation-only                                          | Frontend discovery requires `v1`; Android receives the already-applied payload and does not persist this field separately.           |
| `compatibility.schema_version`                                             | Validation-only                                          | Frontend discovery requires strict integer schema `4`; Android notification registration always emits integer schema `4`.            |
| `features.password_login`                                                  | `features.passwordLoginEnabled`                          | Native normalizes and persists this flag for restored bridge state.                                                                  |
| `features.passkey_login`                                                   | `features.passkeyLoginEnabled`                           | Native normalizes and persists this flag for restored bridge state.                                                                  |
| `features.notification_channels.android_fcm`                               | Controls whether `androidPush` is present.               | If Android FCM is disabled, native persists no Android push runtime metadata and clears the runtime Firebase app.                    |
| `notification_channels.android_fcm.channel`                                | `androidPush.provider`                                   | Frontend maps `android_fcm` to native provider `fcm`; native rejects any other provider.                                             |
| `notification_channels.android_fcm.metadata_revision`                      | `androidPush.metadataRevision`                           | Native requires a positive integer within Android `int` range and uses it for runtime push metadata revision.                        |
| `notification_channels.android_fcm.public_runtime_metadata.api_key`        | `androidPush.publicClientMetadata.apiKey`                | Used to initialize the deployment-scoped Firebase runtime.                                                                           |
| `notification_channels.android_fcm.public_runtime_metadata.project_id`     | `androidPush.publicClientMetadata.projectId`             | Used to initialize the deployment-scoped Firebase runtime.                                                                           |
| `notification_channels.android_fcm.public_runtime_metadata.application_id` | `androidPush.publicClientMetadata.applicationId`         | Used to initialize the deployment-scoped Firebase runtime.                                                                           |
| `notification_channels.android_fcm.public_runtime_metadata.sender_id`      | `androidPush.publicClientMetadata.senderId`              | Used to initialize the deployment-scoped Firebase runtime.                                                                           |

## Focused Contract Coverage

The schema contract is enforced by these Android bridge/runtime surfaces:

- `scripts/inject-native-auth-bridge.mjs`: runtime discovery validation,
  native persisted-bootstrap restore, `applyRuntimeBootstrap`, runtime reset,
  legacy browser-key invalidation, abstract push status/retry delegation, and
  the `SecPalNativeAuthBridge` runtime-bootstrap methods.
- `android/app/src/main/java/app/secpal/SecPalNativeAuthPlugin.java`:
  `getRuntimeInfo`, `confirmRuntimeBootstrap`, `getRuntimeBootstrap`,
  `confirmRuntimeReset`, `logout`, `request`, persisted bootstrap
  normalization, and runtime clear/apply helpers.
- `android/app/src/main/java/app/secpal/AndroidPushRuntimeMetadata.java`:
  Android FCM runtime metadata normalization and Firebase options mapping.
- `android/app/src/main/java/app/secpal/AndroidPushRuntimeManager.java`:
  deployment-scoped Firebase runtime apply/clear behavior and retained token
  callbacks.
- `android/app/src/main/java/app/secpal/AndroidPushIdentityStorage.java` and
  `AndroidPushRegistrationManager.java`: protected identity persistence,
  native schema-4 payload construction, idempotent rotation, retry, revocation,
  and runtime binding.
- `tests/native-auth-bridge-bootstrap.test.ts` and
  `android/app/src/test/java/app/secpal/SecPalNativeAuthPluginTest.java`:
  focused regression coverage proving the reduced JavaScript contract and
  native schema-4 registration after fresh setup and native restoration, plus
  schema-neutral persisted bootstrap normalization.

Legacy WebView push keys are invalidated unconditionally on packaged startup,
including when no runtime is configured. Their values are never read or passed
to a native bridge method. A fresh native FCM identity is authoritative after
the upgrade; obsolete server registrations become non-deliverable when the old
Firebase token is deleted or expires.
