<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: CC0-1.0
-->

# Android Authentication Architecture

**Status:** Target architecture and mandatory direction for all future Android auth work.

## Purpose

SecPal uses one shared React UI codebase across web and Android, but authentication is intentionally **not** shared end to end.

- **Web / PWA:** Laravel Sanctum SPA mode with httpOnly session cookies and CSRF.
- **Android app:** Bearer-token authentication with native token storage and native request handling.

This separation is deliberate. The Android app exists to provide native security boundaries, secure local storage, and device capabilities that a pure browser or TWA-style wrapper cannot guarantee.

## Non-Negotiable Rules

1. Android must **not** authenticate through `POST /v1/auth/login`.
2. Android must **not** depend on `/sanctum/csrf-cookie`, session cookies, or browser-style cookie auth.
3. Android must authenticate via `POST /v1/auth/token` and use `Authorization: Bearer <token>` for authenticated API requests.
4. Android bearer tokens must be stored only in Android-native secure storage backed by the Android Keystore.
5. Bearer tokens must never be persisted in JavaScript-accessible storage.

Forbidden storage and exposure paths:

- `localStorage`
- `sessionStorage`
- `IndexedDB`
- `document.cookie`
- Capacitor `Preferences`
- query parameters
- logs, crash reports, analytics payloads, clipboard, or screenshots

## Architecture Boundary

### Shared UI

The Android app continues to embed the shared web UI from `../frontend/dist` inside the Capacitor WebView.

At packaging time, the Android wrapper injects a small bootstrap script into the built `index.html` so the shared UI sees the native auth facade from its first render. This keeps the React source tree browser-oriented while ensuring the Android WebView does not boot into the browser-session auth path.

The shared UI is responsible for:

- rendering screens
- collecting user input
- presenting authenticated state
- rendering API results

The shared UI is **not** the owner of Android authentication secrets.

### Native Android Auth Layer

Android authentication must be implemented in a native boundary with four responsibilities:

1. **Native Auth Adapter**
   - accepts login requests from the WebView
   - calls `POST /v1/auth/token`
   - normalizes auth failures for the UI

2. **Secure Token Store**
   - stores the bearer token in Keystore-backed encrypted storage
   - exposes read, write, rotate, and delete operations only to native code

3. **Native Authenticated API Client**
   - attaches the `Authorization` header for protected requests
   - owns retry, token-expiry handling, and logout cleanup

4. **WebView Bridge**
   - exposes only sanitized auth state and operation results to the shared UI
   - never returns the raw bearer token to JavaScript

## Request Flows

### Login

1. User enters credentials in the shared UI.
2. The UI submits the credentials to the native auth adapter.
3. The native auth adapter calls `POST /v1/auth/token`.
4. The native layer stores the returned bearer token in secure storage.
5. The native layer calls `GET /v1/me` with the bearer token.
6. The native layer returns sanitized user/session state to the UI.

### Authenticated API Calls

1. The shared UI requests a protected operation.
2. The WebView bridge hands the request to the native authenticated API client.
3. The native client loads the token from secure storage.
4. The native client sends the request with `Authorization: Bearer <token>`.
5. The response is normalized and returned to the UI.

For the current Android implementation, the wrapper bootstrap also patches authenticated `/v1/` fetch traffic in the WebView so the shared UI can keep using its existing service modules while protected requests are executed natively instead of through browser cookies.

### Logout

1. The shared UI requests logout.
2. The native layer calls the canonical logout endpoint for token clients.
3. The native layer deletes the bearer token from secure storage.
4. The native layer clears any cached authenticated state.
5. The UI is reset to the logged-out state.

## Production Security Requirements

The Android implementation must be production-first from the start.

Required security properties:

- token storage backed by the Android Keystore
- device-specific token naming for revocation and auditability
- no bearer token visibility in WebView JavaScript
- explicit logout and token revocation path
- clear handling for expired or revoked tokens
- no silent fallback from native bearer auth to browser session auth
- no auth shortcuts that rely on WebView cookies

### Capacitor Core Plugin Boundary

The packaged Android bridge does not register Capacitor's `CapacitorHttp`,
`CapacitorCookies`, or `WebView` core plugins. Neither the Android wrapper nor
the shared frontend has a live caller for arbitrary native HTTP, WebView cookie
mutation, or runtime server-base-path mutation. Android authenticated requests
remain confined to the SecPal native auth plugin and its allowlisted API
contract.

