#!/usr/bin/env bash
# hasna-test-guard sentinel (SC-00062, 2026-07-30) — INDEPENDENT of the loops
# runtime by design (same reasoning as backup_s3_freshness_check.sh: a control
# that alerts through the machinery it guards alerts nobody).
#
# Verifies the bun-test concurrency cap is actually installed and viable:
#   1. /home/hasna/.bun/bin/bun carries the wrapper marker (a `bun upgrade`
#      writes to bun-real THROUGH the wrapper and preserves it, but a fresh
#      curl-install of bun would clobber the wrapper silently — this catches it).
#   2. bun-real exists, is executable, and answers --version.
#   3. The slots directory exists.
# On any failure: posts [ALERT] to #incidents (damped: one alert per 6h per
# failure signature) and exits 1.
#
# SENTINEL_DRY_RUN=1  — print the would-be alert instead of posting (for tests).
# $1                  — optional alternate bun path to check (for tests).
# $2                  — optional alternate wrapper source (for tests).

set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"

BUN_PATH="${1:-/home/hasna/.bun/bin/bun}"
REAL="/home/hasna/.bun/bin/bun-real"
WRAPPER_SOURCE="${2:-/home/hasna/.hasna/test-guard/bun-wrapper.sh}"
# SENTINEL_GUARD_DIR is a TEST-ONLY override for exercising the queue-health
# alert path against a controlled queue (live waiters reap any alertable
# ticket planted in the real queue within seconds, making the control racy).
# Deliberately NOT HASNA_TEST_GUARD_DIR: the sentinel sets that for its canary
# probe, and honoring it here would let a stray env redirect the production
# health check — a false-pass vector.
GUARD_DIR="${SENTINEL_GUARD_DIR:-/home/hasna/.hasna/test-guard}"
# SENTINEL_PROBE_TIMEOUT is a TEST-ONLY override for the canary probe's
# timeout budget (default 120s) — lets the rc=124 classification be exercised
# without waiting out a real budget (battery section 16). Like
# SENTINEL_GUARD_DIR it is deliberately not set by production cron.
REALERT_SECS=21600

failure_signature() {
  case "$1" in
    "production queue wedged:"*) printf '%s\n' "production-queue-wedged" ;;
    *) printf '%s' "$1" | sha256sum | awk '{print $1}' ;;
  esac
}

fail=""
# Must be bound OUTSIDE the probe block: the alert block below reads it under
# `set -u`, and the static-failure path never runs the probe.
probe_state=""
if ! head -c 4096 "$BUN_PATH" 2>/dev/null | grep -q "hasna-test-guard wrapper"; then
  fail="wrapper marker missing at $BUN_PATH (bun reinstall clobbered the test-concurrency cap)"
elif [ ! -r "$WRAPPER_SOURCE" ] || ! cmp -s "$BUN_PATH" "$WRAPPER_SOURCE"; then
  fail="wrapper integrity mismatch: $BUN_PATH differs from $WRAPPER_SOURCE"
elif [ ! -x "$REAL" ] || ! "$REAL" --version >/dev/null 2>&1; then
  fail="real bun missing or broken at $REAL"
elif [ ! -d "$GUARD_DIR/slots" ]; then
  fail="slots directory missing at $GUARD_DIR/slots"
fi

# End-to-end functional probe (added 2026-07-30 after the try_slots argv
# incident: 21 false-green rc=0 runs with the marker perfectly present).
# Static presence is not evidence the cap WORKS: run a real canary suite
# through the wrapper in an isolated guard dir and require (a) rc=0,
# (b) an actual '1 pass' result, (c) the exact fleet cgroup limits, and
# (d) an 'acquired ... argv=test' guard-log line proving the semaphore engaged
# and the argv survived the scope transition.
if [ -z "$fail" ]; then
  PROBE_DIR=$(mktemp -d /tmp/test-guard-probe.XXXXXX)
  mkdir -p "$PROBE_DIR/guard/slots" "$PROBE_DIR/suite"
  cat > "$PROBE_DIR/suite/canary.test.ts" <<'EOF'
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

