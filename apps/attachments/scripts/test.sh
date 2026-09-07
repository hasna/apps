#!/usr/bin/env bash
# Run each test file in its own process to prevent mock.module() leakage between files.
# This is necessary because Bun 1.x shares the module cache across test files when
# running them together, causing mock.module() calls in one file to contaminate another.

set -e

# Keep unit tests hermetic even when the operator's shell is configured to target
# the production cloud API.
#
# ATTACHMENTS_CLIENT_MODE is read by nothing in this codebase — it never made the
# suite hermetic. The client flip actually looks at HASNA_ATTACHMENTS_STORAGE_MODE
# / _MODE and at the API URL + key pair (see core/cloud-v1.ts:resolveStorageClient),
# so with those exported the CLI/MCP tests silently ran against the real service
# and 8 test files failed for environmental reasons on a clean checkout.
unset HASNA_ATTACHMENTS_STORAGE_MODE
unset ATTACHMENTS_CLIENT_MODE
unset HASNA_ATTACHMENTS_MODE
unset HASNA_ATTACHMENTS_API_URL
unset HASNA_ATTACHMENTS_API_KEY
unset ATTACHMENTS_API_URL
unset ATTACHMENTS_API_KEY
unset HASNA_ATTACHMENTS_API_KEY_OVERRIDE
unset HASNA_ATTACHMENTS_API_KEY_REF
unset HASNA_PROFILE
unset HASNA_TODOS_API_KEY
unset TODOS_API_KEY
unset HASNA_TODOS_API_URL
unset TODOS_API_URL
unset HASNA_SESSIONS_API_URL SESSIONS_API_URL HASNA_SESSIONS_API_KEY SESSIONS_API_KEY

# The shared credential chain has an AMBIENT macOS Keychain tier keyed by
# HASNA_STATION (else `hostname -s`). On a station that holds real fleet items
# (hasna.credentials.<app>.api-key / .api-url) that tier resolves inside unit
# tests that never set a key, so a fixture URL and the Keychain URL "select
# different service authorities" and dozens of tests fail for environmental
# reasons. Pin the account to a sentinel that owns no Keychain items so the
# suite is hermetic everywhere (#1720 validation).
export HASNA_STATION=attachments-hermetic-test

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

TEST_FILES=()
while IFS= read -r file; do TEST_FILES+=("$file"); done < <(find src scripts -type f -name "*.test.ts" | sort)

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
