#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
    echo "Usage: $0 <serial> [local-port] [timeout-seconds]" >&2
    exit 64
fi

serial="$1"
local_port="${2:-9223}"
timeout_seconds="${3:-60}"
package_name="app.secpal"
safe_serial_pattern='^[A-Za-z0-9._:-]+$'

if ! [[ "$serial" =~ $safe_serial_pattern ]]; then
    echo "Android serial contains unsafe characters: ${serial}" >&2
    exit 64
fi

if ! [[ "$local_port" =~ ^[0-9]+$ ]] || (( local_port < 1024 || local_port > 65535 )); then
    echo "Local CDP port must be an integer within 1024-65535." >&2
    exit 64
fi

if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || (( timeout_seconds <= 0 || timeout_seconds > 300 )); then
    echo "Timeout must be an integer within 1-300 seconds." >&2
    exit 64
fi

run_adb() {
    bash ./scripts/with-android-env.sh adb -s "$serial" "$@"
}

deadline=$((SECONDS + timeout_seconds))
last_pid=""
last_socket=""

while (( SECONDS < deadline )); do
    pid_list="$(run_adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
    pid="${pid_list%% *}"

    if [[ "$pid" =~ ^[0-9]+$ ]]; then
        socket="webview_devtools_remote_${pid}"
        unix_sockets="$(run_adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' || true)"
        last_pid="$pid"
        last_socket="$socket"

        if [[ "$unix_sockets" == *"@${socket}"* ]]; then
            run_adb forward --remove "tcp:${local_port}" >/dev/null 2>&1 || true
            run_adb forward "tcp:${local_port}" "localabstract:${socket}" >/dev/null

            target_list="$(curl --fail --silent --show-error --max-time 2 \
                "http://127.0.0.1:${local_port}/json/list" 2>/dev/null || true)"
            if node -e '
                try {
                  const targets = JSON.parse(process.argv[1]);
                  process.exit(Array.isArray(targets) && targets.some((target) => target?.type === "page") ? 0 : 1);
                } catch {
                  process.exit(1);
                }
              ' "$target_list"; then
                echo "serial=${serial}"
                echo "pid=${pid}"
                echo "socket=${socket}"
                echo "debugger=http://127.0.0.1:${local_port}/json/list"
                exit 0
            fi
        fi
    fi

    sleep 1
done

run_adb forward --remove "tcp:${local_port}" >/dev/null 2>&1 || true
echo "Timed out waiting for the SecPal WebView debugger: serial=${serial} pid=${last_pid:-missing} socket=${last_socket:-missing}" >&2
exit 1
