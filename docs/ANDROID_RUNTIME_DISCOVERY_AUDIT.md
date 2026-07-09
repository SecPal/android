<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
-->

# Android Runtime Discovery Audit

Audit date: 2026-07-09.

## Local State

- Active branch: `android-runtime-cleanup`.
- Upstream comparison: `android-runtime-cleanup` points at `origin/main`.
- Current HEAD: `492e86f chore(deps-dev): bump @types/node from 26.1.0 to 26.1.1 (#329)`.
- Worktree status at audit time: clean.
- Local `main` status: `main` is behind `origin/main` by 6 commits; the active audit branch is already at `origin/main`.
- Other visible remote branches:
  - `origin/chore/replace-markdownlint-cli2`: old markdownlint tooling branch, unrelated to runtime discovery.
  - `origin/liveproof-1783251090`: license attribution branch at `0b8a754`, unrelated to runtime discovery.

## Runtime Discovery And Bootstrap Lineage

The current first-parent Android history shows the runtime-discovery/bootstrap
story completed through the following merged PR lineage:

| Date       | Commit    | PR                                                 | Issue                                                | Status                                           | Scope                                                                             |
| ---------- | --------- | -------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| 2026-05-23 | `4e221d0` | [#233](https://github.com/SecPal/android/pull/233) | [#229](https://github.com/SecPal/android/issues/229) | Merged, issue closed, 13 review threads resolved | Android runtime discovery gate and instance discovery/bootstrap UX.               |
| 2026-05-23 | `1fcf534` | [#234](https://github.com/SecPal/android/pull/234) | [#230](https://github.com/SecPal/android/issues/230) | Merged, issue closed, 9 review threads resolved  | Persisted Android runtime API binding and instance persistence.                   |
| 2026-05-23 | `726b1ff` | [#235](https://github.com/SecPal/android/pull/235) | [#231](https://github.com/SecPal/android/issues/231) | Merged, issue closed, 12 review threads resolved | Tenant-safe instance switching and local state reset.                             |
| 2026-05-23 | `16fbad4` | [#236](https://github.com/SecPal/android/pull/236) | [#232](https://github.com/SecPal/android/issues/232) | Merged, issue closed, 1 review thread resolved   | Runtime bootstrap regression coverage, rollout notes, and hardening.              |
| 2026-05-24 | `5addd7b` | [#240](https://github.com/SecPal/android/pull/240) | [#238](https://github.com/SecPal/android/issues/238) | Merged, issue closed, 14 review threads resolved | Runtime push initialization from deployment metadata.                             |
| 2026-05-24 | `47c1e98` | [#242](https://github.com/SecPal/android/pull/242) | [#241](https://github.com/SecPal/android/issues/241) | Merged, issue closed, 2 review threads resolved  | Runtime FCM messaging initialization.                                             |
| 2026-05-25 | `7dac878` | [#247](https://github.com/SecPal/android/pull/247) | [#239](https://github.com/SecPal/android/issues/239) | Merged, issue closed, 15 review threads resolved | Customer-owned Android push runtime hardening.                                    |
| 2026-05-26 | `bfdaa8f` | [#256](https://github.com/SecPal/android/pull/256) | [#252](https://github.com/SecPal/android/issues/252) | Merged, issue closed, 2 review threads resolved  | Runtime bootstrap and registration lifecycle alignment with notification cleanup. |
| 2026-05-30 | `292533e` | [#259](https://github.com/SecPal/android/pull/259) | [#257](https://github.com/SecPal/android/issues/257) | Merged, issue closed, 2 review threads resolved  | Retained push-token timestamp alignment.                                          |
| 2026-05-30 | `5bb5d2f` | [#262](https://github.com/SecPal/android/pull/262) | [#261](https://github.com/SecPal/android/issues/261) | Merged, issue closed, no review threads          | Canonical notification installation contract alignment.                           |

No unresolved GitHub review threads were found on the relevant merged PRs during
this audit.

## Open GitHub State

Open Android PRs at audit time:

- [#328](https://github.com/SecPal/android/pull/328) `chore(deps-dev): bump typescript from 6.0.3 to 7.0.2`
  - Author: Dependabot.
  - Scope: dependency maintenance.
  - Story decision: excluded from runtime-discovery cleanup scope.

Open Android issues at audit time:

- [#314](https://github.com/SecPal/android/issues/314) `Audit third-party license compliance and REUSE metadata`
  - Scope: license and REUSE compliance.
  - Story decision: excluded from runtime-discovery cleanup scope.

## Conclusion

The Android runtime-discovery/bootstrap implementation and follow-up hardening
work represented by PRs `#233`, `#234`, `#235`, `#236`, `#240`, `#242`, `#247`,
`#256`, `#259`, and `#262` is merged, linked story issues are closed, and review
threads are resolved. No open Android PR, issue, branch, or review thread found
in this audit remains in scope for this runtime-discovery follow-up.