Capacitor's same-origin `/_capacitor_http_interceptor_` route is also rejected
with a local `403 Forbidden` response before it can open the target URL. This
closes the native `HttpURLConnection` path independently of plugin registration
or the framework's automatic fetch-patching configuration.

SystemBars remains registered internally only for its native lifecycle
initialization, safe-area CSS, and inset handling. It is omitted from generated
native plugin headers, `Capacitor.isPluginAvailable("SystemBars")` returns
`false`, and the native dispatcher rejects raw SystemBars calls before resolving
the plugin handle. The shared frontend bundle can still contain Capacitor's
web-only JavaScript proxies for core plugins; those proxies are not evidence of
native availability. Its own
`setStyle`, `show`, `hide`, and `setAnimation` annotations are also removed as
defense in depth.

Capacitor does not currently provide a supported host configuration for
excluding individual Android core plugins. The repository therefore applies an
exact, fail-closed source transformation through
`scripts/patch-capacitor-android-unchecked.mjs` during `postinstall`,
`cap:sync`, and `cap:add:android`. A Capacitor upgrade must preserve or
deliberately update that transformation, run the focused patch/static tests,
assemble the debug app, and inspect the packaged WebView regression test. If
the upstream registration, native HTTP interceptor, export, dispatch, or
SystemBars method shape changes, install or sync must fail instead of accepting
the new bridge surface.

SecPal/android issue #422 tracks a supported upstream exclusion mechanism and
the eventual removal of these source transformations.

Recommended hardening:

- biometric or device-credential gate before revealing highly sensitive data
- minimized token lifetime with documented renewal behavior
- central handling for `401` and revoked-device states
- redaction of auth-sensitive values from crash and telemetry output

### Transport Trust Policy

Android release networking remains HTTPS-only. The application manifest and
Network Security Configuration both prohibit cleartext traffic, and the native
HTTP client rejects a non-HTTPS API origin before opening a connection. The
Cordova access allowlist remains restricted to the first-party HTTPS API and
frontend origins.

TLS connections use only the Android system trust store. Android performs the
normal X.509 certificate-chain and hostname validation; release builds do not
add trust for user-installed CAs and have no debug trust override. This
system-PKI policy trusts the public CAs accepted by the Android platform and
therefore does not prevent every possible CA compromise or mis-issuance.

SecPal removed app-level static SPKI pinning after a legitimate certificate
change locked a signed client out of a correctly configured API. The previous
pins had no documented provenance, separately controlled backup key,
certificate-renewal integration, or auditable rotation and recovery process.
A source test that preserves literal hashes cannot prove live connectivity
across future certificate changes.

Static pinning must not be reintroduced until an operational design provides
all of the following:

- documented pin provenance
- a fully controlled backup key
- certificate-renewal integration
- a planned overlap period
- live-chain monitoring
- client compatibility testing before certificate changes
- a recovery procedure for already published clients

### Certificate Transparency

SecPal enables Android's platform Certificate Transparency (CT) policy for all
remote HTTPS destinations on Android 16 (API 36) and later. This includes the
instance URL entered during runtime discovery, a different canonical
`api_base_url` returned by that instance, SecPal-operated endpoints, and any
other remote HTTPS host used by the generic app. Network Security Configuration
is packaged into the APK and cannot add a domain after installation, so a static
allowlist cannot cover customer API origins that are intentionally unknown at
build time.

The unqualified Network Security Configuration remains the API 24 through 35
fallback and does not contain the API-36-only element. A qualified `res/xml-v36`
configuration enables CT in its `base-config` while retaining cleartext
prohibition and system-only trust anchors. It must not contain a per-domain CT
opt-out. Android 17 would otherwise add an implicit localhost configuration
that permits loopback cleartext and disables CT. The `res/xml-v37`
configuration explicitly defines `localhost`, which suppresses that implicit
configuration for all loopback hosts; the explicit host and every other
loopback address then retain the inherited cleartext prohibition, global CT
policy, and system-only trust.

The project must continue compiling with SDK 36 or newer so the API 36
regression can call
`NetworkSecurityPolicy.isCertificateTransparencyVerificationRequired(...)`.
The explicit XML opt-in is not gated by the app's target SDK, so target SDK 35
remains valid. Android 16 disables CT by default but honors this opt-in; Android
15 and lower do not provide CT enforcement. Android platform source and CTS use
the same policy API to prove the effective per-host setting:

