#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
android_root="${repository_root}/android"
fixture_root="$(mktemp -d)"
missing_frontend="${fixture_root}/missing-frontend"
release_log="${fixture_root}/release.log"

cleanup() {
    rm -f "$release_log"
    rmdir "$fixture_root"
}
trap cleanup EXIT

run_gradle() {
    (
        cd "$android_root"
        SECPAL_ANDROID_FRONTEND_DIR="$missing_frontend" \
            ./gradlew --no-daemon "$@"
    )
}

run_gradle \
    :app:verifyAndroidRuntimeSchemaAsset \
    :app:assembleCtRegression

expected_error="Android packaging requires the SecPal frontend source at ${missing_frontend}."
for release_task in \
    :app:assembleRelease \
    :app:bundleRelease \
    :app:packageReleaseBundle \
    :app:packageReleaseUniversalApk \
    :app:signReleaseBundle; do
    if run_gradle "$release_task" >"$release_log" 2>&1; then
        echo "${release_task} unexpectedly succeeded without frontend source." >&2
        exit 1
    fi
    if ! grep -Fq "$expected_error" "$release_log"; then
        echo "${release_task} did not fail through the frontend-source guard." >&2
        sed -n '1,200p' "$release_log" >&2
        exit 1
    fi
done

echo "ANDROID_PACKAGING_GUARD_OK"
