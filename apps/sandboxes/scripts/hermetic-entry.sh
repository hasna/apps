#!/bin/sh
set -eu

/runtime/bun build src/index.ts --outfile /tmp/sandboxes-hermetic-index.js --target bun --format esm >/dev/null
if /usr/bin/grep -E 'from "(node:(net|dns|http|https|tls|child_process)|pg|postgres|@aws-sdk/|e2b|daytona)' /tmp/sandboxes-hermetic-index.js >/dev/null; then
  echo "hermetic SDK bundle contains a forbidden production dependency" >&2
  exit 1
fi

exec /runtime/bun test \
  --preload ./tests/hermetic-preload.ts \
  tests/hermetic.test.ts \
  tests/bounded-operations.test.ts \
  tests/golden-c0dd4b-compatibility.test.ts \
  tests/validation.test.ts \
  tests/service.test.ts \
  tests/storage-conformance.test.ts \
  tests/object-store.test.ts
