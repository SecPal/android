#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="${repo_root}/android"
merged_manifest="${android_dir}/app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml"
merged_resources="${android_dir}/app/build/intermediates/merged-not-compiled-resources/release"

cd "${android_dir}"
./gradlew \
    :app:generateReleaseNetworkSecurityVerificationInputs \
    --console=plain \
    --rerun-tasks

node "${repo_root}/scripts/verify-android-network-security.mjs" \
    "${merged_manifest}" \
    "${merged_resources}"
