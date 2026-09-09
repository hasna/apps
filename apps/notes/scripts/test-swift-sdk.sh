#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
fixture_log=$(mktemp -t notes-http-fixture.XXXXXX)
fixture_pid=''
cleanup() {
  if [[ -n "$fixture_pid" ]]; then
    kill "$fixture_pid" 2>/dev/null || true
    wait "$fixture_pid" 2>/dev/null || true
  fi
  rm -f "$fixture_log"
}
trap cleanup EXIT
cmp sdk/fixtures/wire-v1.json swift/Tests/NotesLibTests/Fixtures/wire-v1.json
"${NOTES_TEST_BUN:-bun}" test/saas-http-fixture.mjs > "$fixture_log" 2>&1 &
fixture_pid=$!
for attempt in {1..50}; do
  if [[ -s "$fixture_log" ]]; then break; fi
  if ! kill -0 "$fixture_pid" 2>/dev/null; then cat "$fixture_log"; exit 1; fi
  sleep 0.1
done
fixture_url=$(head -n 1 "$fixture_log")
if [[ ! "$fixture_url" =~ ^http://127\.0\.0\.1:[0-9]+$ ]]; then cat "$fixture_log"; exit 1; fi
NOTES_FIXTURE_URL="$fixture_url" swift run --package-path swift NotesLibConformance
test "$(curl -fsS "$fixture_url/trap-count")" = '{"count":0}'
