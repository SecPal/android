#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025-2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")
PROTECTED_BRANCHES=("main")

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
    exit 1
  fi
done

BASE="main"

echo "Using base branch: $BASE"

get_worktree_changed_files() {
  {
    git diff --name-only --cached 2>/dev/null || true
    git diff --name-only 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | sed '/^$/d' | sort -u
}

get_worktree_name_status() {
  {
    git diff --name-status --cached 2>/dev/null || true
    git diff --name-status 2>/dev/null || true
    while IFS= read -r -d '' file; do
      printf 'A\t%s\n' "$file"
    done < <(git ls-files --others --exclude-standard -z 2>/dev/null)
  } | sed '/^$/d' | awk -F '\t' '!seen[$2]++'
}

get_tracked_yaml_files() {
  while IFS= read -r -d '' file; do
    if [ -f "$file" ]; then
      printf '%s\0' "$file"
    fi
  done < <(git ls-files -z -- '*.yml' '*.yaml')
}

get_effective_pr_numstat() {
  local merge_base="$1"

  {
    git diff --numstat "$merge_base" -- 2>/dev/null || true
    while IFS= read -r -d '' file; do
      git diff --no-index --numstat -- /dev/null "$file" 2>/dev/null || true
    done < <(git ls-files --others --exclude-standard -z 2>/dev/null)
  } | sed '/^$/d'
}

# Fetch base branch for PR size check (failure is handled later)
git fetch origin "$BASE" 2>/dev/null || true

# Get list of changed files for conditional checks
CHANGED_FILES=$(get_worktree_changed_files)
NAME_STATUS_CHANGES=$(get_worktree_name_status)

if [ -f scripts/check-conflict-markers.sh ]; then
  bash scripts/check-conflict-markers.sh
fi

# Install locked Node dependencies before lockfile-provided validation tools run.
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules ]; then
    pnpm install --frozen-lockfile
  else
    echo "ℹ️  Skipping pnpm install (dependencies up-to-date)" >&2
  fi
elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
  if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci
  else
    echo "Dependencies up to date, skipping npm ci"
  fi
elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
  if [ ! -d node_modules ] || [ yarn.lock -nt node_modules ]; then
    yarn install --frozen-lockfile
  else
    echo "ℹ️  Skipping yarn install (dependencies up-to-date)" >&2
  fi
fi

# 0) Formatting & Compliance
FORMAT_EXIT=0
if [ -x node_modules/.bin/prettier ]; then
  ./node_modules/.bin/prettier --check --cache '**/*.{md,yml,yaml,json,ts,js,css,html}' || FORMAT_EXIT=1

  # Only run markdownlint if .md files changed
  if echo "$CHANGED_FILES" | grep -q '\.md$'; then
    ./node_modules/.bin/markdownlint --config .markdownlint.json '**/*.md' .github --ignore node_modules --ignore vendor --ignore storage --ignore build --ignore .git --ignore fastlane/README.md || FORMAT_EXIT=1
  else
    echo "ℹ️  No markdown files changed, skipping markdownlint"
  fi
fi
if [ -d .github/workflows ]; then
  if command -v actionlint >/dev/null 2>&1; then
    actionlint || FORMAT_EXIT=1
  else
    echo "Warning: .github/workflows found but actionlint not installed - skipping workflow lint" >&2
  fi
fi

if [ -f .yamllint.yml ] && command -v yamllint >/dev/null 2>&1; then
  YAML_FILES=()
  while IFS= read -r -d '' file; do
    YAML_FILES+=("$file")
  done < <(
    get_tracked_yaml_files
  )

  if [ "${#YAML_FILES[@]}" -gt 0 ]; then
    yamllint -c .yamllint.yml "${YAML_FILES[@]}" || FORMAT_EXIT=1
  fi
fi

