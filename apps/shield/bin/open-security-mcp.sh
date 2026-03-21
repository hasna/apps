#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
exec bun run "$SCRIPT_DIR/../src/mcp/index.ts" "$@"
