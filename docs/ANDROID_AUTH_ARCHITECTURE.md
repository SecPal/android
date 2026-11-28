<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Authentication Architecture

## Current native boundary

The Android shell runs the shared frontend in its packaged WebView.
[Native authentication](../android/app/src/main/java/app/secpal/SecPalNativeAuthPlugin.java)
keeps bearer credentials in [Keystore-backed storage](../android/app/src/main/java/app/secpal/KeystoreTokenStorage.java).
The bridge carries sanitized authentication state and permitted results.
Bearer credentials stay out of WebView JavaScript, its storage and diagnostic
output. The [native request policy](../android/app/src/main/java/app/secpal/NativeAuthRequestPolicy.java)
limits authenticated requests to the selected HTTPS deployment and allowed
operations. Native bearer requests do not follow redirects or fall back
to browser session authentication.

Keep the packaged CSP and narrow bridge. `Capacitor.isPluginAvailable("SystemBars")` returns
`false` because SystemBars is retained for native lifecycle handling. The
frontend can contain web-only JavaScript proxies without native counterparts.
The `/_capacitor_http_interceptor_` route is also rejected.

Use the [runtime bootstrap contract](ANDROID_RUNTIME_BOOTSTRAP_CONTRACT.md) for
deployment binding and the [OpenAPI contract](https://github.com/SecPal/contracts/blob/main/docs/openapi.yaml)
for HTTP requests. The [API routes](https://github.com/SecPal/api/blob/main/routes/api.php) own server behavior.
See the [API session guide](https://github.com/SecPal/api/blob/main/docs/guides/sanctum-spa-auth.md)
for browser/PWA sessions.

Passkey sign-in and registration require Android 14 (API 34) or later.
On Android API 24 through 33, password sign-in remains available where tenant policy allows.
On API 24 through 33 the native capability reports passkeys unavailable.
Apply tenant policy when presenting a compatible sign-in method.

## Accepted target

[ADR-026](https://github.com/SecPal/.github/blob/main/docs/adr/20261002-client-trust-offline-recovery-adr026.md)
defines the target for USER and WORK, endpoint trust, offline authorization and
recovery. The current implementation and its evidence are described in
[Android Enterprise capabilities](ANDROID_ENTERPRISE_CAPABILITIES.md).
Bridge and membership implementation remains tracked in [#404](https://github.com/SecPal/android/issues/404),
[#405](https://github.com/SecPal/android/issues/405) and
[#907](https://github.com/SecPal/android/issues/907).

## Certificate Transparency

Release transport requires HTTPS, system trust anchors and platform chain and
hostname validation. Android 16 (API 36) and later apply Certificate Transparency
(CT) to all remote HTTPS destinations, including the discovery URL and any
different canonical API origin from bootstrap. API 24 through 35 uses HTTPS
with the system trust store. The API 37 policy also suppresses the platform's
implicit localhost exception. Source and device verification live in the
[release resource verifier](../scripts/verify-android-network-security.mjs) and
[CT workflow](../.github/workflows/android-certificate-transparency.yml). Keep
compiling with SDK 36 or newer for the regression API. The explicit opt-in
also applies when targeting SDK 35, so target SDK 35 remains valid.

Android supplies the CT policy and log list. Its platform check is inactive
when the log list is missing or older than 70 days. The live probe first
checks that the device requires CT for the origin and has a current log list.
See the [Android CT policy](https://developer.android.com/privacy-and-security/certificate-transparency-policy)
and [platform configuration](https://developer.android.com/privacy-and-security/security-config#CertificateTransparency).

### Certificate Transparency operations

The [scheduled workflow](../.github/workflows/android-certificate-transparency.yml)
probes the SecPal reference origin on API 36 and 37. Run the same check after
issuance, renewal, key rotation or a change to the CA or served chain. Require
a passing result before promotion. Customer operators need the same check
for the exact certificate and chain on their discovery origin and any separate
canonical API origin. Retain continuous CT probes and normal expiry, DNS, TLS
and endpoint monitoring. The reference probe covers the tested origin.

Dispatch the workflow once for each affected public HTTPS URL:

```shell
gh workflow run android-certificate-transparency.yml \
  --ref main \
  -f probe_url=https://customer.example/
```

An attached API 36 test device can run the packaged-app probe for one origin.
Use a development host with `jq` and an authorized test device with a readable
CT log list. Run the whole block from the repository root:

```shell
(
  set -e
  device_serial=DEVICE_SERIAL
  probe_url=https://customer.example/
  log_list="$(
    bash ./scripts/with-android-env.sh adb -s "$device_serial" \
      shell cat /data/misc/keychain/ct/v2/current/log_list.json
  )"
  now_timestamp_ms=$(( $(date +%s) * 1000 ))
  minimum_timestamp_ms=$(( now_timestamp_ms - 70 * 24 * 60 * 60 * 1000 ))
  jq -e \
    --argjson minimum "$minimum_timestamp_ms" \
    --argjson maximum "$now_timestamp_ms" \
    '(.version | type == "string") and
    (.log_list_timestamp | type == "number") and
    (.log_list_timestamp >= $minimum) and
    (.log_list_timestamp <= $maximum) and
    (.operators | type == "array" and length > 0) and
    all(.operators[];
      (.name | type == "string") and
      (.logs | type == "array")) and
    ([.operators[].logs[]] | length > 0)' \
    <<<"$log_list" >/dev/null
  (
    cd android
    ANDROID_SERIAL="$device_serial" ./gradlew \
      :app:connectedCtRegressionAndroidTest \
      "-Pandroid.testInstrumentationRunnerArguments.class=app.secpal.CertificateTransparencyInstrumentedTest#apiEndpointPassesThePlatformCertificateTransparencyPolicy" \
      -Pandroid.testInstrumentationRunnerArguments.secpalLiveCtProbe=true \
      "-Pandroid.testInstrumentationRunnerArguments.secpalLiveCtProbeUrl=$probe_url"
  )
)
```

For a failed probe, distinguish runner or log-list availability from a
reproducible handshake failure. Freeze the certificate rollout, then restore a
still-valid CT-compliant certificate and complete chain or reissue through an
appropriate CA. Re-run the live probe and API health checks, retain incident
evidence and correct renewal automation before the next rollout.

The policy for published clients is packaged in their APK. Recover the
served chain on the server. Keep system trust, hostname verification and native
origin binding intact. Release recovery must never add user-installed CAs,
emergency roots, trust-all TLS, debug overrides or a fallback deployment.
