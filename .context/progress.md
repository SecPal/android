<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
-->

## Codebase Patterns

- Story audit artifacts belong in `docs/` with the repo's SPDX HTML comment header and concise GitHub links rather than copied PR content.
- Runtime-contract audits should compare the shared frontend facade, injected WebView bridge, native Capacitor plugin, persisted payload shape, and reset/logout side effects together; missing injected bridge methods can break a frontend facade even when the native plugin already implements them.
- Obsolete Android bootstrap compatibility paths should be removed only after checking the shared frontend facade for live callers; keep tenant-state and push-token cleanup separate from removed bootstrap persistence shims.
- Frontend-facing Android runtime clear methods must clear native bootstrap persistence and tenant-scoped browser state together; otherwise shared instance-switch flows can return to discovery with stale customer storage.

## US-001: Audit Android runtime-discovery story state

- What was implemented
  - Added a committed Android runtime-discovery/bootstrap audit covering local branch/worktree state, recent commit lineage, merged PR and issue status, review-thread resolution, and unrelated open GitHub state exclusions.
  - Updated `CHANGELOG.md` for the documentation change.
- Files changed
  - `docs/ANDROID_RUNTIME_DISCOVERY_AUDIT.md`
  - `CHANGELOG.md`
  - `.context/progress.md`
- **Learnings for future iterations:**
  - Patterns discovered
    - GitHub GraphQL `reviewThreads` is the reliable check for stale review findings after merged PRs.
    - Runtime-discovery/bootstrap work is clustered in PRs `#233`, `#234`, `#235`, `#236`, `#240`, `#242`, `#247`, `#256`, `#259`, and `#262`.
  - Gotchas encountered
    - The active topic branch already tracks `origin/main`, while local `main` is behind by 6 commits; use the active branch state for this Polyscope workspace audit.

## US-002: Verify the native runtime-bootstrap contract against merged frontend behavior

- What was implemented
  - Added a committed Android runtime-bootstrap contract audit mapping the merged shared frontend runtime-discovery facade to the Android injected bridge, native plugin methods, persisted bootstrap payload, Android FCM metadata, and logout/reset behavior.
  - Exposed `getRuntimeInfo`, `getRuntimeBootstrap`, `setRuntimeBootstrap`, and `clearRuntimeBootstrap` on the injected `SecPalNativeAuthBridge` so the merged frontend `SecPalRuntimeBootstrap` facade can use the Android shell contract directly.
  - Added focused Vitest coverage proving the injected bridge delegates runtime info/read/apply/clear and updates injected runtime state.
  - Updated `CHANGELOG.md` for the documentation and bridge contract fix.
- Files changed
  - `docs/ANDROID_RUNTIME_BOOTSTRAP_CONTRACT.md`
  - `scripts/inject-native-auth-bridge.mjs`
  - `tests/native-auth-bridge-bootstrap.test.ts`
  - `CHANGELOG.md`
  - `.context/progress.md`
- **Learnings for future iterations:**
  - Patterns discovered
    - The frontend runtime-bootstrap facade depends on methods exposed by `globalThis.SecPalNativeAuthBridge`, not only on Capacitor plugin methods; the injected bridge is part of the native ABI.
    - Canonical frontend bootstrap metadata maps snake_case API fields to the Android applied camelCase payload before native persistence.
  - Gotchas encountered
    - The native plugin already implemented runtime info/read/apply/clear, but the injected bridge did not expose those methods until this story.

## US-003: Remove obsolete Android runtime-bootstrap follow-up artifacts

- What was implemented
  - Removed the injected WebView runtime-bootstrap compatibility path that restored or confirmed deployments through `SecPalNativeAuth.setApiBaseUrl(...)` and `sessionStorage` fallback persistence.
  - Kept the merged frontend runtime-bootstrap contract intact by requiring `getRuntimeBootstrap`/`setRuntimeBootstrap` for restore and confirmation, while preserving tenant-state and Android push cleanup behavior.
  - Updated focused bridge tests, the runtime-bootstrap contract audit, and `CHANGELOG.md` for the removed obsolete path.
- Files changed
  - `scripts/inject-native-auth-bridge.mjs`
  - `tests/native-auth-bridge-bootstrap.test.ts`
  - `docs/ANDROID_RUNTIME_BOOTSTRAP_CONTRACT.md`
  - `CHANGELOG.md`
  - `.context/progress.md`
- **Learnings for future iterations:**
  - Patterns discovered
    - The merged frontend facade has no live `setApiBaseUrl` caller; Android-side confirmation should fail closed when the explicit runtime-bootstrap persistence method is missing.
  - Gotchas encountered
    - Several tests used the old `runtimeBootstrapState` session-storage shim as a shortcut for a configured runtime; those fixtures needed to restore via `getRuntimeBootstrap` instead.

## US-004: Fix remaining review findings with focused regression coverage

- What was implemented
  - Proved a remaining Android runtime-bootstrap cleanup defect with a focused failing bridge regression: the frontend-facing `SecPalNativeAuthBridge.clearRuntimeBootstrap()` method cleared native runtime persistence but left tenant-scoped browser storage behind.
  - Updated the injected bridge clear method to reuse tenant-scoped browser cleanup after native bootstrap persistence clears, preserving the locale while removing stale customer storage before returning to discovery.
  - Updated `CHANGELOG.md` for the runtime cleanup behavior fix.
- Files changed
  - `scripts/inject-native-auth-bridge.mjs`
  - `tests/native-auth-bridge-bootstrap.test.ts`
  - `CHANGELOG.md`
  - `.context/progress.md`
- **Learnings for future iterations:**
  - Patterns discovered
    - Frontend facade methods need the same cleanup guarantees as the in-page reset flow because the shared frontend can call the injected bridge directly.
  - Gotchas encountered
    - Existing reset-button tests covered tenant cleanup through `clearConfiguredRuntimeState`, but not the public `clearRuntimeBootstrap()` method used by the shared frontend instance-switch path.
