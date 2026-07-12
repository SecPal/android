#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="${repo_root}/android"
apk_dir="${android_dir}/app/build/outputs/apk/release"
aab_path="${android_dir}/app/build/outputs/bundle/release/app-release.aab"

cd "${android_dir}"

# AGP loads Tink 1.7.0 only on its build-time classpath. Its protobuf generated
# types trigger this warning while AGP produces SDK dependency metadata, but the
# app must never package Tink. Keep the protobuf opt-out scoped to this build
# process and prove that the release runtime graph does not contain it.
protobuf_unsafe_gencode_property="-Dcom.google.protobuf.use_unsafe_pre22_gencode=true"
runtime_classpath="$(./gradlew "${protobuf_unsafe_gencode_property}" :app:dependencies --configuration releaseRuntimeClasspath --console=plain)"
grep -Fq "com.google.firebase:firebase-messaging" <<<"${runtime_classpath}"
grep -Fq "com.google.android.gms:play-services-oss-licenses" <<<"${runtime_classpath}"
if grep -Fq "com.google.crypto.tink:tink" <<<"${runtime_classpath}"; then
    echo "Release runtime classpath contains build-tool-only Tink dependency" >&2
    exit 1
fi

./gradlew "${protobuf_unsafe_gencode_property}" :app:assembleRelease :app:bundleRelease --console=plain

if [[ -f "${apk_dir}/app-release.apk" ]]; then
    apk_path="${apk_dir}/app-release.apk"
elif [[ -f "${apk_dir}/app-release-unsigned.apk" ]]; then
    apk_path="${apk_dir}/app-release-unsigned.apk"
else
    echo "Release APK was not produced in ${apk_dir}" >&2
    exit 1
fi

test -f "${apk_path}"
test -f "${aab_path}"

"${repo_root}/scripts/verify-androidx-graphics-path.sh" "${apk_path}" "release APK"
"${repo_root}/scripts/verify-androidx-graphics-path.sh" "${aab_path}" "release AAB"

aapt2_path=""
aapt2_score=0

for candidate in "${ANDROID_HOME:?ANDROID_HOME must be set}/build-tools"/*/aapt2; do
    [[ -x "${candidate}" ]] || continue

    candidate_version="$(basename "$(dirname "${candidate}")")"

    if [[ ! "${candidate_version}" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        continue
    fi

    IFS=. read -r major minor patch <<<"${candidate_version}"
    candidate_score=$((10#${major} * 100000000 + 10#${minor} * 10000 + 10#${patch}))

    if (( candidate_score > aapt2_score )); then
        aapt2_path="${candidate}"
        aapt2_score=${candidate_score}
    fi
done

if [[ -z "${aapt2_path}" ]]; then
    echo "No stable aapt2 binary found under ${ANDROID_HOME}/build-tools" >&2
    exit 1
fi

verification_dir="$(mktemp -d)"
trap 'rm -rf "${verification_dir}"' EXIT

"${aapt2_path}" dump resources "${apk_path}" >"${verification_dir}/apk-resources.txt"
unzip -l "${aab_path}" >"${verification_dir}/aab-contents.txt"

grep -Fq "raw/third_party_license_metadata" "${verification_dir}/apk-resources.txt"
grep -Fq "raw/third_party_licenses" "${verification_dir}/apk-resources.txt"
grep -Fq "base/res/raw/third_party_license_metadata" "${verification_dir}/aab-contents.txt"
grep -Fq "base/res/raw/third_party_licenses" "${verification_dir}/aab-contents.txt"
