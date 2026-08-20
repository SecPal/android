---
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
name: Android Runtime Overlay
description: Reinforces strict SecPal governance for all files in this repo.
applyTo: "**"
---

# Android Runtime Overlay

This file auto-applies to all files in this repo so strict SecPal governance stays always present at runtime.

- `AGENTS.md` is the authoritative runtime baseline for this repo.
  `.github/copilot-instructions.md` is only a compatibility mirror.
- `SecPal/.github/docs/work-graph-contract.md` is authoritative for generic
  graph, decomposition, replanning, delivery, review-stop, and evidence
  semantics. GitHub-native issue state, hierarchy, dependencies, and order are
  authoritative; body relationship, status, `READY`, and `NEXT` mirrors are not
  graph authority. A blocked issue or non-leaf issue is not executable.
- Each leaf owns one reviewable delivery contract and one primary delivery pull
  request. Decompose by independent contracts, never by pull request count. A
  missing prerequisite becomes a native dependency, a new responsibility that
  is material becomes a sibling or child, and a node with multiple contracts
  is promoted to a sub-epic.
- Create follow-up graph work only when an outside-contract discovery is proven,
  material, actionable, non-duplicate, and still relevant. Missing prerequisites
  and acceptance-contract gaps always require graph action; cosmetic,
  speculative, redundant, already-tracked, and non-material observations do not.
- TDD and evidence are contract-oriented: behavior changes require failing-first
  behavior evidence; a behavior-preserving refactor may use existing,
  characterization, structural, security, or source-shape evidence. One scenario
  may cover multiple criteria; stop at the smallest non-redundant evidence set.
- Review is finite: one bounded full review, bounded remediation of named
  in-contract blockers, delta-only verification, then stop when contract and
  evidence are satisfied. Preserve Android security review and independent
  trust-boundary enforcement without extending review indefinitely.
- Non-negotiable: quality first, DRY/KISS/YAGNI/SOLID, one authoritative
  definition per invariant, maintained standards before custom primitives,
  allowlists only for finite known sets, and no bypass.
- Design discipline is always-on: DRY, KISS, YAGNI, SOLID, and fail fast.
- GitHub communication stays in English and uses file and line references instead of large verbatim code quotes.
- Do not add AI self-references, generated-by text, tool promotion, or AI
  attribution unless the task explicitly requires documenting AI tooling.
- Keep changes repo-local, minimal, and consistent with React, strict TypeScript, Capacitor conventions, and Android enterprise preparation goals.
- Apply the SecPal domain policy and finite warning/finding triage rules from the
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
