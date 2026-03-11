#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

# Check if pushing from a protected branch
# NOTE: Update PROTECTED_BRANCHES here if protected branch policy changes.
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")
PROTECTED_BRANCHES=("main" "master" "production")

for branch in "${PROTECTED_BRANCHES[@]}"; do
  if [ "$CURRENT_BRANCH" = "$branch" ]; then
    echo ""
    echo "❌ BLOCKED: Direct push from protected branch '$branch' is not allowed!"
    echo ""
    echo "Protected branches should only be updated via pull requests."
    echo "Please create a feature branch and submit a PR instead:"
    echo ""
    echo "  git checkout -b feat/your-feature-name"
    echo "  git commit -am 'Your changes'"
    echo "  git push -u origin feat/your-feature-name"
    echo ""
    echo "EMERGENCY EXCEPTION: If you must bypass this check:"
    echo "  1. Document the reason for the bypass"
    echo "  2. Create an issue to track the technical debt"
    echo "  3. Fix the underlying issue within 24 hours"
    echo "  4. Use: git push --no-verify"
    echo ""
    exit 1
  fi
done

# Auto-detect default branch (fallback to main)
# Use symbolic-ref instead of remote show to avoid network hang
BASE="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)"
[ -z "${BASE:-}" ] && BASE="main"

echo "Using base branch: $BASE"

# Fetch base branch for PR size check (failure is handled later)
git fetch origin "$BASE" 2>/dev/null || true

