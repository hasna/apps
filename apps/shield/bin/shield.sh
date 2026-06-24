#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
ENTRY="$SCRIPT_DIR/../dist/cli/index.js"

if command -v node >/dev/null 2>&1; then
  exec node "$ENTRY" "$@"
fi

if command -v bun >/dev/null 2>&1; then
  exec bun run "$ENTRY" "$@"
fi

echo "shield requires Node.js or Bun to run" >&2
exit 1
