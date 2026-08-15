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

monotonic_uptime_path="${monotonic_uptime_path:-/proc/uptime}"

read_node_monotonic_time_milliseconds() {
    local node_time

    if ! node_time="$(node -e 'process.stdout.write(String(process.hrtime.bigint() / 1000000n))')" \
        || ! [[ "$node_time" =~ ^[0-9]+$ ]]; then
        return 1
    fi
    current_time_milliseconds="$node_time"
}

read_monotonic_uptime_milliseconds() {
    local uptime_fraction
    local uptime_seconds
    local uptime_value

    if ! IFS=' ' read -r uptime_value _ < "$monotonic_uptime_path" \
        || ! [[ "$uptime_value" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
        return 1
    fi
    uptime_seconds="${BASH_REMATCH[1]}"
    uptime_fraction="${BASH_REMATCH[2]}000"
    current_time_milliseconds=$((10#$uptime_seconds * 1000 + 10#${uptime_fraction:0:3}))
}

read_current_time_milliseconds() {
    if [[ "$clock_source" == "node" ]]; then
        if ! read_node_monotonic_time_milliseconds; then
            echo "Unable to read the monotonic Node.js clock." >&2
            exit 69
        fi
        return
    fi

    if ! read_monotonic_uptime_milliseconds; then
        echo "Unable to read the monotonic system uptime clock." >&2
        exit 69
    fi
}

clock_source=""
current_time_milliseconds=0
if command -v node >/dev/null 2>&1 && read_node_monotonic_time_milliseconds; then
    clock_source="node"
elif read_monotonic_uptime_milliseconds; then
    clock_source="uptime"
else
    echo "A subsecond monotonic clock requires Node.js or system uptime support." >&2
    exit 69
fi
deadline_milliseconds=$((current_time_milliseconds + timeout_seconds * 1000))
retry_interval_milliseconds=2000

sleep_before_retry() {
    local remaining_milliseconds
    local sleep_milliseconds
    local sleep_seconds

    read_current_time_milliseconds
    remaining_milliseconds=$((deadline_milliseconds - current_time_milliseconds))
    if (( remaining_milliseconds <= 0 )); then
        return 1
    fi
    sleep_milliseconds="$retry_interval_milliseconds"
    if (( remaining_milliseconds < sleep_milliseconds )); then
        sleep_milliseconds="$remaining_milliseconds"
    fi

    printf -v sleep_seconds '%d.%03d' \
        "$((sleep_milliseconds / 1000))" \
        "$((sleep_milliseconds % 1000))"
    sleep "$sleep_seconds"
}

first_probe=true
while [[ "$first_probe" == true ]] || {
    read_current_time_milliseconds
    (( current_time_milliseconds < deadline_milliseconds ))
}; do
    first_probe=false
    run_adb start-server >/dev/null 2>&1 || true
    state="$(run_adb -s "$serial" get-state 2>/dev/null || true)"

    if [[ "$state" == "offline" ]]; then
        run_adb reconnect offline >/dev/null 2>&1 || true
        sleep_before_retry || break
        continue
    fi

    if [[ "$state" != "device" ]]; then
        echo "waiting serial=${serial} state=${state:-missing}" >&2
        sleep_before_retry || break
        continue
    fi

    wm_size="$(run_adb -s "$serial" shell wm size 2>/dev/null | tr -d '\r' || true)"
    wm_density="$(run_adb -s "$serial" shell wm density 2>/dev/null | tr -d '\r' || true)"
    boot_completed="$(run_adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    boot_animation="$(run_adb -s "$serial" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r' || true)"
    home_activity="$(run_adb -s "$serial" shell cmd package resolve-activity --brief android.intent.action.MAIN android.intent.category.HOME 2>/dev/null | tr -d '\r' || true)"
    settings_value="$(run_adb -s "$serial" shell settings get global device_provisioned 2>/dev/null | tr -d '\r' || true)"
    settings_ready="missing"
    if [[ "$settings_value" == "0" || "$settings_value" == "1" ]]; then
        settings_ready="ready"
    fi
    package_path="$(run_adb -s "$serial" shell pm path android 2>/dev/null | tr -d '\r' || true)"
    package_ready="missing"
    if [[ "$package_path" == package:* ]]; then
        package_ready="ready"
    fi

    if [[ -n "$wm_size" && -n "$wm_density" && "$boot_completed" == "1" && "$settings_ready" == "ready" && "$package_ready" == "ready" ]]; then
        echo "serial=${serial}"
        echo "$wm_size"
        echo "$wm_density"
        exit 0
    fi

    echo "waiting serial=${serial} state=device boot=${boot_completed:-missing} bootanim=${boot_animation:-missing} home=${home_activity:-missing} settings=${settings_ready} package=${package_ready}" >&2
    sleep_before_retry || break
done

echo "Timed out waiting for usable Android device: ${serial}" >&2
exit 1
