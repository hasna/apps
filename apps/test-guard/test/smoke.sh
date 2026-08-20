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
#
# Runner compatibility (hasna/apps#630 remediation, cycle 1): the s16
# classification assertions drive the sentinel's FUNCTIONAL PROBE, and the
# sentinel's static chain gates the probe on the fleet install layout
# (REAL=/home/hasna/.bun/bin/bun-real, sentinel.sh:55). On a host without
# that layout — e.g. the GitHub Actions runner — the static chain fails before
# the probe runs, probe_state stays '', and every classification collapses to
# NOT ENGAGED, failing 8 of 13 assertions for a reason unrelated to the guard.
# So when the fleet layout is absent the smoke SKIPS the classification
# assertions with a documented skip line (keeping the layout-independent
# rc!=0 and wrapper-missing NOT ENGAGED checks) and exits 0; on a
# guard-installed host the full 13-check battery runs unchanged.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BATTERY="$HERE/battery.sh"

if [ ! -f "$BATTERY" ]; then
  echo "smoke: battery.sh missing at $BATTERY" >&2
  exit 2
fi

# TEST_GUARD_FLEET_REAL is a TEST-ONLY override of the fleet-layout probe (the
# smoke only stat-checks this path; the sentinel's own REAL is never touched
# by the smoke). It lets the documented skip path be exercised on a
# guard-installed host without mutating the install.
FLEET_REAL="${TEST_GUARD_FLEET_REAL:-/home/hasna/.bun/bin/bun-real}"

# Regression (publish-all-test-guard remediation): the shipped guard MUST NEVER
# source the retired .hasna/cloud runtime config — the no-cloud guard forbids
# the pattern in packed content (contracts no-cloud scan, runtime_config kind).
# Proving it at the source surface so the package cannot regress it.
CLOUD_GUARD_FAIL=0
if grep -nE '\.hasna/cloud|hasna-cloud-env' "$HERE/sentinel.sh" "$HERE/bun-wrapper.sh" "$HERE/battery.sh"; then
  echo "FAIL no-cloud-guard: retired .hasna/cloud runtime config reference found in a shipped script" >&2
  CLOUD_GUARD_FAIL=1
else
  echo "PASS no-cloud-guard: no retired .hasna/cloud runtime config reference in shipped scripts"
fi

# CLI surface regression (a6fc52c7): --help exits 0 with usage; --version
# prints the exact package version; positional $1/$2 contract unchanged.
CLI_FAIL=0
if ! "$HERE/sentinel.sh" --help >/dev/null 2>&1; then
  echo "FAIL cli-help: sentinel.sh --help did not exit 0" >&2
  CLI_FAIL=1
fi
PKG_VERSION=$(grep -m1 '"version"' "$HERE/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
ACTUAL_VERSION=$("$HERE/sentinel.sh" --version 2>/dev/null)
if [ "$ACTUAL_VERSION" != "hasna-test-guard sentinel $PKG_VERSION" ]; then
  echo "FAIL cli-version: sentinel.sh --version printed '$ACTUAL_VERSION', expected 'hasna-test-guard sentinel $PKG_VERSION'" >&2
  CLI_FAIL=1
fi
[ "$CLI_FAIL" = "0" ] && echo "PASS cli-surface: --help exits 0 and --version matches package.json"

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

if [ ! -x "$FLEET_REAL" ]; then
  # Fleet install layout absent (runner): the sentinel's static chain fails
  # before the functional probe runs, so the classification assertions are
  # untestable here. Replace each with a documented SKIP line naming the
  # assertion and the reason; the layout-independent checks (rc!=0 against
  # broken wrappers, wrapper-missing NOT ENGAGED) still run.
  echo "smoke: fleet install layout absent ($FLEET_REAL not executable) — s16 functional-probe classification assertions SKIPPED; rc!=0 and wrapper-missing NOT ENGAGED checks still run"
  sed -E 's#^ck "((s16 rc=(78|124)[^"]*alert[^"]*))".*#echo "SKIP \1 — fleet install layout absent: sentinel functional probe untestable on this host"#' "$RUNNER" > "$RUNNER.skip"
  mv "$RUNNER.skip" "$RUNNER"
fi

export BUN_TEST_GUARD_SENTINEL="$HERE/sentinel.sh"
export BUN_TEST_GUARD_WRAPPER_SOURCE="$HERE/bun-wrapper.sh"

bash "$RUNNER"
RC=$?
if [ "$CLOUD_GUARD_FAIL" = "1" ] || [ "$CLI_FAIL" = "1" ]; then
  exit 1
fi
exit "$RC"
