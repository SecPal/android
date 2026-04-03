<!--
SPDX-FileCopyrightText: 2026 SecPal
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Android Repository Instructions

These instructions are self-contained for the `android` repository at runtime.
Do not assume instructions from sibling repositories or comment-based inheritance are loaded.

## Always-On Rules

- Run `git status --short --branch` before any write action. Never start implementation on local `main`, and stop if a dirty non-`main` branch contains unrelated work.
- Keep one topic per change, fail fast, and never use bypasses such as `--no-verify` or force-push.
- Update `CHANGELOG.md` in the same change set for real fixes, features, or breaking changes.
- Create a GitHub issue immediately for out-of-scope bugs, technical debt, missing tests, documentation gaps, and actionable warnings you cannot fix now.
- Keep GitHub-facing communication in English and reference files and lines instead of pasting large code blocks.
- Treat warnings, audit findings, and deprecations as actionable. Fix them in scope or track them immediately.
- Never reply to Copilot review comments with GitHub comment tools. Fix the code, push, and resolve threads through the approved non-comment workflow.
- Use EPIC plus sub-issues before starting work that will span more than one PR.
- Keep `SPDX-FileCopyrightText` years current in edited files or companion `.license` sidecars.
- Domain policy is strict: `secpal.app` for the public homepage and real email addresses, `api.secpal.dev` for the
  API, `app.secpal.dev` for the PWA/frontend, `secpal.dev` for dev, staging, testing, and examples, and
  `app.secpal` only as the Android application identifier; `api.secpal.app` remains deprecated and must not be used
  as a deployable host.

## Required Validation

Before any commit, PR, or merge, announce the checklist you are executing and stop on the first failed item.
At minimum verify:

- the smallest relevant validation for the touched area passed: tests, typecheck, and lint when applicable
- `CHANGELOG.md` was updated for real changes
- commits are GPG-signed
- REUSE compliance was checked when changed files require it
- the local 4-pass review was completed
- no bypass was used

## Repository Conventions

- Stack: Node 22, React, TypeScript strict mode, Vite, Vitest, React Testing Library, and Capacitor 7.
- Keep presentation in components and logic in hooks or API clients.
- Prefer functional components, named exports, and isolated Capacitor bridge code before broader abstractions.
- Preserve strict TypeScript, accessibility, semantic HTML, focus behavior, and responsive layouts.
- Keep Android enterprise and native capability work behind explicit feature boundaries with targeted tests and docs when needed.

## Scope Notes

- Do not add dependencies or create documentation files unless the task requires them.
