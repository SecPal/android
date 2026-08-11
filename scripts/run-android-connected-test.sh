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

capture_connected_test() {
    set +e
    run_connected_test 2>&1 | tee "$attempt_log"
    attempt_status=${PIPESTATUS[0]}
    set -e
}

is_maven_central_http_403() {
    local line
    local pending_maven_central_request=false

    while IFS= read -r line; do
        if [[ "$line" == *"Could not GET '"* ]] ||
            [[ "$line" == *"Could not get resource '"* ]]; then
            if [[ "$line" == *"https://repo.maven.apache.org/maven2/"* ]]; then
                if [[ "$line" == *"Received status code 403 from server: Forbidden"* ]]; then
                    return 0
                fi
                pending_maven_central_request=true
            else
                pending_maven_central_request=false
            fi
        elif [[ "$line" == *"Received status code "* ]]; then
            if [[ "$pending_maven_central_request" == "true" ]] &&
                [[ "$line" == *"Received status code 403 from server: Forbidden"* ]]; then
                return 0
            fi
            pending_maven_central_request=false
        fi
    done < "$attempt_log"

    return 1
}

attempt_status=0
capture_connected_test

if (( attempt_status == 0 )); then
    exit 0
fi

if is_maven_central_http_403; then
    echo "Retrying Gradle after transient Maven Central HTTP 403"
    capture_connected_test
    if (( attempt_status == 0 )); then
        exit 0
    fi
fi

if (( api_level != 37 )); then
    exit "$attempt_status"
fi

classify_api37_failure() {
    retry_key=""
    retry_reason=""
    reboot_before_retry=false

    if grep -Fq "Starting 0 tests on" "$attempt_log" &&
        grep -Fq "Failed to install-write all apks" "$attempt_log"; then
        retry_key="package-manager-install-write"
        retry_reason="PackageManager install-write failure"
        reboot_before_retry=true
    elif grep -Fq "Failure calling service package: Broken pipe" "$attempt_log" && {
        grep -Fq "Failed to commit install session" "$attempt_log" || {
            grep -Fq "Starting 0 tests on" "$attempt_log" &&
                grep -Fq "Failed to install split APK(s)" "$attempt_log"
        }
    }; then
        retry_key="package-manager-broken-pipe"
        retry_reason="PackageManager connection failure"
        reboot_before_retry=true
    elif {
        grep -Fq "Failed to install split APK(s)" "$attempt_log" &&
            grep -Fq "Can't find service: package" "$attempt_log"
    }; then
        retry_key="package-manager-service-unavailable"
        retry_reason="PackageManager connection failure"
        reboot_before_retry=true
    elif grep -Fq "Starting 0 tests on" "$attempt_log" &&
        grep -Fq "INSTRUMENTATION_ABORTED: System has crashed." "$attempt_log"; then
        retry_key="pre-test-system-crash"
        retry_reason="pre-test system crash"
        reboot_before_retry=true
    elif grep -Fq "Starting 0 tests on" "$attempt_log" &&
        grep -Fq \
            "Test run failed to complete. No test results. onError: commandError=true message=" \
            "$attempt_log"; then
        retry_key="zero-test-command-error"
        retry_reason="zero-test command error"
        reboot_before_retry=true
    fi
}

recover_api37_failure() {
    echo "Retrying API 37 instrumentation after ${retry_reason}"
    if [[ "$reboot_before_retry" == "true" ]]; then
        echo "Rebooting API 37 emulator before retrying (${retry_reason})"
        bash "${repo_root}/scripts/with-android-env.sh" \
            adb -s "$serial" reboot
    fi
    bash "${repo_root}/scripts/wait-for-android-device.sh" \
        "$serial" "$readiness_timeout"
}

recovered_api37_failures=()

while (( attempt_status != 0 )); do
    classify_api37_failure
    if [[ -z "$retry_key" ]]; then
        exit "$attempt_status"
    fi

    for recovered_failure in "${recovered_api37_failures[@]}"; do
        if [[ "$recovered_failure" == "$retry_key" ]]; then
            exit "$attempt_status"
        fi
    done

    recovered_api37_failures+=("$retry_key")
    recover_api37_failure
    capture_connected_test
done

exit 0
