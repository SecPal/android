<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
-->

# Schema-3 Android Artifact Withdrawal

Issue: `SecPal/android#434`

Parent: `SecPal/.github#590`

Guard prerequisite: Android PR `#433`, merge commit
`ccd935bb6fa9b240adb74250839670339fcbeb37`

## Withdrawn Stable Artifact

- release: `0.0.1-261932118`
- package: `app.secpal`
- version name: `0.0.1`
- version code: `261932118`
- APK SHA-256:
  `60f11c0fa9569e9a79efd61b189f75da88ac939e263e6e9e100271962d57be27`
- signing certificate SHA-256:
  `C3E9FD0769F3349BB0B056BAE669472340E1CB286626DE30C9C9FAF95F1E47B5`
- packaged runtime path: `assets/public/index.html`
- packaged notification-registration schema: strict integer `3`
- schema-4 guarded verifier result: rejected

## Withdrawn Beta Artifact

- release: `0.0.1-261932119`
- package: `app.secpal`
- version name: `0.0.1`
- version code: `261932119`
- APK SHA-256:
  `f1fefbfaf1c6ea8429577d06a7c73cacc6e30d081305aed3e8ed77a5df5a612c`
- signing certificate SHA-256:
  `C3E9FD0769F3349BB0B056BAE669472340E1CB286626DE30C9C9FAF95F1E47B5`
- packaged runtime path: `assets/public/index.html`
- packaged notification-registration schema: strict integer `3`
- schema-4 guarded verifier result: rejected

## Resulting Direct-Download State

The guarded withdrawal completed at `2026-07-24T18:41:56Z`. Stable, the Stable
aliases, and Beta publish `release_available: false`. Version identity, signing
identity, APK URL, checksum URL, and all versioned URLs are `null` in
unavailable metadata.

The Stable, Stable-alias, Beta, and two versioned schema-3 APK paths return
HTTP `404`. The associated public checksum and versioned metadata paths also
return HTTP `404`. Their APKs, checksums, and versioned metadata were moved
rather than deleted and remain recoverable under the non-public quarantine
transaction `android-artifacts-withdrawn/2026-07-24T18-41-56Z`.

Contract `main` constrains the relevant schemas to `const: 4`; the API requires
strict integer schema 4; the frontend has no schema-3 compatibility path; and
Android independently emits and verifies the canonical schema-4 registration
path.

Google Play access and track inspection are explicitly excluded from this
corrective execution.
