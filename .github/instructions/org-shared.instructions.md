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
- Use only `secpal.app` and `secpal.dev`.
- Keep changes repo-local, minimal, and consistent with React, strict TypeScript, Capacitor conventions, and Android enterprise preparation goals.
