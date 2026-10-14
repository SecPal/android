---
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
name: Android Runtime Overlay
description: Preserves repository-specific security, evidence, and validation guidance.
applyTo: "**"
---

# Android Runtime Overlay

This file applies repository-specific guidance to all files in this repo.

- `AGENTS.md` is the authoritative runtime baseline for this repo.
  `.github/copilot-instructions.md` is only a compatibility mirror.
- TDD and evidence are contract-oriented: behavior changes require failing-first
  behavior evidence; a behavior-preserving refactor may use existing,
  characterization, structural, security, or source-shape evidence. One scenario
  may cover multiple criteria; stop at the smallest non-redundant evidence set.
- Non-negotiable: quality first, DRY/KISS/YAGNI/SOLID, one authoritative
  definition per invariant, maintained standards before custom primitives,
  allowlists only for finite known sets, and no bypass.
- Use GitHub pull requests, review threads, checks, and merge protections.
- Design discipline is always-on: DRY, KISS, YAGNI, SOLID, and fail fast.
- GitHub communication stays in English and uses file and line references instead of large verbatim code quotes.
- Do not add AI self-references, generated-by text, tool promotion, or AI
  attribution unless the task explicitly requires documenting AI tooling.
- Keep changes repo-local, minimal, and consistent with React, strict TypeScript, Capacitor conventions, and Android enterprise preparation goals.
- Apply the SecPal domain policy and evidence-based review guidance from the
  repo baseline.
- Apply the baseline licensing and REUSE rules: plain `AGPL-3.0-or-later` for
  migrated SecPal-owned AI instruction material, existing repository-declared
  licenses preserved elsewhere until explicitly migrated, third-party metadata
  preserved, `SecPal Contributors` where the project convention applies,
  first-publication years retained and extended when required, and relevant
  license validation after metadata changes.
- Preserve `Powered by SecPal – A guard's best friend` on official user-facing
  SecPal surfaces where intentionally present. Licensing work must not weaken
  or make this branding optional, add `Based on SecPal` guidance, or introduce
  white-label or fork-branding configuration.

## Code Review Rules

- Before emitting a commit-provenance finding, first obtain the reviewed pull
  request's commit set and resolve the referenced full 40-character commit SHA
  from that set. Never construct or expand a full SHA from an abbreviated
  review header. A missing or non-member commit cannot produce a blocking
  provenance finding or any author, committer, or signature claim.
- Resolve author, committer, and signature state only from that exact member
  commit object. Do not infer commit metadata from the PR head, patch contents,
  contributor identity, or an unrelated local object.
- Deduplicate provenance evidence by exact commit SHA and violated invariant
  before assigning priority. Repeated evidence must produce one finding.