# Get list of changed files for conditional checks
CHANGED_FILES=$(git diff --name-only --cached 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")

# 0) Formatting & Compliance
FORMAT_EXIT=0
if command -v npx >/dev/null 2>&1; then
  npx --yes prettier --check --cache '**/*.{md,yml,yaml,json,ts,tsx,js,jsx,css,scss,html}' || FORMAT_EXIT=1

  # Only run markdownlint if .md files changed
  if echo "$CHANGED_FILES" | grep -q '\.md$'; then
    npx --yes markdownlint-cli2 '**/*.md' '#node_modules' '#vendor' '#storage' '#build' || FORMAT_EXIT=1
  else
    echo "ℹ️  No markdown files changed, skipping markdownlint"
  fi
fi
# Workflow linting (part of documented gates)
# NOTE: actionlint is disabled in local preflight due to known hanging issues
# It runs in CI via .github/workflows/actionlint.yml instead
if [ -d .github/workflows ]; then
  if command -v actionlint >/dev/null 2>&1; then
    echo "ℹ️  Skipping actionlint in local preflight (runs in CI)" >&2
    # Uncomment below to enable (may hang):
    # timeout 30 actionlint || FORMAT_EXIT=1
  else
    echo "Warning: .github/workflows found but actionlint not installed - skipping workflow lint" >&2
  fi
fi

# Only run REUSE lint if new files were added or license-related files changed
if command -v reuse >/dev/null 2>&1; then
  if [ -n "$CHANGED_FILES" ]; then
    # Check if any new files were added (A) or license files changed
    NEW_OR_LICENSE=$(git diff --name-status --cached 2>/dev/null | grep -E '^(A|M.*LICENSE)' || echo "")
    if [ -n "$NEW_OR_LICENSE" ]; then
      reuse lint || FORMAT_EXIT=1
    else
      echo "ℹ️  No new files or license changes, skipping REUSE lint"
    fi
  else
    reuse lint || FORMAT_EXIT=1
  fi
fi

if [ "$FORMAT_EXIT" -ne 0 ]; then
  echo "Formatting/compliance checks failed. Fix issues above." >&2
  exit 1
fi

# Domain Policy Check (CRITICAL: ZERO TOLERANCE)
if [ -f scripts/check-domains.sh ]; then
  bash scripts/check-domains.sh || {
    echo "" >&2
    echo "❌ Domain Policy Violation detected!" >&2
    echo "Fix the violations above before committing." >&2
    exit 1
  }
fi

# 1) PHP / Laravel
if [ -f composer.json ]; then
  if ! command -v composer >/dev/null 2>&1; then
    echo "Warning: composer.json found but composer not installed - skipping PHP checks" >&2
  else
    composer install --no-interaction --no-progress --prefer-dist --optimize-autoloader
    # Run Laravel Pint code style check if available (blocking: aligns with gates)
    if [ -x ./vendor/bin/pint ]; then
      ./vendor/bin/pint --test
    fi
    # Run PHPStan (use configured level from phpstan.neon if exists, else max)
    if [ -x ./vendor/bin/phpstan ]; then
      if [ -f phpstan.neon ] || [ -f phpstan.neon.dist ]; then
        ./vendor/bin/phpstan analyse
      else
        ./vendor/bin/phpstan analyse --level=max
      fi
    fi
    # ⚠️ SKIP PHP TESTS IN PRE-PUSH HOOK
    # Tests run in CI (GitHub Actions) instead to avoid blocking local workflow
    # Reason: Tests take >2 minutes and block every push
    # Full test suite runs on every PR via .github/workflows/quality.yml
    echo "ℹ️  Skipping PHP tests in pre-push hook (tests run in CI)"
  fi
fi

# 2) Node / React / Capacitor
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  # OPTIMIZATION: Skip install if node_modules is up-to-date (massive time saver)
  # Force install via: PREFLIGHT_FORCE_INSTALL=1 git push
  if [ "${PREFLIGHT_FORCE_INSTALL:-0}" = "1" ] || [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules ]; then
    pnpm install --frozen-lockfile
  else
    echo "ℹ️  Skipping pnpm install (dependencies up-to-date, force via PREFLIGHT_FORCE_INSTALL=1)" >&2
  fi
  # Check if scripts exist before running (pnpm run <script> exits 0 with --if-present)
  pnpm run --if-present lint
  pnpm run --if-present typecheck

  # OPTIMIZATION: Tests are SKIPPED by default in pre-push hook for speed
  # Enable via: PREFLIGHT_RUN_TESTS=1 git push
  # Tests always run in CI, so local skip is safe
  if [ "${PREFLIGHT_RUN_TESTS:-0}" = "1" ]; then
    echo "→ Running tests (enabled via PREFLIGHT_RUN_TESTS=1)..."
    pnpm run --if-present test:run
  else
    echo "ℹ️  Skipping tests in pre-push hook (enable via PREFLIGHT_RUN_TESTS=1)" >&2
    echo "   Tests will run in CI pipeline" >&2
  fi
elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
  # Only run npm ci if node_modules is missing or package-lock.json is newer
  if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci
  else
    echo "Dependencies up to date, skipping npm ci"
  fi

  npm run --if-present lint
  npm run --if-present typecheck

  # OPTIMIZATION: Tests are SKIPPED by default in pre-push hook for speed
  # Enable via: PREFLIGHT_RUN_TESTS=1 git push
  # Tests always run in CI, so local skip is safe
  if [ "${PREFLIGHT_RUN_TESTS:-0}" = "1" ]; then
    echo "→ Running tests (enabled via PREFLIGHT_RUN_TESTS=1)..."
    npm run --if-present test:run
  else
    echo "ℹ️  Skipping tests in pre-push hook (enable via PREFLIGHT_RUN_TESTS=1)" >&2
    echo "   Tests will run in CI pipeline" >&2
  fi
elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
  # OPTIMIZATION: Skip install if node_modules is up-to-date (massive time saver)
  # Force install via: PREFLIGHT_FORCE_INSTALL=1 git push
  if [ "${PREFLIGHT_FORCE_INSTALL:-0}" = "1" ] || [ ! -d node_modules ] || [ yarn.lock -nt node_modules ]; then
    yarn install --frozen-lockfile
  else
    echo "ℹ️  Skipping yarn install (dependencies up-to-date, force via PREFLIGHT_FORCE_INSTALL=1)" >&2
  fi
  # Yarn doesn't have --if-present, check package.json using jq or Node.js
  if command -v jq >/dev/null 2>&1; then
    jq -e '.scripts.lint' package.json >/dev/null 2>&1 && yarn lint
    jq -e '.scripts.typecheck' package.json >/dev/null 2>&1 && yarn typecheck
  elif command -v node >/dev/null 2>&1; then
    node -e "process.exit(require('./package.json').scripts?.lint ? 0 : 1)" && yarn lint
    node -e "process.exit(require('./package.json').scripts?.typecheck ? 0 : 1)" && yarn typecheck
  else
    echo "Warning: jq and node not found - attempting to run yarn scripts (failures will be ignored)" >&2
    yarn lint 2>/dev/null || true
    yarn typecheck 2>/dev/null || true
  fi
  # OPTIMIZATION: Tests are SKIPPED by default in pre-push hook for speed
  # Enable via: PREFLIGHT_RUN_TESTS=1 git push
  # Tests always run in CI, so local skip is safe
  if [ "${PREFLIGHT_RUN_TESTS:-0}" = "1" ]; then
    echo "→ Running tests (enabled via PREFLIGHT_RUN_TESTS=1)..."
    if command -v jq >/dev/null 2>&1; then
      jq -e '.scripts."test:run"' package.json >/dev/null 2>&1 && yarn test:run
    elif command -v node >/dev/null 2>&1; then
      node -e "process.exit(require('./package.json').scripts?.['test:run'] ? 0 : 1)" && yarn test:run
    else
      yarn test:run 2>/dev/null || true
    fi
  else
    echo "ℹ️  Skipping tests in pre-push hook (enable via PREFLIGHT_RUN_TESTS=1)" >&2
    echo "   Tests will run in CI pipeline" >&2
  fi
fi

# 2b) Capacitor project consistency checks
if [ -f capacitor.config.ts ]; then
  if [ ! -d android ]; then
    echo "⚠️  Capacitor config found but native Android project missing (run: npm run cap:add:android)" >&2
  fi
fi

# 3) OpenAPI (Spectral)
if [ -f docs/openapi.yaml ] && command -v npx >/dev/null 2>&1; then
  npx --yes @stoplight/spectral-cli lint docs/openapi.yaml
fi

# 4) Check PR size locally (against BASE)
if ! git rev-parse -q --verify "origin/$BASE" >/dev/null 2>&1; then
  echo "Warning: Cannot verify base branch origin/$BASE - skipping PR size check." >&2
  echo "Tip: Run 'git fetch origin $BASE' to enable PR size checking." >&2
else
  MERGE_BASE=$(git merge-base "origin/$BASE" HEAD 2>/dev/null)
  if [ -z "$MERGE_BASE" ]; then
    echo "Warning: Cannot determine merge base with origin/$BASE. Skipping PR size check." >&2
  else
    # Get raw diff output
    RAW_DIFF_OUTPUT=$(git diff --numstat "$MERGE_BASE"..HEAD 2>/dev/null)
    DIFF_OUTPUT="$RAW_DIFF_OUTPUT"

    # Load exclude patterns from .preflight-exclude if it exists
    if [ -f "$ROOT_DIR/.preflight-exclude" ]; then
      # Extract non-comment, non-empty lines as grep-compatible regex patterns
      # Strip CR for Windows/CRLF compatibility
      EXCLUDE_PATTERNS=$(grep -vE '^[[:space:]]*(#|$)' "$ROOT_DIR/.preflight-exclude" | tr -d '\r' || true)

      if [ -n "$EXCLUDE_PATTERNS" ]; then
        # Build regex alternation for efficient filtering (patterns are used as-is)
        EXCLUDE_REGEX=$(echo "$EXCLUDE_PATTERNS" | tr '\n' '|' | sed 's/|$//')

        # Validate regex and warn about dangerous patterns
        # grep exit codes: 0=match, 1=no match, 2=error (invalid regex)
        set +e  # Temporarily disable exit-on-error to capture grep's exit code
        echo "" | grep -qE -- "$EXCLUDE_REGEX" 2>/dev/null
        GREP_EXIT=$?
        set -e  # Re-enable exit-on-error
        if [ $GREP_EXIT -ne 2 ]; then
          # Pattern is valid (exit 0 or 1), check if it matches everything
          # Test against diverse filenames to detect overly broad patterns
          # Include various cases: lowercase, uppercase, numbers, special chars, hidden files
          if echo "test-file.txt" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "another-file.js" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "random.md" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "README.md" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "package.json" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo ".hidden" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "File123.py" | grep -qE -- "$EXCLUDE_REGEX" && \
             echo "UPPERCASE" | grep -qE -- "$EXCLUDE_REGEX"; then
            echo "⚠️  WARNING: .preflight-exclude contains pattern that matches EVERYTHING (e.g., '.*')" >&2
            echo "This will exclude all files from PR size calculation!" >&2
          fi
        else
          # Invalid regex - grep failed even on empty input
          echo "⚠️  WARNING: .preflight-exclude contains invalid regex pattern(s)" >&2
          echo "The pattern will be ignored. Please check your .preflight-exclude file." >&2
          echo "Common issues: unbalanced brackets [, unmatched (, trailing backslash \\" >&2
        fi

        # Use -- to prevent patterns starting with - from being interpreted as flags
        # || true prevents script exit if pattern is invalid
        DIFF_OUTPUT=$(echo "$DIFF_OUTPUT" | grep -vE -- "$EXCLUDE_REGEX" 2>/dev/null || true)
      fi
    fi

    # Check if all files were excluded
    if [ -n "$RAW_DIFF_OUTPUT" ] && [ -z "$DIFF_OUTPUT" ]; then
      echo "⚠️  All changed files are excluded (lock files, license files, etc.)"
      echo "Preflight OK · Changed lines: 0 (after exclusions)"
      exit 0
    else
      # Use --numstat for locale-independent parsing
      INSERTIONS=$(echo "$DIFF_OUTPUT" | awk '{ins+=$1} END {print ins+0}')
      DELETIONS=$(echo "$DIFF_OUTPUT" | awk '{del+=$2} END {print del+0}')
      CHANGED=$((INSERTIONS + DELETIONS))

      if [ "$CHANGED" -gt 600 ]; then
        # Check for override file (similar to GitHub label for exceptional cases)
        if [ -f "$ROOT_DIR/.preflight-allow-large-pr" ]; then
          echo "⚠️  Large PR override active ($CHANGED > 600 lines). Remove .preflight-allow-large-pr when done." >&2
        else
          echo "" >&2
          echo "═══════════════════════════════════════════════════════════════" >&2
          echo "❌ PRE-PUSH CHECK FAILED: PR TOO LARGE" >&2
          echo "═══════════════════════════════════════════════════════════════" >&2
          echo "" >&2
          echo "Your changes: $CHANGED lines ($INSERTIONS insertions, $DELETIONS deletions)" >&2
          echo "Maximum allowed: 600 lines per PR" >&2
          echo "" >&2
          echo "Action required: Split changes into smaller, focused PRs" >&2
          echo "" >&2
          echo "💡 Available options:" >&2
          echo "  1. Split PR: Recommended approach" >&2
          echo "  2. Override check: touch .preflight-allow-large-pr" >&2
          echo "" >&2
          echo "Note: Lock files and license files are already excluded" >&2
          echo "      See .preflight-exclude for custom exclusion patterns" >&2
          echo "" >&2
          echo "═══════════════════════════════════════════════════════════════" >&2
          echo "Push aborted. Fix the issue above and try again." >&2
          echo "═══════════════════════════════════════════════════════════════" >&2
          echo "" >&2
          exit 2
        fi
      else
        echo "Preflight OK · Changed lines: $CHANGED"
      fi
    fi
  fi
fi

# All checks passed
exit 0
