#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

set -euo pipefail

tool=${1:?missing tool name}
shift

if [ ! -x "./node_modules/.bin/$tool" ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  if [ ! -f package-lock.json ]; then
    echo "Missing package-lock.json required to install $tool." >&2
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install $tool." >&2
    exit 1
  fi

  npm ci
fi

exec "./node_modules/.bin/$tool" "$@"
