#!/usr/bin/env bash
# Run each test file in its own process to prevent mock.module() leakage between files.
# This is necessary because Bun 1.x shares the module cache across test files when
# running them together, causing mock.module() calls in one file to contaminate another.

set -e

# Keep unit tests hermetic even when the operator's shell is configured to target
# the production cloud API.
#
# The contracts 0.11.1 client selects the http transport purely from the API
# URL + key pair (storage-mode variables are retired and the seam refuses
# them), so the hermetic mechanism is clearing the pair: with neither set the
# resolver stays on the local store. HOME is left intact; the fleet app-config
# disk tier only applies to the process that exports the API URL.
unset HASNA_ATTACHMENTS_API_URL
unset HASNA_ATTACHMENTS_API_KEY
unset ATTACHMENTS_API_URL
unset ATTACHMENTS_API_KEY
unset HASNA_TODOS_API_KEY
unset TODOS_API_KEY
unset HASNA_TODOS_API_URL
unset TODOS_API_URL

PASS=0
FAIL=0
EXIT_CODE=0

if bunx tsc --noEmit; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  EXIT_CODE=1
fi

COVERAGE_FLAG=""
if [[ "$1" == "--coverage" ]]; then
  COVERAGE_FLAG="--coverage"
fi

mapfile -t TEST_FILES < <(find src sdk scripts -type f -name "*.test.ts" | sort)

for file in "${TEST_FILES[@]}"; do
  if bun test $COVERAGE_FLAG "$file" 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    EXIT_CODE=1
  fi
done

echo ""
echo "Checks: $((PASS + FAIL)) total, $PASS passed, $FAIL failed"
exit $EXIT_CODE
