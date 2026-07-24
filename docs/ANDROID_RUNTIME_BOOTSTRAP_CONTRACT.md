<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
-->

# Android Runtime Bootstrap Contract

Audit date: 2026-07-24.

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

## Schema-4-Only Support Floor

The retirement gate is **not satisfied as of 2026-07-24**. Commit
[`07363402a701652b18d4cf71b0d074da202b65be`](https://github.com/SecPal/android/commit/07363402a701652b18d4cf71b0d074da202b65be)
is the first Android source revision whose authenticated notification
registration uses strict integer schema `4`, but no published public Stable or
Beta artifact contains that commit yet. API and frontend schema-3 notification
compatibility must remain in place until every step in the operator sequence
below passes.

### Verified Direct-Channel Evidence

The public Stable and Beta metadata endpoints advertise the two currently
available pre-production direct-download releases. The operator confirmed that
neither was ever used productively. Both APKs were downloaded and inspected
during this audit; their injected `assets/public/index.html` contains
`currentBootstrapSchemaVersion = 3`.

| Channel | Version | Build       | Published at           | APK SHA-256                                                        | Registration schema |
| ------- | ------- | ----------- | ---------------------- | ------------------------------------------------------------------ | ------------------- |
| Stable  | `0.0.1` | `261932118` | `2026-07-12T21:25:04Z` | `60f11c0fa9569e9a79efd61b189f75da88ac939e263e6e9e100271962d57be27` | `3`                 |
| Beta    | `0.0.1` | `261932119` | `2026-07-12T21:32:32Z` | `f1fefbfaf1c6ea8429577d06a7c73cacc6e30d081305aed3e8ed77a5df5a612c` | `3`                 |

The corresponding immutable metadata records are:

- `https://apk.secpal.app/android/releases/0.0.1-261932118/metadata.json`
- `https://apk.secpal.app/android/releases/0.0.1-261932119/metadata.json`

The repository has no Git tag or GitHub Release for either artifact. These
records prove the two current Direct-channel releases only. The operator
confirmed that no earlier Direct or Play test artifact was productively
deployed and that the retired test APKs no longer exist. Retired artifacts are
therefore classified conservatively from their release date and known source
history rather than requiring unavailable binaries.

### Google Play Internal-Track Evidence

The Play Console track summary supplied by the operator on `2026-07-24` shows
that only Internal testing is in use; there are no Alpha, Beta, or Production
tracks. Its release history contains the following releases:

| State    | Version | Build        | Released           | Registration classification |
| -------- | ------- | ------------ | ------------------ | --------------------------- |
| Active   | `0.0.1` | Not shown    | `2026-07-12 23:39` | Schema-3-capable            |
| Replaced | `0.0.1` | `2026062802` | `2026-06-28 01:24` | Schema-3-capable            |
| Replaced | `0.0.1` | `2026062801` | `2026-06-28 01:08` | Schema-3-capable            |
| Replaced | `0.0.1` | `2`          | `2026-04-06 21:16` | Schema-3-capable            |

The displayed Play Console times do not include a timezone in the supplied
summary and are preserved as displayed. All four releases predate
schema-4 commit
[`07363402a701652b18d4cf71b0d074da202b65be`](https://github.com/SecPal/android/commit/07363402a701652b18d4cf71b0d074da202b65be),
authored on `2026-07-23T21:29:37+02:00`. They therefore remain classified as
schema-3-capable for support-floor selection. None was productively used, and
the retired test artifacts are no longer retained. The active release's version
code must be recorded from the Play API result used by Fastlane before it is
replaced; the supplied release-history summary establishes that it has one
version code but does not display the value.

Native persistence deliberately normalizes restored bootstrap state without a
schema field. The injected bridge constructs every authenticated notification
registration from its own numeric schema constant. Focused Vitest coverage
proves both a fresh registration and an upgraded installation restoring
schema-3-marked runtime state emit integer `4`; focused JUnit coverage proves
legacy `schemaVersion` and `schema_version` fields do not survive native
bootstrap restoration.

### Release Inventory And Floor Selection

Before selecting a production floor, record every Android release that remains
installable by a supported user. Historical pre-production artifacts that were
never productively used and no longer exist do not require reconstructed APK or
AAB checksums. Their version/build history must still be listed where available
and conservatively classified as schema-3-capable.

For the current Play inventory, Alpha, Beta, and Production are confirmed
absent. Internal is the only track. Before replacing its active legacy release,
record the version code returned by the Play API query that Fastlane uses to
choose a strictly higher build. This supplies the missing release identity
without requiring an unavailable retired artifact.

Do not reserve a build number in advance. Fastlane derives the next valid build
from the local release baseline, both Direct channels, and Google Play tracks;
an explicit lower or reused build is rejected. Record the actual Beta and
Stable version/build values only after their release lanes complete.

The production floor must use the first newly released and verified schema-4
release's exact version name and version code. Because every known legacy test
release uses version `0.0.1`, the clean release must use a newer version name
and a Fastlane-generated build greater than every Direct and Internal build.
This also avoids relying on build comparison across different version names in
the API comparator.

After the new schema-4 artifact is verified, replace the values below with its
actual release identity before deploying the API configuration:

```dotenv
BOOTSTRAP_MINIMUM_SUPPORTED_APP_VERSION=<verified-schema-4-version-name>
BOOTSTRAP_MINIMUM_SUPPORTED_APP_BUILD=<verified-schema-4-version-code>
```

### Operator Sequence

1. Keep the API accepting notification registration schemas `3` and `4`, and
   keep the frontend accepting bootstrap schema `3`.
2. Record that all legacy releases were pre-production only, list the known
   Direct and Internal identities above, and capture the active Internal version
   code from Fastlane's Play API query. No retired binary reconstruction is
   required.
3. Publish the first schema-4 artifact under a version newer than `0.0.1`
   through the existing Beta lane, allowing Fastlane to select a new valid
   build. Confirm that only `/android/beta/` advances; Stable and `/android/`
   aliases must not change.
4. Record the exact Beta version, build, checksum, and source commit. Verify its
   downloaded APK before testing it:

   ```bash
   npm run native:verify:schema4-release -- \
     --apk /path/to/app.secpal-release.apk \
     --version-name <actual-version-name> \
     --version-code <actual-version-code> \
     --sha256 <immutable-apk-sha256>
   ```

   The command inspects the APK manifest, SHA-256, and embedded bridge script;
   it rejects schema `3`, string schema values, and mismatched version/build
   evidence. Upgrade a schema-3 installation with an already persisted runtime,
   then capture the authenticated notification request and confirm
   `runtime.schema_version` is the JSON integer `4`.

5. Publish the verified source revision through the existing Stable lane, again
   allowing Fastlane to select a valid build. Confirm `/android/stable/` and the
   `/android/` Stable aliases advance while `/android/beta/` is unchanged.
6. Record and run the same APK verification, fresh-install, and restored-install
   checks against the Stable artifact. Confirm the selected API floor rejects
   version `0.0.1` and therefore excludes all legacy schema-3 test releases
   under the API's version/build comparator.
7. Set the actual production API environment values above and deploy the
   configuration. Verify the first eligible build returns HTTP `200` and the
   exact configured floor:

   ```bash
   curl --fail \
     'https://api.secpal.dev/v1/bootstrap?client_platform=android&app_version=<verified-schema-4-version-name>&app_build=<verified-schema-4-version-code>'
   ```

   The response must contain
   `data.compatibility.minimum_supported_app_version` and
   `data.compatibility.minimum_supported_app_build` must equal the selected
   floor.

8. Verify representative legacy version `0.0.1` requests, including the known
   Direct and Internal build values, receive HTTP `426` with
   `code = "UNSUPPORTED_CLIENT_VERSION"` and the same minimum version/build.
9. Only after steps 1-8 pass may the parent retirement work consider removing
   API or frontend schema-3 compatibility. Stable/Beta routing and alias
   semantics remain unchanged throughout this sequence.

At the audit time, the production bootstrap request returned HTTP `503` with
`code = "BOOTSTRAP_CONFIG_UNAVAILABLE"`. That is deployment evidence that the
required production floor is not yet verifiable, not permission to advance the
schema-3 retirement.

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
