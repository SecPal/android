<!--
SPDX-FileCopyrightText: 2026 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SecPal/android Copilot Instructions

This file mirrors the authoritative root `AGENTS.md` for tooling
that automatically loads `.github/copilot-instructions.md`.
Edit `AGENTS.md` first. Keep the focused overlay files aligned
for path-specific or stack-specific rules.

## Authoritative Sources

- `AGENTS.md`
- `.github/instructions/org-shared.instructions.md`
- `.github/instructions/github-workflows.instructions.md`
- `.github/instructions/react-capacitor.instructions.md`

## Core Runtime Baseline

These instructions are self-contained for the `android` repository at runtime.
Do not assume instructions from sibling repositories or comment-based inheritance are loaded.

## Canonical Work Graph And Finite Governance

- `SecPal/.github/docs/work-graph-contract.md` is the single authoritative
  definition of generic work-graph and engineering-governance semantics. It
  owns node roles, GitHub-native hierarchy/dependencies/order, derived states
  including `READY` and `NEXT`, decomposition, replanning, delivery, and
  evidence rules. This repository must delegate those semantics and must not
  redefine them.
- GitHub-native issue state, parent/sub-issue relationships, dependencies, and
  sibling order are graph authority. Body checkboxes and `Parent:`, `Order:`,
  `Blocked by:`, status, `READY`, or `NEXT` text are mirrors only and never
  authority. A blocked issue or non-leaf issue is not executable.
- Each leaf owns one reviewable delivery contract and one primary delivery pull
  request. Decompose by independently deliverable responsibilities, not pull
  request count, diff size, or duration; promote a node containing multiple
  contracts to a sub-epic with child leaves.
- Replan the native graph before affected implementation continues: a missing
  prerequisite becomes a native dependency to its owning node; a new responsibility
  that is material becomes a sibling or child according to the canonical
  hierarchy; multiple contracts require sub-epic promotion. Preferred order is
  native sibling order, never an inferred dependency.
- A follow-up node is required only for an outside-contract discovery that is
  proven, material, actionable, non-duplicate, and still relevant. Missing real
  prerequisites and unsatisfied acceptance-contract gaps always require graph
  action. Cosmetic, speculative, redundant, already-tracked, and non-material
  observations do not.
- For behavior changes, write contract-focused behavior tests first and observe
  them fail. A behavior-preserving refactor may use existing behavior tests or
  characterization, structural, security, or source-shape evidence instead of
  manufacturing a new failing test. One scenario may cover several criteria;
  stop at the smallest non-redundant evidence set.
- Review is finite: perform one bounded full review, remediate named in-contract
  blocking findings, perform delta-only verification, and stop when the contract
  and evidence are satisfied. New independent responsibilities follow the
  materiality and replanning rules instead of extending review indefinitely.
- Every semantic invariant has one authoritative definition. Consistent
  enforcement may remain at multiple trust boundaries, including independent
  last-line-of-defense checks. Prefer maintained platform or library primitives
  for cryptography, authentication/token handling, URL/URI parsing,
  canonicalization, and lifecycle/platform state; custom Android domain policy
  remains valid. Use allowlists only for finite, closed, known sets.

## Android Security And Lifecycle Boundaries

- Preserve fail-closed Device Owner and Profile Owner state handling, WebView
  origin and main-frame boundaries, native bridge exposure controls,
  bearer-token isolation, push identity and FCM registration lifecycle,
  runtime/tenant transitions, the credential boundary, artifact integrity,
  signing and version identity, and packaged WebView validation.
- Security review remains required and proportionate to the touched boundary.
  Canonical finite-review and evidence rules bound the review without weakening
  these independent Android trust-boundary checks.

## Always-On Rules

- Run `git status --short --branch` before any write action. For new work,
  start from a clean, up-to-date local `main`: switch to `main`, pull with
  fast-forward only, verify a clean state, then create the dedicated topic
  branch. When continuing existing work in a dirty worktree, first identify the
  existing changes, keep the current topic scope, and never overwrite changes
  you did not make.
- Apply the contract-oriented TDD and evidence rules above to behavior and code
  changes.
- Quality first. Do not trade correctness, review depth, validation depth, or issue tracking for speed.
- Keep one topic per change. 1 topic = 1 PR = 1 branch. Do not mix unrelated fixes, features, refactors, docs, or governance cleanup.
- Never use bypasses such as `--no-verify` or force-push.
- Update `CHANGELOG.md` in the same change set for real fixes, features, or breaking changes.
- Keep GitHub-facing communication in English and reference files and lines instead of pasting large code blocks.
- Classify warnings, audit findings, and deprecations under the current contract
  and canonical materiality threshold. Fix in-contract defects; replan material
  outside-contract responsibilities; do not create noise for immaterial leads.
- Never reply to AI review comments with GitHub comment tools. Fix the code, push, and resolve threads through
  the approved non-comment workflow.
