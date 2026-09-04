#!/usr/bin/env bash
# Run each test file in its own process to prevent mock.module() leakage between files.
# This is necessary because Bun 1.x shares the module cache across test files when
# running them together, causing mock.module() calls in one file to contaminate another.

set -e

# Keep unit tests hermetic even when the operator's shell is configured to target
# the production cloud API.
#
# Deployment modes no longer exist: HASNA_ATTACHMENTS_STORAGE_MODE / _MODE are
# retired and are a HARD ERROR when set (see core/cloud-v1.ts), so the suite
# must UNSET them rather than pin them. The client flip reads the API URL + key
# pair (see core/cloud-v1.ts:resolveStorageClient), so those are unset here too —
# otherwise the CLI/MCP tests would silently run against the real service and
# fail for environmental reasons on a clean checkout.
unset HASNA_ATTACHMENTS_STORAGE_MODE
unset HASNA_ATTACHMENTS_MODE
unset ATTACHMENTS_STORAGE_MODE
unset ATTACHMENTS_MODE
unset ATTACHMENTS_CLIENT_MODE
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
