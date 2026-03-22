---
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
name: Android Runtime Overlay
description: Reinforces the android repository baseline when working on files in this repo.
applyTo: "**"
---

# Android Runtime Overlay

The historical filename `org-shared.instructions.md` is retained for continuity.
At runtime, this file now acts as the repo-local overlay for the `android` repository.

- Treat `.github/copilot-instructions.md` in this repo as the authoritative runtime baseline.
- Do not rely on cross-repo inheritance, comments, or external config files being loaded.
- Enforce SecPal core rules while editing any file: tests first where
  applicable, no bypass, fail fast, one topic per change, immediate issue
  creation for out-of-scope findings, and `CHANGELOG.md` updates for real
  changes.
- Use `secpal.app` for production services and all email addresses, and
  `secpal.dev` only for dev, staging, testing, and examples.
- Never reply to Copilot review comments with GitHub comment tools; use the
  approved non-comment review workflow instead.
- Keep commits GPG-signed, use file and line references instead of verbatim code
  quotes in GitHub communication, and require EPIC + sub-issues for work that
  spans more than one PR.
- Treat warnings, audit findings, deprecation notices, and similar non-fatal
  diagnostics as actionable; fix them in scope or create a GitHub issue
  immediately when they are real but out of scope.
- Keep changes repo-local, minimal, and consistent with React, strict TypeScript, Capacitor conventions, and Android enterprise preparation goals.
