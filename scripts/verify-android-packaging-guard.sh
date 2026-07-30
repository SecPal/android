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

node \
    "${repository_root}/scripts/verify-android-runtime-schema.mjs" \
    "${android_root}/app/build/outputs/apk/ctRegression/app-ctRegression.apk" \
    "${android_root}/app/src/main/res/values/strings.xml"

if run_gradle :app:assembleRelease >"$release_log" 2>&1; then
    echo "Release packaging unexpectedly succeeded without frontend source." >&2
    exit 1
fi

expected_error="Android packaging requires the SecPal frontend source at ${missing_frontend}."
if ! grep -Fq "$expected_error" "$release_log"; then
    echo "Release packaging did not fail through the frontend-source guard." >&2
    sed -n '1,200p' "$release_log" >&2
    exit 1
fi

echo "ANDROID_PACKAGING_GUARD_OK"
