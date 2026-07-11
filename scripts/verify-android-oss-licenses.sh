#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="${repo_root}/android"
apk_path="${android_dir}/app/build/outputs/apk/release/app-release-unsigned.apk"
aab_path="${android_dir}/app/build/outputs/bundle/release/app-release.aab"

cd "${android_dir}"

runtime_classpath="$(./gradlew :app:dependencies --configuration releaseRuntimeClasspath --console=plain)"
grep -Fq "com.google.firebase:firebase-messaging" <<<"${runtime_classpath}"
grep -Fq "com.google.android.gms:play-services-oss-licenses" <<<"${runtime_classpath}"

./gradlew :app:assembleRelease :app:bundleRelease --console=plain

test -f "${apk_path}"
test -f "${aab_path}"

aapt2_path="$(find "${ANDROID_HOME:?ANDROID_HOME must be set}/build-tools" -type f -name aapt2 | sort -V | tail -n 1)"
test -n "${aapt2_path}"

verification_dir="$(mktemp -d)"
trap 'rm -rf "${verification_dir}"' EXIT

"${aapt2_path}" dump resources "${apk_path}" >"${verification_dir}/apk-resources.txt"
unzip -l "${aab_path}" >"${verification_dir}/aab-contents.txt"

grep -Fq "raw/third_party_license_metadata" "${verification_dir}/apk-resources.txt"
grep -Fq "raw/third_party_licenses" "${verification_dir}/apk-resources.txt"
grep -Fq "base/res/raw/third_party_license_metadata" "${verification_dir}/aab-contents.txt"
grep -Fq "base/res/raw/third_party_licenses" "${verification_dir}/aab-contents.txt"
