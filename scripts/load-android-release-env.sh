#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail

RELEASE_ENV_FILE="${SECPAL_ANDROID_RELEASE_ENV_FILE:-$HOME/.config/secpal/android-release.env}"

if [[ ! -f "$RELEASE_ENV_FILE" ]]; then
    echo "Missing Android release env file: $RELEASE_ENV_FILE" >&2
    echo "Create it first or run scripts/setup-android-release-keystore.sh." >&2
    exit 1
fi

set -a
source "$RELEASE_ENV_FILE"
set +a

exec bash ./scripts/with-android-env.sh "$@"