test("canary", () => {
  const cgroup = readFileSync("/proc/self/cgroup", "utf8").trim().split("::")[1];
  const root = `/sys/fs/cgroup${cgroup}`;

  expect(readFileSync(`${root}/memory.high`, "utf8").trim()).toBe("12884901888");
  expect(readFileSync(`${root}/memory.max`, "utf8").trim()).toBe("17179869184");
  expect(readFileSync(`${root}/memory.swap.max`, "utf8").trim()).toBe("0");
  expect(readFileSync(`${root}/pids.max`, "utf8").trim()).toBe("4096");
});
EOF
  # env -u: a caller carrying HELD/BYPASS (nested/manual run) would otherwise
  # skip acquisition, false-alert "cap silently bypassed", and burn the 6h
  # damping stamp ahead of a real alert (reviewer P3-1).
  # probe_state (ac4558ab): classification of a failed probe, worded per
  # state in the alert block below. "" stays NOT-ENGAGED (static install
  # failure or silent bypass — the cap genuinely is not engaged); "engaged"
  # means the wrapper RAN and the cap engaged/refused/queued; "unverified"
  # means no engagement evidence either way. The wrapper's own fail-closed
  # exits (78 scopes-unavailable, 75 queued to MAX_WAIT) and an external
  # timeout (124) are NOT evidence the cap is disengaged — one signal, three
  # causes, discriminated.
  probe_state=""
  probe_timeout=${SENTINEL_PROBE_TIMEOUT:-120}
  probe_out=$(cd "$PROBE_DIR/suite" && env -u HASNA_TEST_GUARD_HELD -u HASNA_TEST_GUARD_BYPASS HASNA_TEST_GUARD_DIR="$PROBE_DIR/guard" timeout "$probe_timeout" "$BUN_PATH" test 2>&1)
  probe_rc=$?
  if [ "$probe_rc" -ne 0 ]; then
    case "$probe_rc" in
      78)
        probe_state="engaged"
        fail="functional probe: canary REFUSED (rc=78): the wrapper fail-closed — systemd user scopes unavailable. The cap IS engaged and refusing unscoped test runs"
        ;;
      75)
        probe_state="engaged"
        fail="functional probe: canary queued to the wrapper's MAX_WAIT (rc=75): the cap IS engaged and serializing test runs behind live suites"
        ;;
      124)
        if grep -q "acquired .*argv=test" "$PROBE_DIR/guard/guard.log" 2>/dev/null; then
          probe_state="engaged"
          fail="functional probe: canary starved and timed out (rc=124) AFTER the guard acquired its slot — the cap IS engaged; machine saturated, probe inconclusive"
        else
          probe_state="unverified"
          fail="functional probe: canary timed out (rc=124) BEFORE guard acquisition was logged — cap engagement unverifiable (machine saturated or scope creation stalled); this is NOT evidence the cap is disengaged"
        fi
        ;;
      *)
        fail="functional probe: canary bun test exited rc=$probe_rc (output tail: $(printf '%s' "$probe_out" | tail -c 200))"
        ;;
    esac
  elif ! printf '%s' "$probe_out" | grep -q "1 pass"; then
    fail="functional probe: canary returned rc=0 WITHOUT running the test (no '1 pass' — the false-green argv failure mode)"
  elif ! grep -q "acquired .*argv=test" "$PROBE_DIR/guard/guard.log" 2>/dev/null; then
    fail="functional probe: canary ran but the guard never engaged (no acquired/argv=test in isolated guard.log — cap silently bypassed)"
  fi
  rm -rf "$PROBE_DIR"
fi

