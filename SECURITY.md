<!-- SPDX-FileCopyrightText: 2025-2026 SecPal -->
<!-- SPDX-License-Identifier: CC0-1.0 -->

# Security policy

## Report a vulnerability

Use [GitHub's private reporting form](https://github.com/SecPal/android/security/advisories/new).
If the form is unavailable to you, email <security@secpal.app>. A PGP key is
available on request. Include the affected component, source commit or app
version and channel, device and Android version where relevant, reproduction
steps and impact. Use the private channel for coordinated disclosure.
[Published advisories](https://github.com/SecPal/android/security/advisories)

## Source and releases

Identify the exact source or official artifact affected. The
[Stable metadata](https://apk.secpal.app/android/stable/latest.json) and
[Beta metadata](https://apk.secpal.app/android/beta/latest.json) record current
direct-download availability. The
[release procedure](docs/ANDROID_RELEASE_DISTRIBUTION.md) defines the checks
and evidence for signing and publication.

## Android security boundaries

The Android repository owns native credential custody, WebView isolation,
deployment binding, Android transport trust and platform policy. See
[native authentication](docs/ANDROID_AUTH_ARCHITECTURE.md) and
[Android Enterprise capabilities](docs/ANDROID_ENTERPRISE_CAPABILITIES.md)
for the implemented boundaries and their evidence.

CodeQL covers JavaScript/TypeScript and native Java/Kotlin.
[Quality Checks](.github/workflows/quality.yml) run Android lint, JVM unit
tests, runtime and network security checks, and repository security scanning.
The [CodeQL workflow](.github/workflows/codeql.yml) requires successful native
analysis. GitHub enables secret scanning and push protection. Report
server authentication, authorization, rate limiting or CORS concerns through
the [API security policy](https://github.com/SecPal/api/blob/main/SECURITY.md).