- [Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config#CertificateTransparency)
- [Android 16 Network Security Configuration parser](https://android.googlesource.com/platform/frameworks/base/+/android16-qpr2-release/packages/NetworkSecurityConfig/platform/src/android/security/net/config/XmlConfigSource.java)
- [Android CT Network Security Configuration platform regression](https://android.googlesource.com/platform/frameworks/base/+/android16-qpr2-release/tests/NetworkSecurityConfigTest/src/android/security/net/config/XmlConfigTests.java)

Device regressions install the `ctRegression` app variant on representative API
24, 29, 35, 36, and 37 stable emulators. That variant inherits release
minification, shrinking, dependencies, manifest policy, and resources, remains
non-debuggable, uses an isolated `.ctregression` application ID, and is signed
with the debug key only so the test runner can install it. It is not a
distributable release artifact. Its dedicated test-only manifest retains the
non-exported bridge-isolation activity required by instrumented tests but does
not register the exported debug enterprise-policy receiver. APIs below 36 must
load the fallback policy and reject cleartext. API 36 must report CT as required for both SecPal-operated
hosts and an arbitrary customer API hostname. API 37 must also prove that the
platform's implicit localhost cleartext exception is suppressed. The API 37
harness retries once only when Gradle reports either both a failed package
install commit and a broken PackageManager connection or an Android system
crash before the first instrumented test starts; policy assertions and all
other instrumentation failures remain fail-closed. The release-resource verifier
accepts the policy only from the canonical `xml`,
`xml-v36`, and `xml-v37` resource directories and parses decoded XML values. It
independently rejects a missing, disabled, or domain-scoped API 36 policy, any
CT element selectable below API 36, a missing API 37 localhost hardening
policy, configuration-qualified replacements, user or inline CAs, debug trust
overrides, cleartext, and certificate pins.

#### Certificate Transparency operations

CT adds a public auditability requirement on top of ordinary Android system-PKI
chain and hostname validation. It reduces exposure to publicly trusted
mis-issuance that was not logged correctly. It does not restrict the app to one
CA or key, so legitimate renewal, key rotation, and chain changes remain
possible without an app update. It also does not replace certificate expiry,
revocation, DNS, TLS, or endpoint monitoring.

The availability cost is deliberate: an otherwise trusted public certificate
on any destination that lacks enough acceptable Signed Certificate Timestamps
is rejected by published API 36 clients. Android evaluates SCT count, log state,
and distinct log operators under the current
[Android CT policy](https://developer.android.com/privacy-and-security/certificate-transparency-policy).
The platform disables enforcement if its downloaded log list is missing or more
than 70 days old; SecPal must not copy or independently enforce against that log
list.

Monitoring and certificate-lifecycle ownership have three layers:

1. The scheduled `Android Certificate Transparency` workflow performs a daily
   reference handshake to `https://api.secpal.dev/` from the packaged app on an
   API 36 Google APIs image. It first asserts that the global app policy requires
   CT and that the Android 16 compatibility-v2 log list has a structurally valid
   timestamp inside the platform's enforcement window. This proves the SecPal
   reference chain and test lane, not unknown customer chains.
2. SecPal's certificate-renewal process must run the reference workflow after
   every issuance, renewal, key rotation, CA change, or served-chain change.
   Deployment must not complete until it passes.
3. Customer operators must apply the equivalent gate to both the discovery URL
   given to users and any different canonical API origin returned by bootstrap.
   Their issuance and renewal automation must test the exact served certificate
   and complete chain with an API 36 SecPal build before promotion, then retain a
   continuous API 36 probe. Ordinary expiry, DNS, TLS, and endpoint checks remain
   required because a successful CT check does not cover those failure modes.

The workflow's manual `probe_url` input runs the same API 36 check against an
arbitrary public HTTPS URL. A SecPal operator can invoke it before a customer
certificate rollout with:

```shell
gh workflow run android-certificate-transparency.yml \
  --ref main \
  -f probe_url=https://customer.example/
```

For a directly attached API 36 test device, the equivalent repository-local
sequence first proves that the platform's compatibility-v2 log list is present
and inside the 70-day enforcement window, then runs the packaged-app probe.
`jq` must be available on the development host:

```shell
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
  ([.operators[].logs[]] | length > 0)' \
  <<<"$log_list" >/dev/null
(
  cd android
  ANDROID_SERIAL="$device_serial" ./gradlew \
    -Dcom.google.protobuf.use_unsafe_pre22_gencode=true \
    :app:connectedCtRegressionAndroidTest \
    "-Pandroid.testInstrumentationRunnerArguments.class=app.secpal.CertificateTransparencyInstrumentedTest#apiEndpointPassesThePlatformCertificateTransparencyPolicy" \
    -Pandroid.testInstrumentationRunnerArguments.secpalLiveCtProbe=true \
    "-Pandroid.testInstrumentationRunnerArguments.secpalLiveCtProbeUrl=$probe_url"
)
```

Both the discovery URL and a different canonical API origin require separate
probe runs. Customer renewal automation may request these workflow runs or
execute the same device command in its own controlled test lane. The scoped
protobuf property suppresses a warning from AGP's build-time-only Tink 1.7.0;
the CT regression pre-build fails if Tink or Google Play services FIDO reaches
the test app's runtime classpath, matching the release artifact prohibition.

The app's real discovery and API requests are the final enforcement point. A
customer origin that is system-trusted but not CT-compliant fails closed during
the TLS handshake; the app must not fall back to a fixed SecPal origin or a less
strict transport.

If a scheduled or renewal-triggered probe fails, SecPal or the responsible
customer operator first distinguishes runner or platform-log-list availability
from a reproducible API 36 handshake failure. For a real production failure:

1. freeze further certificate and chain rollout;
2. restore the last known CT-compliant certificate and complete served chain
   if it is still valid, or urgently reissue through a CA that supplies
   Android-policy-compliant SCTs;
3. verify the restored chain through the manual API 36 workflow and normal API
   health checks before ending the incident;
4. preserve incident evidence and correct the issuance/renewal guard before the
   next rollout.

Already published clients cannot receive a remotely changed Network Security
Configuration. Server-side restoration by SecPal or customer operators is
therefore the only immediate recovery for affected API 36 clients; an app update
that relaxes CT is not a timely primary recovery path. Release builds must never
add user-installed CAs, inline emergency roots, permissive hostname verifiers,
trust-all TLS code, debug overrides, or other TLS bypasses as recovery
mechanisms. Older supported clients keep the fallback system-PKI policy and are
not made dependent on the API 36 element.

## Prohibited Shortcuts

The following approaches are explicitly out of scope and must not be introduced:

- storing bearer tokens in the shared React app state and persisting them in browser-style storage
- building Android auth as a small variation of the PWA cookie flow
- exposing the raw access token through a Capacitor bridge for convenience
- using the WebView as the system of record for Android auth state
- keeping a temporary dual-path where Android can switch back to cookie auth when bearer auth fails

## Repository Guidance

- Changes to browser or PWA auth belong in the `frontend` repository and stay cookie-based.
- Changes to Android auth belong in the `android` repository and must preserve the native security boundary.
- Shared UI code may depend on an abstract auth facade, but platform-specific auth implementations must remain separate.

## Passkey Compatibility

Android API 24 through 33 remain supported for the application, including password authentication where the tenant policy permits it, token storage, runtime bootstrap, push, and other non-passkey features. The Google Play services Credential Manager provider is intentionally not packaged because its FIDO dependency ships vulnerable generated Tink protobuf code.

Passkey sign-in and registration therefore require Android 14 (API 34) or newer. The native `SecPalNativeAuth` plugin exposes `getPasskeyCapabilities()`, which returns `passkeysAvailable` and, when unavailable, a stable `reason`. On API 24 through 33 the reason is `PASSKEY_ANDROID_VERSION_UNSUPPORTED`. The shared frontend must query this method before presenting passkey controls, hide or disable those controls when unavailable, and retain password sign-in when the tenant permits it. It must not silently replace a passkey-required tenant policy with password authentication; such tenants must receive a clear compatibility message.

A future restoration of pre-Android-14 passkey support requires a verified upstream Credential Manager/Google Play services FIDO dependency path that neither packages vulnerable generated protobuf code nor produces the associated release-build warning.

## Design Intent

Capacitor is used here as a native application shell, not as a way to blur security boundaries between browser and mobile authentication.

SecPal's long-term target is therefore:

- one shared UI codebase
- two intentionally different auth transports
- browser sessions for web
- native bearer tokens for Android