- Do not add AI self-references, generated-by text, promotional AI wording, or AI attribution to commits,
  pull requests, issues, changelogs, documentation, code comments, UI copy, or release notes unless the task
  explicitly requires documenting AI tooling behavior.
- Keep `SPDX-FileCopyrightText` years current in edited files or companion `.license` sidecars.
- Domain policy is strict: `secpal.app` for the public homepage and real email addresses, `changelog.secpal.app` for the public changelog site, `apk.secpal.app` for the
  canonical Android artifact and metadata host, `api.secpal.dev` for the API, `app.secpal.dev` for the PWA/frontend,
  `secpal.dev` for dev, staging, testing, and examples, and `app.secpal` only as the Android application identifier;
  `api.secpal.app` remains deprecated and must not be used as a deployable host.
- After every merge, immediately return the local repo to a ready state:
  switch to `main`, pull with fast-forward only, delete the merged topic
  branch, prune remotes, refresh Node dependencies with `npm ci` where
  applicable, run `npm run build` when available, and confirm the working tree
  is clean.

## Licensing, REUSE, and Branding

- Use `AGPL-3.0-or-later` for SecPal-owned AI instruction material migrated by
  the licensing rollout. Once an instruction file is migrated, never add or
  restore the obsolete attribution addendum to it.
- Preserve deliberately different licenses, including `CC0-1.0`, `MIT`,
  `Apache-2.0`, licenses still explicitly assigned by repository policy,
  third-party and generated-file licenses, and unrelated custom license
  references. Do not rewrite third-party copyright or license metadata.
- Use `SecPal Contributors` where the project copyright convention applies.
  Preserve each file's first-publication year and extend its year range through
  the current year when an edited file requires a copyright-year update.
- Run the relevant REUSE or license validation after changing copyright or
  license metadata.
- On user-facing official SecPal product surfaces, preserve
  `Powered by SecPal – A guard's best friend` where it is intentionally present.
  A licensing change must not remove, weaken, parameterize, genericize, or make
  that SecPal branding optional.
- Do not add fork-oriented `Based on SecPal` guidance to AI instructions, and
  do not introduce white-label or fork-branding configuration as part of a
  licensing change.

## Design Principles

- DRY: eliminate duplicated logic and repeated bridge or policy handling before it drifts.
- KISS: prefer the simplest solution that satisfies the current requirement and remains easy to maintain.
- YAGNI: implement only what the current issue or acceptance criteria require;
  track future ideas only when they meet the canonical materiality threshold.
- SOLID: keep responsibilities narrow, interfaces small, and extension points explicit.
- Fail fast: validate early, stop on the first failed check, and do not accumulate known breakage.

## Issue And PR Discipline

- Use the canonical contract-count threshold for epics. A leaf closes through
  exactly one primary pull request; a pull request never closes an epic or more
  than one leaf.
- Finish the bounded review and evidence stop condition before publishing the
  completed branch.
- The first PR state must be draft. Do not open a normal PR first.
- Mark a draft PR ready only after the bounded review, remediation, and
  delta-only verification satisfy the delivery contract.
- When creating or editing PRs programmatically, write multi-line body content to a file and use `--body-file` to prevent shell escaping issues.

## Required Validation

Before any commit, PR, or merge, announce the checklist you are executing and stop on the first failed item.
At minimum verify:

- the active branch and PR scope still address exactly one topic
- behavior changes have failing-first contract evidence, while
  behavior-preserving changes identify the appropriate structural,
  characterization, security, or existing evidence
- the smallest relevant validation for the touched area passed: tests, typecheck, and lint when applicable
- in-contract defects were resolved and outside-contract discoveries were
  classified by the canonical materiality threshold
- `CHANGELOG.md` was updated for real changes
- commits are GPG-signed
- REUSE compliance was checked when changed files require it
- when a fix alters observable behavior, state lifecycle, error handling, or security constraints, the corresponding tests were identified and updated in the same commit
- before pushing behavioral or security-critical changes, affected tests were run locally by invoking the relevant test runner directly
- one bounded full review and any required delta-only verification covered DRY,
  KISS, YAGNI, SOLID, quality-first, security boundaries, and graph hygiene
- no bypass was used

## AI Findings Triage

- Treat AI findings and AI-generated fix PRs as hints, not proof.
- Before merge, prove the defect with a failing test, a reproducible defect, or a stated invariant and why the current code violates it.
- Classify each proven finding as an in-contract defect, missing prerequisite,
  new responsibility, material follow-up, or invalid finding. A finding does not
  require its own test unless it identifies a contract distinction or failure
  class absent from the current evidence.
