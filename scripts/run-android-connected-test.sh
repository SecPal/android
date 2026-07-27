#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail

if [[ $# -lt 4 ]]; then
    echo "Usage: $0 <serial> <api-level> <readiness-timeout-seconds> <gradle-argument> [...]" >&2
    exit 64
fi

serial="$1"
api_level="$2"
readiness_timeout="$3"
shift 3
gradle_args=("$@")
repo_root="$(pwd -P)"
safe_serial_pattern='^[A-Za-z0-9._:-]+$'

if ! [[ "$serial" =~ $safe_serial_pattern ]]; then
    echo "Android device serial contains unsafe characters: ${serial}" >&2
    exit 64
fi

if ! [[ "$api_level" =~ ^[0-9]+$ ]] || (( api_level <= 0 )); then
    echo "API level must be a positive integer." >&2
    exit 64
fi

if ! [[ "$readiness_timeout" =~ ^[0-9]+$ ]] || (( readiness_timeout <= 0 )); then
    echo "Readiness timeout must be a positive integer." >&2
    exit 64
fi

if [[ ! -x "${repo_root}/android/gradlew" ]]; then
    echo "Android Gradle wrapper is unavailable: ${repo_root}/android/gradlew" >&2
    exit 66
fi

if [[ ! -f "${repo_root}/scripts/wait-for-android-device.sh" ]]; then
    echo "Android device readiness script is unavailable." >&2
    exit 66
fi

attempt_log="$(mktemp "${TMPDIR:-/tmp}/secpal-android-connected-test.XXXXXX.log")"
trap 'rm -f "$attempt_log"' EXIT

run_connected_test() {
    (
        cd "${repo_root}/android"
        ANDROID_SERIAL="$serial" ./gradlew "${gradle_args[@]}"
    )
}

set +e
run_connected_test 2>&1 | tee "$attempt_log"
attempt_status=${PIPESTATUS[0]}
set -e

if (( attempt_status == 0 )); then
    exit 0
fi

if (( api_level != 37 )); then
    exit "$attempt_status"
fi

retry_reason=""
if grep -Fq "Failed to commit install session" "$attempt_log" &&
    grep -Fq "Failure calling service package: Broken pipe" "$attempt_log"; then
    retry_reason="PackageManager connection failure"
elif grep -Fq "Starting 0 tests on" "$attempt_log" &&
    grep -Fq "INSTRUMENTATION_ABORTED: System has crashed." "$attempt_log"; then
    retry_reason="pre-test system crash"
elif grep -Fq "Starting 0 tests on" "$attempt_log" &&
    grep -Fq "Test run failed to complete. No test results." "$attempt_log" &&
    grep -Fq "onError: commandError=true" "$attempt_log"; then
    retry_reason="pre-test command failure"
fi

if [[ -z "$retry_reason" ]]; then
    exit "$attempt_status"
fi

echo "Retrying API 37 instrumentation after ${retry_reason}"
bash "${repo_root}/scripts/wait-for-android-device.sh" \
    "$serial" "$readiness_timeout"
run_connected_test
