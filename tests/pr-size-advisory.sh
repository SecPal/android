#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/android-pr-size-advisory.XXXXXX")"
output="$(mktemp -d "${TMPDIR:-/tmp}/android-pr-size-advisory-output.XXXXXX")"
trap 'rm -rf -- "$fixture" "$output"' EXIT
fixture_path="$fixture/bin:$PATH"

node --test "$repo_root/scripts/check-pr-size-workflow.test.mjs"

mkdir -p "$fixture/scripts" "$fixture/bin"
cp "$repo_root/scripts/preflight.sh" "$fixture/scripts/preflight.sh"
printf '(stdout|stderr)$\n' >"$fixture/.preflight-exclude"
for command in npx npm reuse; do
  printf '#!/usr/bin/env bash\nexit 0\n' >"$fixture/bin/$command"
  chmod +x "$fixture/bin/$command"
done

(
  cd "$fixture"
  git init --quiet --initial-branch=main
  git config user.name "SecPal Test"
  git config user.email "test@secpal.dev"
  git config commit.gpgSign false
  : >seed.txt
  git add .
  git commit --quiet -m "test: seed fixture"
  git remote add origin "$fixture"
  git update-ref refs/remotes/origin/main HEAD
  git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
  git checkout --quiet -b test-branch
  awk 'BEGIN { for (line = 1; line <= 601; line++) print "line " line }' >large.txt
  git add large.txt
  git commit --quiet -m "test: exceed advisory threshold"
)

set +e
(cd "$fixture" && PATH="$fixture_path" bash scripts/preflight.sh) \
  >"$output/stdout" 2>"$output/stderr"
status=$?
set -e

if [ "$status" -ne 0 ]; then
  cat "$output/stdout" "$output/stderr" >&2
fi
test "$status" -eq 0
if ! grep -Fq "PR size: 601 changed lines (601 insertions, 0 deletions; advisory threshold: 600)" \
  "$output/stderr"; then
  cat "$output/stdout" "$output/stderr" >&2
  exit 1
fi
grep -Fq "WARNING: PR size advisory threshold exceeded." "$output/stderr"

printf '[\n' >"$fixture/.preflight-exclude"
(
  cd "$fixture"
  git add .preflight-exclude
  git commit --quiet -m "test: add invalid exclusion"
)
set +e
(cd "$fixture" && PATH="$fixture_path" bash scripts/preflight.sh) \
  >"$output/invalid-stdout" 2>"$output/invalid-stderr"
invalid_status=$?
set -e
test "$invalid_status" -eq 0
grep -Fq "contains invalid regex pattern(s)" "$output/invalid-stderr"
if ! grep -Fq "PR size: 603 changed lines (602 insertions, 1 deletions; advisory threshold: 600)" \
  "$output/invalid-stderr"; then
  cat "$output/invalid-stdout" "$output/invalid-stderr" >&2
  exit 1
fi
grep -Fq "WARNING: PR size advisory threshold exceeded." "$output/invalid-stderr"

policy_files=(
  "$repo_root/CHANGELOG.md"
  "$repo_root/CONTRIBUTING.md"
  "$repo_root/scripts/preflight.sh"
)
for policy_file in "${policy_files[@]}"; do
  if grep -Fq ".preflight-allow-large-pr" "$policy_file" ||
    grep -Fq "Maximum allowed: 600" "$policy_file" ||
    grep -Fq "PR TOO LARGE" "$policy_file"; then
    echo "Obsolete hard-size policy remains in ${policy_file#"$repo_root/"}" >&2
    exit 1
  fi
done

node - "$repo_root/package.json" <<'NODE'
const { readFileSync } = require("node:fs");

const packageJson = JSON.parse(readFileSync(process.argv[2], "utf8"));
const scripts = packageJson.scripts ?? {};
if (scripts["test:pr-size-advisory"] !== "bash tests/pr-size-advisory.sh") {
  throw new Error("package.json must expose the focused PR-size regression");
}

for (const testScript of ["test", "test:run", "test:coverage"]) {
  const lifecycleScript = `pre${testScript}`;
  if (scripts[lifecycleScript] !== "npm run test:pr-size-advisory") {
    throw new Error(`${lifecycleScript} must run the focused PR-size regression`);
  }
}
NODE

echo "tests/pr-size-advisory.sh: advisory PR-size reporting verified."
