<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
-->

# Android Runtime Bootstrap Contract

Audit date: 2026-07-24.

This contract defines the merged shared frontend runtime-discovery flow, the
Android native auth plugin, the injected WebView bridge, and persisted bootstrap
payloads. Schema `4` is the only supported Android runtime schema.

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
  starts.
- Android native plugin: `SecPalNativeAuthPlugin` exposes the Capacitor
  `SecPalNativeAuth` methods and persists the normalized bootstrap payload in
  `secpal_native_auth/runtime_bootstrap`.

## Canonical Schema

Frontend discovery accepts only bootstrap version `v1` with schema version `4`
encoded as a JSON integer. Every other schema value fails closed.

The injected bridge constructs every Android notification-registration
`runtime` object from its own `currentBootstrapSchemaVersion = 4` constant.
Native bootstrap persistence does not store a schema field, and restoration
normalizes persisted state to the fields listed below. Persisted or restored
runtime data therefore cannot select or override the registration schema.
Android also requires or persists no minimum app-version or app-build field;
frontend discovery has already accepted the only supported schema before
applying the native runtime payload.

## Distribution Integrity

Stable and Beta artifacts must embed the canonical schema-4 bridge before their
metadata advertises `release_available: true`. The signed APK and AAB build
lanes inspect only the artifact-type-specific packaged WebView runtime, reject
missing, duplicate, or conflicting APK/AAB index locations, and fail closed
unless the executable bridge contains exactly one integer schema-4 constant
and one notification-registration assignment sourced from that constant. This
schema assertion is independent of the injector source used for the final
canonical byte comparison.

An artifact that emits any other runtime schema is unsupported and must not
remain available as an Android release. It must be replaced or withdrawn rather
than accepted by frontend discovery or API notification registration.

## Required Native Methods

| Frontend-required method                                          | Android implementation                                                                                                                                                                                          | Keep rationale                                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SecPalNativeAuthBridge.getRuntimeInfo()`                         | Injected bridge delegates to `SecPalNativeAuth.getRuntimeInfo()`, which returns `clientPlatform`, `appVersion`, and `appBuild`.                                                                                 | Required before discovery so the frontend can call `/v1/bootstrap?client_platform=android&app_version=...&app_build=...`.                |
| `SecPalNativeAuthBridge.getRuntimeBootstrap()`                    | Injected bridge delegates to `SecPalNativeAuth.getRuntimeBootstrap()`, which returns `{ configured: false }` or `{ configured: true, bootstrap }`.                                                              | Required on startup so the merged frontend can restore an already selected runtime without reopening discovery.                          |
| `SecPalNativeAuthBridge.setRuntimeBootstrap(bootstrap)`           | Injected bridge applies runtime state and delegates persistence to `SecPalNativeAuth.setRuntimeBootstrap(...)`.                                                                                                 | Required after discovery confirmation; the frontend fails closed when the bridge exists but this method is absent.                       |
| `SecPalNativeAuthBridge.clearRuntimeBootstrap()`                  | Injected bridge clears persisted bootstrap state through `SecPalNativeAuth.clearRuntimeBootstrap()`, clears tenant-scoped browser state, resets injected runtime state, and clears retained Android push state. | Required when the frontend clears an invalid, incompatible, or user-reset runtime without carrying customer storage back into discovery. |
| `SecPalNativeAuthBridge.logout()` and `SecPalNativeAuth.logout()` | Injected bridge revokes Android push registration, calls native logout, clears push sync state, and dispatches `secpal:native-auth-logout` after successful native logout.                                      | Required so runtime reset and shared logout flows clear frontend auth state after native token teardown.                                 |
| `SecPalNativeAuthBridge.request(...)`                             | Injected bridge routes authenticated `/v1/...` requests to `SecPalNativeAuth.request(...)`.                                                                                                                     | Required by Android push registration and revocation flows that must not expose bearer tokens to JavaScript.                             |
| `SecPalNativeAuthBridge.getAndroidPushRegistrationState()`        | Injected bridge returns the Android push registration disablement state.                                                                                                                                        | Required so frontend-visible Android push state remains recoverable when secure UUID generation is unavailable.                          |

## Runtime Behavior

- Startup restore reads only the structured native runtime-bootstrap payload
  through `SecPalNativeAuthBridge.getRuntimeBootstrap()` and normalizes it
  without a schema field.
- Discovery confirmation applies only through
  `SecPalNativeAuthBridge.setRuntimeBootstrap(...)`.
- Runtime clearing through the public bridge method and the in-page reset flow
  both clear native bootstrap persistence, tenant-scoped browser storage,
  injected runtime state, and retained Android push state before discovery
  resumes.
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
  Android push registration/revocation, and the `SecPalNativeAuthBridge`
  runtime-bootstrap methods.
- `android/app/src/main/java/app/secpal/SecPalNativeAuthPlugin.java`:
  `getRuntimeInfo`, `setRuntimeBootstrap`, `getRuntimeBootstrap`,
  `clearRuntimeBootstrap`, `logout`, `request`, persisted bootstrap
  normalization, and runtime clear/apply helpers.
- `android/app/src/main/java/app/secpal/AndroidPushRuntimeMetadata.java`:
  Android FCM runtime metadata normalization and Firebase options mapping.
- `android/app/src/main/java/app/secpal/AndroidPushRuntimeManager.java`:
  deployment-scoped Firebase runtime apply/clear behavior and retained token
  callbacks.
- `tests/native-auth-bridge-bootstrap.test.ts` and
  `android/app/src/test/java/app/secpal/SecPalNativeAuthPluginTest.java`:
  focused regression coverage proving canonical schema-4 registration after
  fresh setup and native restoration, plus schema-neutral persisted payload
  normalization.
