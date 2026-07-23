<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
-->

# Android Runtime Bootstrap Contract

Audit date: 2026-07-09.

This contract compares the merged shared frontend runtime-discovery flow with
the Android native auth plugin, injected WebView bridge, and persisted bootstrap
payloads. The Android code listed below is still required by the merged
frontend behavior and must be kept while the shared flow depends on it.

## Source Surfaces

- Frontend facade:
  [`SecPalRuntimeBootstrap`](https://github.com/SecPal/frontend/blob/main/src/native/SecPalRuntimeBootstrap.ts)
  maps canonical bootstrap JSON onto `globalThis.SecPalNativeAuthBridge`.
- Frontend discovery:
  [`discoverAndroidRuntimeBootstrap`](https://github.com/SecPal/frontend/blob/main/src/services/runtimeDiscovery.ts)
  calls `GET /v1/bootstrap` with Android runtime metadata and validates
  bootstrap version `v1`, prefers schema version `4`, and accepts schema version
  `3` during the coordinated rollout window.
- Android injected bridge:
  [`scripts/inject-native-auth-bridge.mjs`](https://github.com/SecPal/android/blob/main/scripts/inject-native-auth-bridge.mjs)
  installs `globalThis.SecPalNativeAuthBridge` before the shared frontend
  starts.
- Android native plugin: `SecPalNativeAuthPlugin` exposes the Capacitor
  `SecPalNativeAuth` methods and persists the normalized bootstrap payload in
  `secpal_native_auth/runtime_bootstrap`.

## Schema 4 Rollout

1. Deploy the API revision that emits bootstrap schema `4`, accepts notification
   registrations from schemas `3` and `4`, and sets
   `minimum_supported_app_build` to the first compatible Android release.
2. Release the Android app with the shared frontend that accepts schemas `3`
   and `4`; its injected bridge submits schema `4` for notification
   registrations.
3. Existing configured clients may continue restoring their persisted runtime
   and registering with schema `3`. Older unconfigured builds receive the
   existing update-required response before parsing the removed bootstrap
   fields.

## Native Methods To Keep

| Frontend-required method                                          | Android implementation                                                                                                                                                                                          | Keep rationale                                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SecPalNativeAuthBridge.getRuntimeInfo()`                         | Injected bridge delegates to `SecPalNativeAuth.getRuntimeInfo()`, which returns `clientPlatform`, `appVersion`, and `appBuild`.                                                                                 | Required before discovery so the frontend can call `/v1/bootstrap?client_platform=android&app_version=...&app_build=...`.                |
| `SecPalNativeAuthBridge.getRuntimeBootstrap()`                    | Injected bridge delegates to `SecPalNativeAuth.getRuntimeBootstrap()`, which returns `{ configured: false }` or `{ configured: true, bootstrap }`.                                                              | Required on startup so the merged frontend can restore an already selected runtime without reopening discovery.                          |
| `SecPalNativeAuthBridge.setRuntimeBootstrap(bootstrap)`           | Injected bridge applies runtime state and delegates persistence to `SecPalNativeAuth.setRuntimeBootstrap(...)`.                                                                                                 | Required after discovery confirmation; the frontend fails closed when the bridge exists but this method is absent.                       |
| `SecPalNativeAuthBridge.clearRuntimeBootstrap()`                  | Injected bridge clears persisted bootstrap state through `SecPalNativeAuth.clearRuntimeBootstrap()`, clears tenant-scoped browser state, resets injected runtime state, and clears retained Android push state. | Required when the frontend clears an invalid, incompatible, or user-reset runtime without carrying customer storage back into discovery. |
| `SecPalNativeAuthBridge.logout()` and `SecPalNativeAuth.logout()` | Injected bridge revokes Android push registration, calls native logout, clears push sync state, and dispatches `secpal:native-auth-logout` after successful native logout.                                      | Required so runtime reset and shared logout flows clear frontend auth state after native token teardown.                                 |
| `SecPalNativeAuthBridge.request(...)`                             | Injected bridge routes authenticated `/v1/...` requests to `SecPalNativeAuth.request(...)`.                                                                                                                     | Required by Android push registration and revocation flows that must not expose bearer tokens to JavaScript.                             |
| `SecPalNativeAuthBridge.getAndroidPushRegistrationState()`        | Injected bridge returns the Android push registration disablement state.                                                                                                                                        | Required so frontend-visible Android push state remains recoverable when secure UUID generation is unavailable.                          |

The legacy direct injected fallback to `SecPalNativeAuth.setApiBaseUrl(...)`
and session-storage bootstrap persistence is not part of the merged frontend
facade contract and has been removed from the injected bridge. Runtime
confirmation now fails closed when `setRuntimeBootstrap(...)` is unavailable.

## Final Runtime Behavior

- Startup restore reads only the structured native runtime-bootstrap payload
  through `SecPalNativeAuthBridge.getRuntimeBootstrap()`. Legacy
  `apiOrigin`-only state and JavaScript session-storage bootstrap state do not
  restore a configured runtime.
- Discovery confirmation applies only through
  `SecPalNativeAuthBridge.setRuntimeBootstrap(...)`. The injected bridge no
  longer confirms deployments by calling `SecPalNativeAuth.setApiBaseUrl(...)`
  or by writing a browser-owned bootstrap fallback.
- Runtime clearing through the public bridge method and the in-page reset flow
  both clear native bootstrap persistence, tenant-scoped browser storage,
  injected runtime state, and retained Android push state before discovery
  resumes.
- The baked-in Android resource value is a placeholder guardrail for native
  code paths that run before runtime binding. It is not a deployable fallback
  origin for login, authenticated requests, bootstrap restore, or push
  registration.

## Bootstrap Payload Mapping

| Canonical frontend bootstrap field                                         | Android applied field                                    | Android behavior                                                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `api_base_url`                                                             | `rawApiBaseUrl`; `apiOrigin` is derived from its origin. | Native normalizes to a bare HTTPS origin, accepts either the origin or `/v1`, and rejects userinfo, query, fragment, or other paths. |
| `instance.display_name`                                                    | `instanceDisplayName`                                    | Persisted and returned to the bridge so runtime reset UI and restored state can show the configured instance.                        |
| `compatibility.bootstrap_version`                                          | Validation-only                                          | Frontend discovery requires `v1`; Android receives the already-applied payload and does not persist this field separately.           |
| `compatibility.schema_version`                                             | Validation-only                                          | Frontend discovery accepts schema versions `3` and `4` during the rollout window; Android push registration emits schema `4`.        |
| `compatibility.minimum_supported_app_version`                              | `minimumSupportedAppVersion`                             | Native requires and persists this string in the bootstrap payload.                                                                   |
| `compatibility.minimum_supported_app_build`                                | `minimumSupportedAppBuild`                               | Native requires a positive integer before persisting the bootstrap payload.                                                          |
| `features.password_login`                                                  | `features.passwordLoginEnabled`                          | Native normalizes and persists this flag for restored bridge state.                                                                  |
| `features.passkey_login`                                                   | `features.passkeyLoginEnabled`                           | Native normalizes and persists this flag for restored bridge state.                                                                  |
| `features.notification_channels.android_fcm`                               | Controls whether `androidPush` is present.               | If Android FCM is disabled, native persists no Android push runtime metadata and clears the runtime Firebase app.                    |
| `notification_channels.android_fcm.channel`                                | `androidPush.provider`                                   | Frontend maps `android_fcm` to native provider `fcm`; native rejects any other provider.                                             |
| `notification_channels.android_fcm.metadata_revision`                      | `androidPush.metadataRevision`                           | Native requires a positive integer within Android `int` range and uses it for runtime push metadata revision.                        |
| `notification_channels.android_fcm.public_runtime_metadata.api_key`        | `androidPush.publicClientMetadata.apiKey`                | Used to initialize the deployment-scoped Firebase runtime.                                                                           |
| `notification_channels.android_fcm.public_runtime_metadata.project_id`     | `androidPush.publicClientMetadata.projectId`             | Used to initialize the deployment-scoped Firebase runtime.                                                                           |
| `notification_channels.android_fcm.public_runtime_metadata.application_id` | `androidPush.publicClientMetadata.applicationId`         | Used to initialize the deployment-scoped Firebase runtime.                                                                           |
| `notification_channels.android_fcm.public_runtime_metadata.sender_id`      | `androidPush.publicClientMetadata.senderId`              | Used to initialize the deployment-scoped Firebase runtime.                                                                           |

## Keep Markers

The following Android bridge/runtime code is explicitly in scope to keep:

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
  focused regression coverage for the bridge contract and native payload
  normalization.

Code outside this keep list should not be retained solely for runtime
bootstrap compatibility unless a live caller is proven.
