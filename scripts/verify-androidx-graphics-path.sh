#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

set -euo pipefail

artifact_path="${1:?artifact path is required}"
artifact_name="${2:?artifact name is required}"
max_bytes=40000

native_library_bytes="$(unzip -l "${artifact_path}" | awk '
    /libandroidx\.graphics\.path\.so$/ {
        path_parts = split($4, path, "/")
        abi = path[path_parts - 1]
        count += 1
        abi_count[abi] += 1
        total += $1
    }
    END {
        if (count != 4 ||
            abi_count["arm64-v8a"] != 1 ||
            abi_count["armeabi-v7a"] != 1 ||
            abi_count["x86"] != 1 ||
            abi_count["x86_64"] != 1) {
            exit 1
        }
        print total
    }
')" || {
    echo "Expected one AndroidX graphics-path library for each supported ABI in ${artifact_name}" >&2
    exit 1
}

if (( native_library_bytes > max_bytes )); then
    echo "libandroidx.graphics.path.so exceeds the ${max_bytes}-byte release budget in ${artifact_name}" >&2
    exit 1
fi
