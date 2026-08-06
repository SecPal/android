---
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
name: GitHub Workflow Rules
description: Applies workflow and Dependabot rules to GitHub automation files in this repo.
applyTo: ".github/workflows/**/*.yml,.github/workflows/**/*.yaml,.github/dependabot.yml,.github/dependabot.yaml"
---

# GitHub Actions And Workflow Rules

Applies when editing GitHub Actions workflows and Dependabot configuration in the `android` repository.

- Always set `timeout-minutes` on jobs that define their own `runs-on` and `steps`. Reusable workflow caller jobs that use `jobs.<id>.uses` cannot declare `timeout-minutes` at this level.
- Set explicit `permissions` on every workflow and start with the least privilege needed.
- Pin every external action and reusable workflow to a full, lowercase
  40-character commit SHA. Retain the corresponding tag or branch as an inline
  comment on the same line so Dependabot can update both the SHA and its version
  documentation.
- Before finalizing a pin change, verify in the source repository that each SHA
  resolves to the tag or branch documented beside it.
- Before pinning a cross-repository reusable workflow, verify that its selected
  commit also pins every nested external action to a full commit SHA. A caller's
  full-SHA pin does not make mutable tags inside the reusable workflow immutable.
- Use reusable workflows from the organization templates when they fit the task.
- Use `continue-on-error: true` only for intentional polling or wait steps, never for build or test steps.
- Reference secrets via `${{ secrets.NAME }}` and vars via `${{ vars.NAME }}`. Never hardcode or echo secrets.
- Run `yamllint` on workflow changes before finalizing.

## Full-SHA Enforcement

The repository workflows are compatible with GitHub's **Require actions to be
pinned to a full-length commit SHA** policy. As of 2026-08-05, the policy is not
enabled in either the `SecPal/android` repository or the `SecPal` organization.
Enabling it requires a repository or organization administrator, and an
enterprise policy can override the available organization and repository
settings.

GitHub's policy applies to actions, including GitHub-authored and
organization-owned actions, but permits reusable workflows to use mutable tags.
This repository deliberately has no reusable-workflow exception: the local
workflow pinning regression requires full SHAs for those references as well.
Keep the root `github-actions` Dependabot entry in `.github/dependabot.yml`
enabled so pinned revisions and their same-line version comments remain current.
