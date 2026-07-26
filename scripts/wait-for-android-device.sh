#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <serial> [timeout-seconds]" >&2
    exit 64
fi

serial="$1"
timeout_seconds="${2:-240}"

if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || (( timeout_seconds <= 0 )); then
    echo "Timeout must be a positive integer." >&2
    exit 64
fi

run_adb() {
    bash ./scripts/with-android-env.sh adb "$@"
}

deadline=$((SECONDS + timeout_seconds))

while (( SECONDS < deadline )); do
    run_adb start-server >/dev/null 2>&1 || true
    state="$(run_adb -s "$serial" get-state 2>/dev/null || true)"

    if [[ "$state" == "offline" ]]; then
        run_adb reconnect offline >/dev/null 2>&1 || true
        sleep 2
        continue
    fi

    if [[ "$state" != "device" ]]; then
        echo "waiting serial=${serial} state=${state:-missing}" >&2
        sleep 2
        continue
    fi

    wm_size="$(run_adb -s "$serial" shell wm size 2>/dev/null | tr -d '\r' || true)"
    wm_density="$(run_adb -s "$serial" shell wm density 2>/dev/null | tr -d '\r' || true)"
    boot_completed="$(run_adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    boot_animation="$(run_adb -s "$serial" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r' || true)"
    home_activity="$(run_adb -s "$serial" shell cmd package resolve-activity --brief android.intent.action.MAIN android.intent.category.HOME 2>/dev/null | tr -d '\r' || true)"
    settings_ready="missing"
    if run_adb -s "$serial" shell settings get global device_provisioned >/dev/null 2>&1; then
        settings_ready="ready"
    fi

    if [[ -n "$wm_size" && -n "$wm_density" && "$boot_completed" == "1" && "$settings_ready" == "ready" ]]; then
        echo "serial=${serial}"
        echo "$wm_size"
        echo "$wm_density"
        exit 0
    fi

    echo "waiting serial=${serial} state=device boot=${boot_completed:-missing} bootanim=${boot_animation:-missing} home=${home_activity:-missing} settings=${settings_ready}" >&2
    sleep 2
done

echo "Timed out waiting for usable Android device: ${serial}" >&2
exit 1
