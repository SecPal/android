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

deadline=$((SECONDS + timeout_seconds))

while (( SECONDS < deadline )); do
    bash ./scripts/with-android-env.sh bash -lc "adb start-server" >/dev/null 2>&1 || true
    state="$(bash ./scripts/with-android-env.sh bash -lc "adb -s ${serial} get-state" 2>/dev/null || true)"

    if [[ "$state" == "offline" ]]; then
        bash ./scripts/with-android-env.sh bash -lc "adb reconnect offline" >/dev/null 2>&1 || true
        sleep 2
        continue
    fi

    if [[ "$state" != "device" ]]; then
        echo "waiting serial=${serial} state=${state:-missing}" >&2
        sleep 2
        continue
    fi

    wm_size="$(bash ./scripts/with-android-env.sh bash -lc "adb -s ${serial} shell wm size" 2>/dev/null | tr -d '\r' || true)"
    wm_density="$(bash ./scripts/with-android-env.sh bash -lc "adb -s ${serial} shell wm density" 2>/dev/null | tr -d '\r' || true)"
    boot_completed="$(bash ./scripts/with-android-env.sh bash -lc "adb -s ${serial} shell getprop sys.boot_completed" 2>/dev/null | tr -d '\r' || true)"
    boot_animation="$(bash ./scripts/with-android-env.sh bash -lc "adb -s ${serial} shell getprop init.svc.bootanim" 2>/dev/null | tr -d '\r' || true)"
    home_activity="$(bash ./scripts/with-android-env.sh bash -lc "adb -s ${serial} shell cmd package resolve-activity --brief android.intent.action.MAIN android.intent.category.HOME" 2>/dev/null | tr -d '\r' || true)"

    if [[ -n "$wm_size" && -n "$wm_density" ]]; then
        if [[ "$boot_completed" == "1" || "$boot_animation" == "stopped" || "$home_activity" == */* ]]; then
            echo "serial=${serial}"
            echo "$wm_size"
            echo "$wm_density"
            exit 0
        fi
    fi

    echo "waiting serial=${serial} state=device boot=${boot_completed:-missing} bootanim=${boot_animation:-missing}" >&2
    sleep 2
done

echo "Timed out waiting for usable Android device: ${serial}" >&2
exit 1
