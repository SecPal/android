#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="${repo_root}/android"
apk_dir="${android_dir}/app/build/outputs/apk/release"
aab_path="${android_dir}/app/build/outputs/bundle/release/app-release.aab"

cd "${android_dir}"

runtime_classpath="$(./gradlew :app:dependencies --configuration releaseRuntimeClasspath --console=plain)"
grep -Fq "com.google.firebase:firebase-messaging" <<<"${runtime_classpath}"
grep -Fq "com.google.android.gms:play-services-oss-licenses" <<<"${runtime_classpath}"

./gradlew :app:assembleRelease :app:bundleRelease --console=plain

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

androidx_graphics_path_max_bytes=40000

verify_androidx_graphics_path() {
    local artifact_path="$1"
    local artifact_name="$2"
    local native_library_bytes

    native_library_bytes="$(unzip -l "${artifact_path}" | awk '
        /libandroidx\.graphics\.path\.so$/ { count += 1; total += $1 }
        END {
            if (count != 4) {
                exit 1
            }
            print total
        }
    ')" || {
        echo "Expected four libandroidx.graphics.path.so ABI entries in ${artifact_name}" >&2
        exit 1
    }

    if (( native_library_bytes > androidx_graphics_path_max_bytes )); then
        echo "libandroidx.graphics.path.so exceeds the ${androidx_graphics_path_max_bytes}-byte release budget in ${artifact_name}" >&2
        exit 1
    fi
}

verify_androidx_graphics_path "${apk_path}" "release APK"
verify_androidx_graphics_path "${aab_path}" "release AAB"

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