# Only run REUSE lint if new files were added or license-related files changed
if command -v reuse >/dev/null 2>&1; then
  if [ -n "$CHANGED_FILES" ]; then
    # Check if any new files were added (A) or license files changed
    NEW_OR_LICENSE=$(printf '%s\n' "$NAME_STATUS_CHANGES" | grep -E '^(A[[:space:]]|M[[:space:]].*LICENSE)' || echo "")
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

# 1) Node / Capacitor wrapper
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  pnpm run --if-present lint
  pnpm run --if-present typecheck
  pnpm run --if-present test:run
elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
  npm run --if-present lint
  npm run --if-present typecheck
  npm run --if-present test:run
elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
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
  if command -v jq >/dev/null 2>&1; then
    jq -e '.scripts."test:run"' package.json >/dev/null 2>&1 && yarn test:run
  elif command -v node >/dev/null 2>&1; then
    node -e "process.exit(require('./package.json').scripts?.['test:run'] ? 0 : 1)" && yarn test:run
  else
    yarn test:run 2>/dev/null || true
  fi
fi

if [ -f capacitor.config.ts ]; then
  if [ ! -d android ]; then
    echo "❌ Capacitor config found but native Android project is missing (run: npm run cap:add:android)" >&2
    exit 1
  fi
fi

npm run --if-present native:verify

# 2) Check PR size locally (against BASE)
if ! git rev-parse -q --verify "origin/$BASE" >/dev/null 2>&1; then
  echo "Warning: Cannot verify base branch origin/$BASE - skipping PR size check." >&2
  echo "Tip: Run 'git fetch origin $BASE' to enable PR size checking." >&2
else
  MERGE_BASE=$(git merge-base "origin/$BASE" HEAD 2>/dev/null)
  if [ -z "$MERGE_BASE" ]; then
    echo "Warning: Cannot determine merge base with origin/$BASE. Skipping PR size check." >&2
  else
    # Get raw diff output, including committed branch changes plus local worktree deltas.
    RAW_DIFF_OUTPUT=$(get_effective_pr_numstat "$MERGE_BASE")
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

          DIFF_OUTPUT=$(echo "$DIFF_OUTPUT" | grep -vE -- "$EXCLUDE_REGEX" 2>/dev/null || true)
        else
          # Invalid regex - grep failed even on empty input
          echo "⚠️  WARNING: .preflight-exclude contains invalid regex pattern(s)" >&2
          echo "The pattern will be ignored. Please check your .preflight-exclude file." >&2
          echo "Common issues: unbalanced brackets [, unmatched (, trailing backslash \\" >&2
        fi

      fi
    fi

    PR_SIZE_ADVISORY_THRESHOLD=600

    # Report when all files were excluded, then continue with zero counts.
    if [ -n "$RAW_DIFF_OUTPUT" ] && [ -z "$DIFF_OUTPUT" ]; then
      echo "⚠️  All changed files are excluded (lock files, license files, etc.)" >&2
    fi

    # Use --numstat for locale-independent parsing.
    INSERTIONS=$(echo "$DIFF_OUTPUT" | awk '{ins+=$1} END {print ins+0}')
    DELETIONS=$(echo "$DIFF_OUTPUT" | awk '{del+=$2} END {print del+0}')
    CHANGED=$((INSERTIONS + DELETIONS))
    SIZE_REPORT="PR size: $CHANGED changed lines ($INSERTIONS insertions, $DELETIONS deletions; advisory threshold: $PR_SIZE_ADVISORY_THRESHOLD)"

    if [ "$CHANGED" -gt "$PR_SIZE_ADVISORY_THRESHOLD" ]; then
      echo "$SIZE_REPORT" >&2
      echo "WARNING: PR size advisory threshold exceeded." >&2
      echo "Keep this pull request focused on one logical topic and make the review plan explicit." >&2
    else
      echo "Preflight OK · $SIZE_REPORT"
    fi
  fi
fi

# All checks passed
exit 0
