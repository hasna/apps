#!/usr/bin/env bash
# Smoke test for @hasna/test-guard: runs battery section 16 (ac4558ab —
# sentinel canary-failure classification: rc=78 engaged-degraded, rc=124
# engaged/unverified, wrapper-missing NOT ENGAGED) against the REPO copies of
# sentinel.sh and bun-wrapper.sh.
#
# Section 16 is deliberately hermetic: it drives the sentinel with fake
# wrappers and SENTINEL_PROBE_TIMEOUT=3, so it needs no systemd user scope,
# no real bun test, and no machine guard install — only bash, grep, sed,
# mktemp, and the sentinel's static check against /home/hasna/.bun/bin/bun-real.
#
# The full battery (battery.sh) is the 53-check regression sweep for a station
# with the guard installed; run it separately after any wrapper/sentinel change.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BATTERY="$HERE/battery.sh"

if [ ! -f "$BATTERY" ]; then
  echo "smoke: battery.sh missing at $BATTERY" >&2
  exit 2
fi

RUNNER="$(mktemp /tmp/tg-smoke.XXXXXX)"
trap 'rm -f "$RUNNER"' EXIT

# Compose: battery preamble (set -u, B/BR/W, pass/failn, ck, WRAPPER_SOURCE,
# SEN — everything section 16 depends on) plus section 16 through the
# battery's own summary/exit. Marker-anchored, not line-numbered, so the
# composition survives edits to either half of battery.sh.
{
  sed -n '1,/^SEN=/p' "$BATTERY"
  sed -n '/^# 16 /,$p' "$BATTERY"
} > "$RUNNER"

export BUN_TEST_GUARD_SENTINEL="$HERE/sentinel.sh"
export BUN_TEST_GUARD_WRAPPER_SOURCE="$HERE/bun-wrapper.sh"

bash "$RUNNER"
