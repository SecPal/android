<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Android Repository Instructions

These instructions are self-contained for the `android` repository at runtime.
Do not assume instructions from sibling repositories or comment-based inheritance are loaded.

## Always-On Rules

- Apply SecPal core rules on every task: TDD first, fail fast, no bypass,
  one topic per change, and create a GitHub issue immediately for findings
  that cannot be fixed in the current scope.
- Before any commit, PR, or merge, announce and verify the required checklist. Stop on the first failed check.
- Update `CHANGELOG.md` in the same change set for real fixes, features, or breaking changes.
- Keep GitHub-facing communication in English.
- Domain policy is strict: use only `secpal.app` and `secpal.dev`.
- Prefer small, user-visible fixes that match existing patterns. Avoid speculative abstractions.

## Required Checklist

Before any commit, PR, or merge, announce and verify at least:

- the smallest relevant validation passed for the affected area: tests, typecheck, and lint when applicable
- `CHANGELOG.md` was updated in the same change set for real changes
- no bypass was used, including `--no-verify` or force-push
- repo-local instructions remain self-contained and do not rely on cross-repo inheritance
- out-of-scope findings were turned into GitHub issues immediately

## Repository Stack

- Node 22, React, TypeScript strict mode, Vite, Vitest, React Testing Library.
- Capacitor 7 with Android platform support. iOS support may be added later.
- Android Enterprise and DPC features are implemented incrementally and validated against official Android Enterprise guidance.

## Architecture

- Keep presentation in components and logic in hooks or API clients.
- Prefer functional components, named exports, and one component per file.
- Keep Capacitor bridge code isolated from domain/business logic.
- Use React built-ins first. Introduce extra state libraries only when the
  existing codebase already uses them or the task truly requires them.

## Android App Rules

- Preserve strict TypeScript. Do not introduce `any` without a concrete, justified boundary.
- Test user-visible behavior with Testing Library and MSW where applicable.
- Run the smallest relevant validation for every change: tests, typecheck, and lint for affected areas.
- Keep accessibility, semantic HTML, focus behavior, and responsive layouts intact.
- For Android native capabilities (for example DPC/device-owner related behavior), keep implementation behind explicit feature boundaries and include targeted tests/docs.

## Scope Notes

- Do not add dependencies or create documentation files unless the task requires it.
- Treat this file as the runtime baseline for the repo. Repo-specific `.instructions.md` files add detail for matching files.
