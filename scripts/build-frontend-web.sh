#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
FRONTEND_DIR="${ROOT_DIR}/../frontend"
ANDROID_STRINGS_XML="${ROOT_DIR}/android/app/src/main/res/values/strings.xml"

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

API_BASE_URL="$({ sed -n 's@.*<string name="api_base_url">\(.*\)</string>.*@\1@p' "$ANDROID_STRINGS_XML" | head -n 1; } || true)"

if [ -z "$API_BASE_URL" ]; then
  echo "❌ Could not read api_base_url from: $ANDROID_STRINGS_XML" >&2
  exit 1
fi

echo "→ Building frontend from $FRONTEND_DIR"
echo "→ Using Android API base URL: $API_BASE_URL"
(
  cd "$FRONTEND_DIR"
  VITE_API_URL="$API_BASE_URL" npm run build
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

echo "→ Injecting Android native auth bootstrap into $FRONTEND_INDEX_HTML"
node "$ROOT_DIR/scripts/inject-native-auth-bridge.mjs" \
  "$FRONTEND_INDEX_HTML" \
  "$ANDROID_STRINGS_XML"

echo "✅ frontend dist ready: $FRONTEND_DIR/dist"
