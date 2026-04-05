#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail

if [[ -z "${JAVA_HOME:-}" ]]; then
    for _jvm_candidate in \
        "/usr/lib/jvm/java-21-openjdk" \
        "/usr/lib/jvm/java-21-openjdk-amd64" \
        "/usr/lib/jvm/java-21-openjdk-arm64"; do
        if [[ -d "$_jvm_candidate" && -x "$_jvm_candidate/bin/java" ]]; then
            export JAVA_HOME="$_jvm_candidate"
            break
        fi
    done
    unset _jvm_candidate
fi

if [[ -z "${ANDROID_SDK_ROOT:-}" && -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
fi

if [[ -n "${ANDROID_SDK_ROOT:-}" && -z "${ANDROID_HOME:-}" ]]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi

if [[ -n "${JAVA_HOME:-}" && -d "$JAVA_HOME/bin" ]]; then
    export PATH="$JAVA_HOME/bin:$PATH"
fi

if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin" ]]; then
    export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
fi

if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "$ANDROID_SDK_ROOT/platform-tools" ]]; then
    export PATH="$ANDROID_SDK_ROOT/platform-tools:$PATH"
fi

exec "$@"
