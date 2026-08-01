#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

chromium_path="${CHROMIUM_PATH:-}"

if [[ -z "$chromium_path" ]]; then
    for executable in chromium google-chrome google-chrome-stable; do
        if chromium_path="$(command -v "$executable" 2>/dev/null)"; then
            break
        fi
    done
fi

if [[ ! -f "$chromium_path" || ! -x "$chromium_path" ]]; then
    echo "Required Chromium executable is unavailable: ${chromium_path}" >&2
    exit 66
fi

export CHROMIUM_PATH="$chromium_path"
exec vitest run tests/android-runtime-browser-smoke.test.ts
