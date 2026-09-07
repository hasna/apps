#!/usr/bin/env bash
# Run each test file in its own process to prevent mock.module() leakage between files.
# This is necessary because Bun 1.x shares the module cache across test files when
# running them together, causing mock.module() calls in one file to contaminate another.

set -e

# Keep unit tests hermetic even when the operator's shell is configured to target
# the production cloud API.
#
# The retired `*_MODE` / `*_STORAGE_MODE` words are INERT and select nothing
# (the adoption stripped the ratchet) — they are unset here only so no fixture
# can depend on a stale fragment from the host environment. The hosted flip is
# driven by the API URL + key pair via the ONE @hasna/contracts resolver; the
# on-box store is reachable ONLY through the deliberate local opt-in
# (HASNA_ATTACHMENTS_DB_PATH / ATTACHMENTS_DB_PATH, or HASNA_ATTACHMENTS_LOCAL=1
# / ATTACHMENTS_LOCAL=1 with no authority configured), which is unset too so
# the suite never silently reads or writes an on-box database.
unset HASNA_ATTACHMENTS_STORAGE_MODE
unset ATTACHMENTS_STORAGE_MODE
unset ATTACHMENTS_CLIENT_MODE
unset HASNA_ATTACHMENTS_MODE
unset ATTACHMENTS_MODE
unset HASNA_ATTACHMENTS_LOCAL
unset ATTACHMENTS_LOCAL
unset HASNA_ATTACHMENTS_DB_PATH
unset ATTACHMENTS_DB_PATH
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
