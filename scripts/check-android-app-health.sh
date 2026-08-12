#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <serial>" >&2
    exit 64
fi

serial="$1"
package_name="app.secpal"

if ! [[ "$serial" =~ ^[A-Za-z0-9._:-]+$ ]]; then
    echo "Android serial contains unsafe characters: ${serial}" >&2
    exit 64
fi

run_adb() {
    bash ./scripts/with-android-env.sh adb -s "$serial" "$@"
}

pid_list="$(run_adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
pid="${pid_list%% *}"
if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
    echo "SecPal process is not running on ${serial}." >&2
    exit 1
fi

activities="$(run_adb shell dumpsys activity activities 2>/dev/null | tr -d '\r' || true)"
is_main_activity_foreground=false
while IFS= read -r activity_line; do
    if [[ "$activity_line" != *"mResumedActivity"* && "$activity_line" != *"topResumedActivity"* ]]; then
        continue
    fi

    if [[ "$activity_line" == *"app.secpal/.MainActivity"* || "$activity_line" == *"app.secpal/app.secpal.MainActivity"* ]]; then
        is_main_activity_foreground=true
        break
    fi
done <<< "$activities"

if [[ "$is_main_activity_foreground" != "true" ]]; then
    echo "SecPal MainActivity is not foreground on ${serial}." >&2
    exit 1
fi

fatal_log="$(run_adb logcat -d -v brief AndroidRuntime:E '*:S' 2>/dev/null | tr -d '\r' || true)"
if [[ "$fatal_log" == *"FATAL EXCEPTION"* && "$fatal_log" == *"Process: app.secpal,"* ]]; then
    echo "A fatal exception was recorded for app.secpal." >&2
    printf '%s\n' "$fatal_log" >&2
    exit 1
fi

last_anr="$(run_adb shell dumpsys activity lastanr 2>/dev/null | tr -d '\r' || true)"
if [[ "$last_anr" == *"ANR in app.secpal"* ]]; then
    echo "An ANR was recorded for app.secpal." >&2
    printf '%s\n' "$last_anr" >&2
    exit 1
fi

echo "SecPal health check passed: serial=${serial} pid=${pid}"
