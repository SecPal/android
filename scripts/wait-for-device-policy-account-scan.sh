#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: $0 <device-serial> [timeout-seconds]" >&2
    exit 64
fi

serial="$1"
timeout_seconds="${2:-60}"
ready_marker="Finished calculating hasIncompatibleAccountsTask"

if ! [[ "$serial" =~ ^[A-Za-z0-9._:-]+$ ]]; then
    echo "Device serial contains unsafe characters: ${serial}" >&2
    exit 64
fi

if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] \
    || (( timeout_seconds < 1 || timeout_seconds > 600 )); then
    echo "Timeout must be an integer within 1-600 seconds." >&2
    exit 64
fi

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
    device_policy_log="$(
        bash ./scripts/with-android-env.sh adb -s "$serial" \
            logcat -d -b system -s DevicePolicyManager:I '*:S' 2>/dev/null || true
    )"
    if grep -Fq "$ready_marker" <<<"$device_policy_log"; then
        echo "Device-policy account compatibility scan completed: ${serial}"
        exit 0
    fi
    sleep 1
done

echo "Timed out waiting for the device-policy account compatibility scan: ${serial}" >&2
bash ./scripts/with-android-env.sh adb -s "$serial" shell dumpsys account >&2 || true
bash ./scripts/with-android-env.sh adb -s "$serial" \
    logcat -d -b system -s DevicePolicyManager:I '*:S' >&2 || true
exit 1
