<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Android runtime bootstrap

The Android shell binds native authentication and push to the canonical HTTPS
API origin confirmed by the user. The
[shared frontend discovery flow](https://github.com/SecPal/frontend/blob/main/src/services/runtimeDiscovery.ts)
calls bootstrap and requires strict integer schema `4`. The
[OpenAPI contract](https://github.com/SecPal/contracts/blob/main/docs/openapi.yaml)
defines the HTTP payloads and notification installation API. Deployment owns
the instance's [runtime configuration](https://github.com/SecPal/deployment/blob/main/docs/product-backends.md).

## Native runtime and push

The [native auth plugin](../android/app/src/main/java/app/secpal/SecPalNativeAuthPlugin.java)
validates, confirms and persists the selected origin and normalized bootstrap
state. Android restore uses that native state. Persisted data cannot choose
the notification schema. The [packaged bridge](../scripts/inject-native-auth-bridge.mjs)
emits schema `4` for Android registrations. See the
[frontend facade](https://github.com/SecPal/frontend/blob/main/src/native/SecPalRuntimeBootstrap.ts)
for the shared UI boundary.

A switch or reset requires native confirmation. An origin change retires the
old credentials. A reset that does not commit preserves the configured origin
and frontend tenant state. Startup can finish local teardown after an
interrupted successful native reset. Server-side revocation uses the confirmed
origin. See [runtime and bridge tests](../tests/native-auth-bridge-bootstrap.test.ts)
and the [credential boundary](ANDROID_AUTH_ARCHITECTURE.md).

The [native FCM runtime](../android/app/src/main/java/app/secpal/AndroidPushRuntimeManager.java)
uses push metadata from the confirmed deployment. Registration and revocation
stay bound to that deployment. The presence of the runtime and these source
tests establishes the implemented path. Release-like and device qualification
is tracked in [#601](https://github.com/SecPal/android/issues/601).
[ADR-026](https://github.com/SecPal/.github/blob/main/docs/adr/20261002-client-trust-offline-recovery-adr026.md)
defines the accepted target for client identity, endpoint trust and offline
authorization. Bridge implementation work continues under
[#404](https://github.com/SecPal/android/issues/404) and
[#405](https://github.com/SecPal/android/issues/405).

## Release compatibility

Stable and Beta artifacts must embed the canonical schema-4 bridge.
The [packaging guard](../scripts/verify-android-packaging-guard.sh) and
[runtime-schema verifier](../scripts/verify-android-runtime-schema.mjs) check
packaged APK and AAB content. An artifact with a different schema must not
remain available as an Android release. Follow the
[distribution procedure](ANDROID_RELEASE_DISTRIBUTION.md) for signing, version
identity, qualification and publication.
