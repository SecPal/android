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

Recommended hardening:

- biometric or device-credential gate before revealing highly sensitive data
- minimized token lifetime with documented renewal behavior
- central handling for `401` and revoked-device states
- redaction of auth-sensitive values from crash and telemetry output

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

## Design Intent

Capacitor is used here as a native application shell, not as a way to blur security boundaries between browser and mobile authentication.

SecPal's long-term target is therefore:

- one shared UI codebase
- two intentionally different auth transports
- browser sessions for web
- native bearer tokens for Android
