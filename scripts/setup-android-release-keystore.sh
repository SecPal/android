#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal
# SPDX-License-Identifier: MIT

set -euo pipefail
umask 077

CONFIG_DIR="${SECPAL_ANDROID_CONFIG_DIR:-$HOME/.config/secpal}"
ENV_FILE="${SECPAL_ANDROID_RELEASE_ENV_FILE:-$CONFIG_DIR/android-release.env}"
KEYSTORE_PATH="${SECPAL_ANDROID_KEYSTORE_PATH:-$CONFIG_DIR/android-upload.jks}"
KEY_ALIAS="${SECPAL_ANDROID_KEY_ALIAS:-secpal-upload}"
VERSION_CODE="${SECPAL_ANDROID_VERSION_CODE:-1}"
VERSION_NAME="${SECPAL_ANDROID_VERSION_NAME:-1.0.0}"
KEY_VALIDITY_DAYS="${SECPAL_ANDROID_KEY_VALIDITY_DAYS:-9125}"
DNAME="${SECPAL_ANDROID_KEY_DNAME:-CN=SecPal Upload Key, OU=Mobile, O=SecPal, L=Berlin, ST=Berlin, C=DE}"

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [[ -f "$KEYSTORE_PATH" ]]; then
    echo "Refusing to overwrite existing keystore: $KEYSTORE_PATH" >&2
    exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
    echo "Refusing to overwrite existing env file: $ENV_FILE" >&2
    exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
    echo "keytool not found. Install java-21-openjdk-devel and ensure JAVA_HOME is available." >&2
    exit 1
fi

random_password() {
    set +o pipefail
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32
    set -o pipefail
}

write_env_assignment() {
    local key="$1"
    local value="$2"

    printf '%s=%q\n' "$key" "$value" >>"$ENV_FILE"
}

KEYSTORE_PASSWORD="${SECPAL_ANDROID_KEYSTORE_PASSWORD:-$(random_password)}"
KEY_PASSWORD="${SECPAL_ANDROID_KEY_PASSWORD:-$(random_password)}"

keytool -genkeypair \
    -keystore "$KEYSTORE_PATH" \
    -storetype JKS \
    -storepass "$KEYSTORE_PASSWORD" \
    -keypass "$KEY_PASSWORD" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 4096 \
    -validity "$KEY_VALIDITY_DAYS" \
    -dname "$DNAME"

chmod 600 "$KEYSTORE_PATH"

: >"$ENV_FILE"
write_env_assignment "SECPAL_ANDROID_VERSION_CODE" "$VERSION_CODE"
write_env_assignment "SECPAL_ANDROID_VERSION_NAME" "$VERSION_NAME"
write_env_assignment "SECPAL_ANDROID_KEYSTORE_PATH" "$KEYSTORE_PATH"
write_env_assignment "SECPAL_ANDROID_KEYSTORE_PASSWORD" "$KEYSTORE_PASSWORD"
write_env_assignment "SECPAL_ANDROID_KEY_ALIAS" "$KEY_ALIAS"
write_env_assignment "SECPAL_ANDROID_KEY_PASSWORD" "$KEY_PASSWORD"

chmod 600 "$ENV_FILE"

echo "Created Android upload keystore: $KEYSTORE_PATH"
echo "Created Android release env file: $ENV_FILE"
echo "Back up both files securely before using them for production releases."
