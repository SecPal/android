#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
FRONTEND_DIR="${SECPAL_ANDROID_FRONTEND_DIR:-${ROOT_DIR}/../frontend}"
ANDROID_STRINGS_XML="${ROOT_DIR}/android/app/src/main/res/values/strings.xml"
FRONTEND_REVISION_FILE="${ROOT_DIR}/android/frontend-revision.txt"

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "❌ frontend repository not found at: $FRONTEND_DIR" >&2
  echo "Expected workspace layout: SecPal/{frontend,android}" >&2
  exit 1
fi

if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  echo "❌ frontend package.json missing at: $FRONTEND_DIR/package.json" >&2
  exit 1
fi

if [ ! -f "$ANDROID_STRINGS_XML" ]; then
  echo "❌ Android strings.xml missing at: $ANDROID_STRINGS_XML" >&2
  exit 1
fi

if [ ! -f "$FRONTEND_REVISION_FILE" ]; then
  echo "❌ pinned frontend revision missing at: $FRONTEND_REVISION_FILE" >&2
  exit 1
fi

EXPECTED_FRONTEND_REVISION="$(awk '/^[0-9a-f]{40}$/ { print }' "$FRONTEND_REVISION_FILE")"
if [[ ! "$EXPECTED_FRONTEND_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "❌ $FRONTEND_REVISION_FILE must contain exactly one full lowercase commit SHA." >&2
  exit 1
fi

if ! ACTUAL_FRONTEND_REVISION="$(git -C "$FRONTEND_DIR" rev-parse --verify 'HEAD^{commit}')"; then
  echo "❌ could not resolve the frontend checkout revision at: $FRONTEND_DIR" >&2
  exit 1
fi

if [ "$ACTUAL_FRONTEND_REVISION" != "$EXPECTED_FRONTEND_REVISION" ]; then
  echo "❌ frontend checkout $ACTUAL_FRONTEND_REVISION does not match pinned revision $EXPECTED_FRONTEND_REVISION." >&2
  exit 1
fi

FRONTEND_DIRTY_STATE="$(git -C "$FRONTEND_DIR" status --short --untracked-files=all -- . ':(exclude)node_modules' ':(exclude)dist')"
if [ -n "$FRONTEND_DIRTY_STATE" ]; then
  echo "❌ frontend checkout is not clean at pinned revision $EXPECTED_FRONTEND_REVISION:" >&2
  printf '%s\n' "$FRONTEND_DIRTY_STATE" >&2
  exit 1
fi

FRONTEND_SOURCE_DATE_EPOCH="$(git -C "$FRONTEND_DIR" show -s --format=%ct "$EXPECTED_FRONTEND_REVISION")"
if [[ ! "$FRONTEND_SOURCE_DATE_EPOCH" =~ ^(0|[1-9][0-9]*)$ ]]; then
  echo "❌ frontend commit timestamp is invalid for $EXPECTED_FRONTEND_REVISION." >&2
  exit 1
fi

API_BASE_URL="$({ sed -n 's@.*<string name="api_base_url">\(.*\)</string>.*@\1@p' "$ANDROID_STRINGS_XML" | head -n 1; } || true)"

if [ -z "$API_BASE_URL" ]; then
  echo "❌ Could not read api_base_url from: $ANDROID_STRINGS_XML" >&2
  exit 1
fi

echo "→ Building frontend from $FRONTEND_DIR"
echo "→ Using pinned frontend revision: $EXPECTED_FRONTEND_REVISION"
echo "→ Using Android API base URL: $API_BASE_URL"
(
  cd "$FRONTEND_DIR"
  SOURCE_DATE_EPOCH="$FRONTEND_SOURCE_DATE_EPOCH" \
    VITE_API_URL="$API_BASE_URL" \
    npm run build:android
)

if [ ! -d "$FRONTEND_DIR/dist" ]; then
  echo "❌ frontend build completed but dist/ is missing" >&2
  exit 1
fi

FRONTEND_INDEX_HTML="$FRONTEND_DIR/dist/index.html"

if [ ! -f "$FRONTEND_INDEX_HTML" ]; then
  echo "❌ frontend build completed but index.html is missing at: $FRONTEND_INDEX_HTML" >&2
  exit 1
fi

echo "→ Verifying Android frontend build metadata"
node "$ROOT_DIR/scripts/verify-android-frontend-build.mjs" "$FRONTEND_DIR/dist"

echo "→ Packaging Android native auth bridge for $FRONTEND_INDEX_HTML"
node "$ROOT_DIR/scripts/inject-native-auth-bridge.mjs" \
  "$FRONTEND_INDEX_HTML" \
  "$ANDROID_STRINGS_XML"

echo "✅ frontend dist ready: $FRONTEND_DIR/dist"
