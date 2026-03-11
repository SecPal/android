#!/bin/bash
# SPDX-FileCopyrightText: 2025 SecPal
# SPDX-License-Identifier: MIT

# Domain Policy Enforcement Script
# Validates that ONLY secpal.app and secpal.dev are used
# ZERO TOLERANCE for other domains

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Domain Policy Check ===${NC}"
echo "Allowed: secpal.app, secpal.dev"
echo "Forbidden: secpal.com, secpal.org, secpal.net, secpal.io, secpal.example, ANY other"
echo ""

# Search for secpal domains and flag every line that contains any forbidden
# domain, even if the same line also mentions an allowed domain.
matches=$(grep -r -n -E "secpal\.[A-Za-z0-9.-]+" \
    --include="*.md" \
    --include="*.yaml" \
    --include="*.yml" \
    --include="*.json" \
    --include="*.sh" \
    --include="*.ts" \
    --include="*.tsx" \
    --include="*.js" \
    --include="*.jsx" \
    --include="*.html" \
    --include="*.kt" \
    --include="*.java" \
    --include="*.xml" \
    --include="*.gradle" \
    --include="*.kts" \
    --include="*.properties" \
    --exclude-dir=".git" \
    --exclude-dir="node_modules" \
    --exclude-dir="vendor" \
    . 2>/dev/null | \
    grep -v -- "check-domains.sh" | \
    grep -v -- "Forbidden:" | \
    grep -v -- "FORBIDDEN:" | \
    grep -v -- '- "secpal\.' | \
    grep -v -- '^[[:space:]]*- \[' || true)

violations=$(printf '%s\n' "$matches" | grep -E "secpal\.(com|org|net|io|example)" || true)

if [[ -z "$violations" ]]; then
    echo -e "${GREEN}✅ Domain Policy Check PASSED${NC}"
    echo "All domains use secpal.app or secpal.dev"
    exit 0
else
    echo -e "${RED}❌ Domain Policy Check FAILED${NC}"
    echo ""
    echo "Found forbidden domains:"
    echo "$violations"
    echo ""
    echo -e "${YELLOW}Policy:${NC}"
    echo "  - secpal.app: Production services, ALL emails"
    echo "  - secpal.dev: Development, testing, examples, docs"
    echo "  - FORBIDDEN: secpal.com, secpal.org, secpal.net, secpal.io, secpal.example"
    echo ""
    echo "Fix these violations before committing."
    exit 1
fi