# Production-queue health (reviewer P2-2): the functional probe runs in an
# isolated dir, so a wedged PRODUCTION queue (stuck head, 4 hung suites,
# deleted queue dir mid-storm) would otherwise stay invisible while every real
# `bun test` on the box waits to rc=75. Alert if the oldest live ticket in the
# real queue has been waiting materially longer than MAX_WAIT should allow.
if [ -z "$fail" ] && [ -d "$GUARD_DIR/queue" ]; then
  MAX_WAIT_SECS=1800
  # shellcheck disable=SC1091
  [ -r "$GUARD_DIR/config" ] && . "$GUARD_DIR/config"
  # Only consider well-formed <ns>.<pid> tickets: a non-numeric filename in
  # queue/ (e.g. 'not-a-ticket') otherwise crashes the arithmetic below under
  # set -u BEFORE the alert block — the monitor itself dying silently, the
  # exact failure class this guard exists to prevent (re-review P2, 608367).
  oldest=$(find "$GUARD_DIR/queue" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null \
    | grep -E '^[0-9]+\.[0-9]+$' | sort | head -1)
  if [ -n "$oldest" ]; then
    oldest_ns=${oldest%%.*}
    oldest_pid=${oldest##*.}
    age_s=$(( ( $(date +%s%N) - oldest_ns ) / 1000000000 ))
    # Only alert on a LIVE waiter stuck past MAX_WAIT+300 — dead-owner tickets
    # are the wrapper's reaper's job and self-resolve.
    if [ -d "/proc/$oldest_pid" ] && [ "$age_s" -gt $((MAX_WAIT_SECS + 300)) ] 2>/dev/null; then
      fail="production queue wedged: oldest live ticket $oldest is ${age_s}s old (> MAX_WAIT_SECS=$MAX_WAIT_SECS + 300); slots or queue head are stuck — see fuser $GUARD_DIR/slots/slot-* and $GUARD_DIR/guard.log"
    fi
  fi
fi

if [ -n "$fail" ]; then
  if [ "$probe_state" = "engaged" ]; then
    msg="[ALERT] $(hostname) bun-test concurrency cap ENGAGED but DEGRADED: $fail. The cap is working — do NOT reinstall. Restore systemd user scopes / let load settle, then re-run the sentinel."
  elif [ "$probe_state" = "unverified" ]; then
    msg="[ALERT] $(hostname) bun-test concurrency cap engagement UNVERIFIABLE: $fail. Do NOT conclude the cap is down and do NOT reinstall; re-run the sentinel when the machine is less saturated."
  else
    msg="[ALERT] $(hostname) bun-test concurrency cap NOT ENGAGED: $fail. Concurrent bun test suites are unbounded again (the loadavg-66 / timeout-as-assertion failure mode, SC-00062). Reinstall per $GUARD_DIR/README.md"
  fi
  echo "$(date -u +%FT%TZ) FAIL: $fail" >&2
  if [ -n "${SENTINEL_DRY_RUN:-}" ]; then
    echo "DRY-RUN would post to #incidents: $msg"
  else
    signature=$(failure_signature "$fail")
    STAMP="$GUARD_DIR/sentinel-last-alert.$signature"
    now=$(date +%s); last=0
    [ -f "$STAMP" ] && last=$(cat "$STAMP" 2>/dev/null || echo 0)
    if [ $((now - last)) -ge "$REALERT_SECS" ]; then
      if timeout 60 conversations channel send incidents "$msg" --from test-guard-sentinel >/dev/null 2>&1 \
         || timeout 60 conversations send --channel incidents --from test-guard-sentinel "$msg" >/dev/null 2>&1; then
        echo "$now" > "$STAMP"
      else
        echo "$(date -u +%FT%TZ) FAIL: incidents post ALSO failed" >&2
      fi
    fi
  fi
  exit 1
fi

rm -f "$GUARD_DIR"/sentinel-last-alert.* 2>/dev/null
echo "$(date -u +%FT%TZ) ok" >> "$GUARD_DIR/sentinel.log"
exit 0
