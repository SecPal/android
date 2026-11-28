<!--
SPDX-FileCopyrightText: 2025-2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Contributing to SecPal Android

Read the [Code of Conduct](CODE_OF_CONDUCT.md),
[SecPal contribution guide](https://github.com/SecPal/.github/blob/main/CONTRIBUTING.md)
and [Android repository instructions](AGENTS.md). Coordinate through GitHub
issues and pull requests. [WorkGraph contract](https://github.com/SecPal/.github/blob/main/docs/work-graph-contract.md)

## Set up and validate

Use the [repository setup](README.md#local-setup) for the Android toolchain,
the pinned frontend and Ruby. The
[workspace guide](https://github.com/SecPal/.github/blob/main/WORKSPACE_SETUP.md)
covers issue-bound assignments. In a standalone clone, install pre-commit
and use the maintained hook installers after the local dependencies:

```bash
./scripts/setup-pre-commit.sh
./scripts/setup-pre-push.sh
./scripts/preflight.sh
```

Run the focused checks for the affected surface. Use `npx vitest run <path>`
for a focused TypeScript contract test, `npm run native:test:unit` for Android
JVM tests and `npm run native:lint` for Android lint. The
[physical device guide](docs/ANDROID_LOCAL_DEVICE_TESTING.md) covers debug
APK setup and managed-device tests. Use the
[evidence architecture contract](https://github.com/SecPal/.github/blob/main/docs/evidence-architecture-contract.md)
for validation of external systems.

## Pull requests

Keep one reviewable topic in each pull request. Open it as a draft and mark it
ready after self-review and applicable checks. Follow the
[repository validation rules](AGENTS.md#required-validation) and the
[quality workflow](.github/workflows/quality.yml). PR-size reporting is
advisory. Update the [changelog](CHANGELOG.md) for the changes required by the
repository instructions.

Use the SSH signing identity configured for the assignment.
Verify locally with `git verify-commit HEAD` and verify every PR commit
through GitHub before protected delivery.

Preserve file-level licenses and third-party attribution. Use the
[REUSE metadata](REUSE.toml) and [Third-Party Notices](THIRD-PARTY-NOTICES.md)
for licensing. Contributions to SecPal-owned AGPL-covered material are
licensed under [AGPL-3.0-or-later](LICENSE).
