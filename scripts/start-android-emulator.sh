#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <avd-name> [console-port]" >&2
    exit 64
fi

avd_name="$1"
console_port="${2:-5570}"

if ! [[ "$console_port" =~ ^[0-9]+$ ]]; then
    echo "Console port must be numeric." >&2
    exit 64
fi

if (( console_port < 5554 || console_port > 5680 || console_port % 2 != 0 )); then
    echo "Console port must be an even integer within 5554-5680." >&2
    exit 64
fi

adb_port=$((console_port + 1))
serial="emulator-${console_port}"
runtime_dir="${TMPDIR:-/tmp}/secpal-android-emulators"
log_path="${runtime_dir}/${avd_name}-${console_port}.log"
pid_path="${runtime_dir}/${avd_name}-${console_port}.pid"
android_avd_home="${ANDROID_AVD_HOME:-}"
gpu_mode="${SECPAL_ANDROID_EMULATOR_GPU_MODE:-host}"
window_mode="${SECPAL_ANDROID_EMULATOR_WINDOW_MODE:-qt-hide-window}"

if [[ -z "$android_avd_home" ]]; then
    if [[ -d "$HOME/.config/.android/avd" ]]; then
        android_avd_home="$HOME/.config/.android/avd"
    else
        android_avd_home="$HOME/.android/avd"
    fi
fi

if [[ ! -f "${android_avd_home}/${avd_name}.ini" ]]; then
    echo "AVD metadata not found: ${android_avd_home}/${avd_name}.ini" >&2
    exit 66
fi

case "${window_mode}" in
    qt-hide-window)
        window_flag="-qt-hide-window"
        ;;
    no-window)
        window_flag="-no-window"
        ;;
    *)
        echo "Unsupported window mode: ${window_mode}" >&2
        exit 64
        ;;
esac

export ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL="${ANDROID_EMULATOR_WAIT_TIME_BEFORE_KILL:-2}"
mkdir -p "${runtime_dir}"

# Keep the default renderer and explicit ports predictable for automation.
bash ./scripts/with-android-env.sh bash -lc "
  adb disconnect ${serial} >/dev/null 2>&1 || true
  nohup env ANDROID_AVD_HOME='${android_avd_home}' emulator @${avd_name} \
    -wipe-data \
    -no-snapshot \
    -no-boot-anim \
    -no-audio \
    ${window_flag} \
    -gpu ${gpu_mode} \
    -no-metrics \
    -ports ${console_port},${adb_port} \
    > '${log_path}' 2>&1 < /dev/null &
  echo \$! > '${pid_path}'
"

echo "serial=${serial}"
echo "log=${log_path}"
echo "pid=$(cat "${pid_path}")"