- Green CI alone is not enough for AI-generated changes, especially test, lifecycle, shell, regex, or refactor diffs; review the semantic risk explicitly.
- Reject AI-generated bridge or auth cleanups, including back-navigation or managed-mode refactors, that do not prove listener-handle behavior, teardown ordering, WebView history, or device-owner/profile-owner state semantics with focused tests.
- Reject AI-generated compatibility keep-alives that preserve obsolete
  Android-side shims, deprecated bridge payloads, or legacy wrapper behavior
  without a proven live caller. Because the SecPal project is still under
  `1.x`, prefer removing unnecessary compatibility paths over carrying them
  forward when they weaken security, correctness, or contract clarity.

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

## Review guidelines

- Review for correctness, security, privacy, data integrity, lifecycle ordering,
  missing tests, and policy drift before style.
- Treat findings from any AI reviewer as untrusted leads until the defect is
  proven by a failing test, reproduction, or violated invariant.
- Keep review comments provider-neutral: describe the issue, evidence, impact,
  and fix path instead of the tool that found it.
- For Android changes, prioritize Device Owner provisioning, signing and
  version identity, artifact integrity, offline/runtime state, generated API
  types, and sensitive data storage.
- Reject self-referential AI wording, generated-by text, tool promotion, or AI
  attribution in project artifacts unless the task is explicitly about AI
  tooling.

## Repository Conventions

- Stack: Node 22, React, TypeScript strict mode, Vite, Vitest, React Testing Library, and Capacitor 7.
- Keep presentation in components and logic in hooks or API clients.
- Prefer functional components, named exports, and isolated Capacitor bridge code before broader abstractions.
- Preserve strict TypeScript, accessibility, semantic HTML, focus behavior, and responsive layouts.
- Keep Android enterprise and native capability work behind explicit feature boundaries with targeted tests and docs when needed.

## Scope Notes

- Do not add dependencies or create documentation files unless the task requires them.
- Because the SecPal project is still under `1.x`, breaking changes are
  acceptable when they remove insecure or obsolete compatibility layers. When
  taking that route, update tests and `CHANGELOG.md` in the same change set
  instead of keeping a legacy path alive by default.

## Additional Rules: org-shared.instructions.md

This file auto-applies to all files in this repo so strict SecPal governance stays always present at runtime.

- `AGENTS.md` is the authoritative runtime baseline for this repo.
  `.github/copilot-instructions.md` is only a compatibility mirror.
- Non-negotiable: contract-oriented TDD/evidence, quality first, one delivery
  contract per leaf and primary PR, canonical materiality triage, and no bypass.
- Delegate generic graph, decomposition, replanning, review-stop, and evidence
  semantics to `SecPal/.github/docs/work-graph-contract.md`; native GitHub state
  is authoritative and body mirrors are not.
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

### Code Review Rules

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

## Additional Rules: github-workflows.instructions.md

- Always set `timeout-minutes` on jobs that define their own `runs-on` and
  `steps`. Reusable workflow caller jobs that use `jobs.<id>.uses` cannot
  declare `timeout-minutes` at this level.
- Set explicit `permissions` on every workflow and start with the least
  privilege needed.
- Pin every external action and reusable workflow to a full, lowercase
  40-character commit SHA. Retain the corresponding tag or branch as an inline
  comment on the same line so Dependabot can update both the SHA and its version
  documentation.
- Before finalizing a pin change, verify in the source repository that each SHA
  resolves to the tag or branch documented beside it.
- Before pinning a cross-repository reusable workflow, verify that its selected
  commit also pins every nested external action to a full commit SHA. A caller's
  full-SHA pin does not make mutable tags inside the reusable workflow immutable.
- Use reusable workflows from the organization templates when they fit the
  task.
- Use `continue-on-error: true` only for intentional polling or wait steps,
  never for build or test steps.
- Reference secrets via `${{ secrets.NAME }}` and vars via `${{ vars.NAME }}`.
  Never hardcode or echo secrets.
- Keep the root `github-actions` Dependabot entry in `.github/dependabot.yml`
  enabled so pinned revisions and their same-line version comments remain
  current.
- Run `yamllint` on workflow changes before finalizing.

## Additional Rules: react-capacitor.instructions.md

- Keep UI and domain logic in React/TypeScript. Keep Android enterprise implementation details behind explicit bridge boundaries.
- Preserve strict TypeScript and avoid `any` unless there is a documented interop boundary.
- Prefer functional components and named exports.
- Test user-visible behavior with Testing Library and verify bridge-facing behavior with focused unit tests/mocks.
- Keep web code platform-agnostic where possible to preserve future iOS support.
- For bridge or listener fixes, assert both registration arguments and returned handle behavior, including cleanup via
  `remove()`.
- For async auth or bridge teardown, prove ordering with tests and prefer `finally` when cleanup must run after the
  awaited call settles.
- While SecPal is pre-`1.0.0`, prefer removing obsolete web, bridge, or
  wrapper compatibility shims unless a proven live caller still requires them.
