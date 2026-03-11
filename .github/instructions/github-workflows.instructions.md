---
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: AGPL-3.0-or-later
name: GitHub Workflow Rules
description: Applies workflow and Dependabot rules to GitHub automation files in this repo.
applyTo: ".github/workflows/**/*.yml,.github/workflows/**/*.yaml,.github/dependabot.yml,.github/dependabot.yaml"
---

# GitHub Actions And Workflow Rules

Applies when editing GitHub Actions workflows and Dependabot configuration in the `android` repository.

- Always set `timeout-minutes` on every job.
- Set explicit `permissions` on every workflow and start with the least privilege needed.
- Pin third-party actions to immutable versions. GitHub-maintained `actions/*` may use supported major tags in this org.
- Use reusable workflows from the organization templates when they fit the task.
- Use `continue-on-error: true` only for intentional polling or wait steps, never for build or test steps.
- Reference secrets via `${{ secrets.NAME }}` and vars via `${{ vars.NAME }}`. Never hardcode or echo secrets.
- Run `yamllint` on workflow changes before finalizing.
