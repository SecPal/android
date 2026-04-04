---
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
name: Android Runtime Overlay
description: Reinforces strict SecPal governance for all files in this repo.
applyTo: "**"
---

# Android Runtime Overlay

This file auto-applies to all files in this repo so strict SecPal governance stays always present at runtime.

- `.github/copilot-instructions.md` is the authoritative runtime baseline for this repo.
- Non-negotiable: TDD first, quality first, 1 topic = 1 PR = 1 branch, immediate GitHub issue creation for every real out-of-scope finding, and no bypass.
- If work needs more than one PR, or probably will, create an EPIC with linked sub-issues before implementation.
- Design discipline is always-on: DRY, KISS, YAGNI, SOLID, and fail fast.
- GitHub communication stays in English and uses file and line references instead of large verbatim code quotes.
- Keep changes repo-local, minimal, and consistent with React, strict TypeScript, Capacitor conventions, and Android enterprise preparation goals.
- Apply the SecPal domain policy and immediate warning and issue triage rules from the repo baseline.
