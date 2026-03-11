#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
FRONTEND_DIR="${ROOT_DIR}/../frontend"

if [ ! -d "$FRONTEND_DIR" ]; then
  echo "❌ frontend repository not found at: $FRONTEND_DIR" >&2
  echo "Expected workspace layout: SecPal/{frontend,android}" >&2
  exit 1
fi

if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  echo "❌ frontend package.json missing at: $FRONTEND_DIR/package.json" >&2
  exit 1
fi

echo "→ Building frontend from $FRONTEND_DIR"
npm --prefix "$FRONTEND_DIR" run build

if [ ! -d "$FRONTEND_DIR/dist" ]; then
  echo "❌ frontend build completed but dist/ is missing" >&2
  exit 1
fi

echo "✅ frontend dist ready: $FRONTEND_DIR/dist"
