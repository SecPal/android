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

if [[ -h "$RELEASE_ENV_FILE" ]]; then
    echo "Refusing to use Android release env file because it is a symlink: $RELEASE_ENV_FILE" >&2
    exit 1
fi

current_uid="$(id -u)"
file_owner_uid="$(stat -c '%u' "$RELEASE_ENV_FILE")"
file_mode="$(stat -c '%a' "$RELEASE_ENV_FILE")"
file_mode_octal=$((8#$file_mode))

if [[ "$file_owner_uid" != "$current_uid" ]]; then
    echo "Refusing to use Android release env file not owned by the current user: $RELEASE_ENV_FILE" >&2
    exit 1
fi

if (( file_mode_octal & 0177 )); then
    echo "Refusing to use Android release env file with overly permissive permissions ($file_mode). Expected 600, 400, or stricter: $RELEASE_ENV_FILE" >&2
    exit 1
fi

set -a
source "$RELEASE_ENV_FILE"
set +a

exec bash ./scripts/with-android-env.sh "$@"
