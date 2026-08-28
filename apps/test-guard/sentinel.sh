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
# On a clobber (marker missing / integrity mismatch) the sentinel now AUTO-
# REARMS (row 7112181b): it restores the wrapper from the package source and
# re-pins bun-real to the fleet-pinned version (sha-verified) instead of only
# alerting — then requires the full static chain AND the functional canary to
# pass before it may exit 0. Fail-closed: a rearm that cannot produce a
# verified wrapper and pinned bun-real keeps the alert path (exit 1).
# On any other failure: posts [ALERT] to #incidents (damped: one alert per 6h
# per failure signature) and exits 1.
#
# SENTINEL_DRY_RUN=1  — print the would-be alert instead of posting (for tests).
# $1                  — optional alternate bun path to check (for tests).
# $2                  — optional alternate wrapper source (for tests).
# SENTINEL_REAL_BUN, SENTINEL_PINNED_VERSION, SENTINEL_PINNED_SHA256,
# SENTINEL_PINNED_URL, SENTINEL_PINNED_SUMS_URL — TEST-ONLY overrides (same
# seam class as SENTINEL_GUARD_DIR): the rearm regression (battery section 17)
# exercises a temp-dir COPY of the bin layout and must never touch the live
# install or the network.

set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"

# VERSION is DERIVED from the package.json beside the script (rows 1804474f /
# b335a922): a wave bumping package.json must flow into --version with no
# manual edit — the prior static constant was the versioning runtime-export
# drift that failed wave PR 791 (the packed artifact carried 0.0.2 while
# package.json was 0.0.3). The sentinel guards bun, so the read uses POSIX
# tools only (grep/sed — the established shape, same as test/smoke.sh); no
# bun/node/jq dependency at read time. A standalone copy WITHOUT a package.json
# beside it fails closed on the version surface (--version exits non-zero with
# a clear message) instead of silently reporting a possibly-stale version —
# the fleet install at ~/.hasna/test-guard is exactly such a copy, and the
# main probe below does not depend on VERSION.
# Release-review P1: a package-manager global install invokes the bin through
# a symlink (e.g. ~/.bun/bin/test-guard ->
# .../node_modules/@hasna/test-guard/sentinel.sh), so the package.json must be
# resolved BESIDE THE REAL SCRIPT, not beside the symlink. readlink -f is
# GNU-only; use a portable readlink chain. A standalone copy with no
# package.json anywhere on the resolved chain still fails closed below.
SELF="$0"
while [ -L "$SELF" ]; do
  LINK=$(readlink "$SELF") 2>/dev/null || break
  [ -n "$LINK" ] || break
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd)" || SCRIPT_DIR=""
VERSION=""
if [ -n "$SCRIPT_DIR" ] && [ -r "$SCRIPT_DIR/package.json" ]; then
  VERSION=$(grep -m1 '"version"' "$SCRIPT_DIR/package.json" 2>/dev/null \
    | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi

# CLI surface: --help / --version as the FIRST argument only; the positional
# $1/$2 contract (alternate bun path / wrapper source, for tests) is unchanged.
case "${1:-}" in
  --help)
    cat <<'EOF'
Usage: sentinel.sh [--help|--version] [bun-path] [wrapper-source]

hasna-test-guard sentinel (SC-00062) — verifies the bun-test concurrency cap
is installed and viable (wrapper marker, bun-real, slots dir, e2e canary),
and auto-rearms a clobbered install (restores the wrapper from the package
source and re-pins bun-real to the fleet-pinned version, sha-verified).

  --help             show this help and exit
  --version          print the sentinel version and exit
  bun-path           optional alternate bun to check (tests)
  wrapper-source     optional alternate wrapper source (tests)

Env: SENTINEL_DRY_RUN=1 prints the would-be alert instead of posting.
Test-only overrides (never set by production cron): SENTINEL_GUARD_DIR,
SENTINEL_PROBE_TIMEOUT, SENTINEL_REAL_BUN, SENTINEL_PINNED_VERSION,
SENTINEL_PINNED_SHA256, SENTINEL_PINNED_URL, SENTINEL_PINNED_SUMS_URL.
EOF
    exit 0
    ;;
  --version)
    if [ -z "$VERSION" ]; then
      printf '%s\n' "hasna-test-guard sentinel: VERSION unavailable — package.json not found or unreadable beside $0; refusing to report a possibly-stale version" >&2
      exit 1
    fi
    printf '%s\n' "hasna-test-guard sentinel ${VERSION}"
    exit 0
    ;;
esac

BUN_PATH="${1:-/home/hasna/.bun/bin/bun}"
# SENTINEL_REAL_BUN is a TEST-ONLY override (same seam class as
# SENTINEL_GUARD_DIR): the rearm regression (battery section 17) exercises a
# temp-dir COPY of the bin layout and must never touch the live bun-real.
REAL="${SENTINEL_REAL_BUN:-/home/hasna/.bun/bin/bun-real}"
# SENTINEL_GUARD_DIR is a TEST-ONLY override for exercising the queue-health
# alert path against a controlled queue (live waiters reap any alertable
# ticket planted in the real queue within seconds, making the control racy).
# Deliberately NOT HASNA_TEST_GUARD_DIR: the sentinel sets that for its canary
# probe, and honoring it here would let a stray env redirect the production
# health check — a false-pass vector. The DEFAULT guard home is now resolved
# through @hasna/paths (XDG home migration, task P3.3) by resolve_guard_dir
# below; the exact-app override still wins first.
# The version read above deliberately avoids bun (this script guards bun), but
# the guard-home default MAY consult the resolver CLI — itself a bun binary —
# when it is present; a missing or unrunnable resolver falls back to the legacy
# home so the sentinel can still detect a clobbered bun.
resolve_guard_dir() {
  local resolved="" legacy
  legacy="${HOME:-/home/hasna}/.hasna/test-guard"
  if command -v paths >/dev/null 2>&1; then
    resolved=$(timeout 5 paths --app test-guard --kind state 2>/dev/null)
    [ -n "$resolved" ] || resolved=""
  fi
  # Adopt the resolver home only when the operator pointed the state kind
  # there (HASNA_STATE_HOME) or the resolved home already holds guard state —
  # an existing legacy install never becomes invisible on upgrade.
  if [ -n "$resolved" ] && { [ -n "${HASNA_STATE_HOME:-}" ] \
      || [ -d "$resolved/slots" ] || [ -f "$resolved/guard.log" ] || [ -f "$resolved/sentinel.log" ]; }; then
    printf '%s\n' "$resolved"
  else
    printf '%s\n' "$legacy"
  fi
}
GUARD_DIR="${SENTINEL_GUARD_DIR:-$(resolve_guard_dir)}"
# The sentinel restores the wrapper from the package source copy kept in the
# guard home (the live install dir); WRAPPER_SOURCE follows the resolved home.
WRAPPER_SOURCE="${2:-$GUARD_DIR/bun-wrapper.sh}"
# SENTINEL_PROBE_TIMEOUT is a TEST-ONLY override for the canary probe's
# timeout budget (default 120s) — lets the rc=124 classification be exercised
# without waiting out a real budget (battery section 16). Like
# SENTINEL_GUARD_DIR it is deliberately not set by production cron.
REALERT_SECS=21600

# Fleet-pinned bun for auto-rearm (row 7112181b). When the curl installer
# clobbers the wrapper, rearm restores it from the package source and re-pins
# bun-real to PINNED_BUN_VERSION, verified against PINNED_BUN_SHA256 — the
# sha256 of the EXTRACTED binary, recorded 2026-08-21 from the fleet
# install (prefix 37141662ebed915a, matching the investigate-phase finding;
# measured 2026-08-21 to be the aarch64 build the bun.sh installer installs
# on this machine). The asset is derived from the machine arch exactly like
# the bun installer's own probe (aarch64; x86_64 with the AVX2 split), and
# the download is verified BOTH against the release's published SHASUMS256.txt
# AND against the pinned sha — any mismatch fails closed (nothing is ever
# promoted unverified). A different-arch machine's installer produces a build
# whose sha differs from this pin; on such a host rearm fails closed into the
# alert path (the pre-fix behavior) until an operator sets the matching
# PINNED_BUN_SHA256 via $GUARD_DIR/config. Overridable via $GUARD_DIR/config
# (operator surface); SENTINEL_PINNED_* are TEST-ONLY overrides (same seam
# class as SENTINEL_GUARD_DIR).
PINNED_BUN_VERSION="1.3.14"
PINNED_BUN_SHA256="37141662ebed915a2ab89313156e455e2a1374395f5f6760d06407f49406f086"
PINNED_BUN_ASSET=""
case "$(uname -m)" in
  aarch64|arm64) PINNED_BUN_ASSET="bun-linux-aarch64.zip" ;;
  x86_64)
    if grep -q avx2 /proc/cpuinfo 2>/dev/null; then
      PINNED_BUN_ASSET="bun-linux-x64.zip"
    else
      PINNED_BUN_ASSET="bun-linux-x64-baseline.zip"
    fi
    ;;
esac
PINNED_BUN_ZIP_URL="https://github.com/oven-sh/bun/releases/download/bun-v${PINNED_BUN_VERSION}/${PINNED_BUN_ASSET}"
PINNED_BUN_SUMS_URL="https://github.com/oven-sh/bun/releases/download/bun-v${PINNED_BUN_VERSION}/SHASUMS256.txt"
[ -r "$GUARD_DIR/config" ] && . "$GUARD_DIR/config"
PINNED_BUN_VERSION="${SENTINEL_PINNED_VERSION:-$PINNED_BUN_VERSION}"
PINNED_BUN_SHA256="${SENTINEL_PINNED_SHA256:-$PINNED_BUN_SHA256}"
PINNED_BUN_ASSET="${SENTINEL_PINNED_ASSET:-$PINNED_BUN_ASSET}"
PINNED_BUN_ZIP_URL="${SENTINEL_PINNED_URL:-$PINNED_BUN_ZIP_URL}"
PINNED_BUN_SUMS_URL="${SENTINEL_PINNED_SUMS_URL:-$PINNED_BUN_SUMS_URL}"

failure_signature() {
  case "$1" in
    "production queue wedged:"*) printf '%s\n' "production-queue-wedged" ;;
    *) printf '%s' "$1" | sha256sum | awk '{print $1}' ;;
  esac
}

# ---- auto-rearm (row 7112181b) ----
# The clobber classes are marker-absent and integrity-mismatch (rearmable=1):
# a fresh curl-install of bun replaces the wrapper with a real ELF. Rearm
# restores the wrapper from the package source and re-pins bun-real to the
# pinned version, then the sentinel re-runs the FULL static chain AND the
# functional canary probe before it may exit 0. Fail-closed: a rearm that
# cannot produce a verified wrapper and pinned bun-real keeps the alert path.
# All mutations are atomic (.new + mv -f over the target path): the wrapper
# inode is not held by a running process and bunx symlinks point at the path,
# not the inode, so they keep working; a running suite keeps its old bun-real
# inode (mv-over-held-inode). A lock serializes concurrent rearms (cron vs a
# manual sentinel run); the loser defers to the next 20-minute firing.

fail=""
# Must be bound OUTSIDE the probe block: the alert block below reads it under
# `set -u`, and the static-failure path never runs the probe.
probe_state=""
rearmable=0

static_check() {
  fail=""
  rearmable=0
  if ! head -c 4096 "$BUN_PATH" 2>/dev/null | grep -q "hasna-test-guard wrapper"; then
    fail="wrapper marker missing at $BUN_PATH (bun reinstall clobbered the test-concurrency cap)"
    rearmable=1
  elif [ ! -r "$WRAPPER_SOURCE" ] || ! cmp -s "$BUN_PATH" "$WRAPPER_SOURCE"; then
    fail="wrapper integrity mismatch: $BUN_PATH differs from $WRAPPER_SOURCE"
    rearmable=1
  elif [ ! -x "$REAL" ] || ! "$REAL" --version >/dev/null 2>&1; then
    fail="real bun missing or broken at $REAL"
  elif [ ! -d "$GUARD_DIR/slots" ]; then
    fail="slots directory missing at $GUARD_DIR/slots"
  fi
}

is_elf() {
  [ -f "$1" ] || return 1
  [ "$(head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')" = "7f454c46" ]
}

sha256_of() {
  sha256sum "$1" 2>/dev/null | awk '{print $1}'
}

pin_real_from() {
  # Stage in the target directory and rename over the live path (atomic;
  # running suites keep their old inode — mv-over-held-inode).
  local dir stage
  dir=$(dirname "$REAL")
  stage="$dir/bun-real.new"
  cp "$1" "$stage" 2>/dev/null || return 1
  chmod +x "$stage" 2>/dev/null || { rm -f "$stage"; return 1; }
  mv -f "$stage" "$REAL" 2>/dev/null || { rm -f "$stage"; return 1; }
  [ -x "$REAL" ] || return 1
  "$REAL" --version >/dev/null 2>&1 || return 1
}

download_pinned_bun() {
  # sha-verified download of the pinned bun release; prints the path to the
  # verified binary and caches a copy in the package-managed store
  # ($GUARD_DIR/pinned/bun) so a later rearm never needs the network.
  # Two independent verifications: the ZIP against the release's published
  # SHASUMS256.txt (download integrity), and the EXTRACTED binary against
  # PINNED_BUN_SHA256 (build identity — the recorded pin is the binary's sha).
  local dl want got exe
  dl=$(mktemp -d /tmp/tg-rearm.XXXXXX) || return 1
  if ! curl -fsSL --max-time 300 -o "$dl/bun.zip" "$PINNED_BUN_ZIP_URL" 2>/dev/null \
     || ! curl -fsSL --max-time 60 -o "$dl/SHASUMS256.txt" "$PINNED_BUN_SUMS_URL" 2>/dev/null; then
    rm -rf "$dl"
    return 1
  fi
  want=$(awk -v a="$PINNED_BUN_ASSET" '$2 == a { print $1 }' "$dl/SHASUMS256.txt" 2>/dev/null)
  got=$(sha256_of "$dl/bun.zip")
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    rm -rf "$dl"
    return 1
  fi
  if ! unzip -o -q "$dl/bun.zip" -d "$dl" 2>/dev/null; then
    rm -rf "$dl"
    return 1
  fi
  exe="$dl/${PINNED_BUN_ASSET%.zip}/bun"
  if ! is_elf "$exe" || [ "$(sha256_of "$exe")" != "$PINNED_BUN_SHA256" ]; then
    rm -rf "$dl"
    return 1
  fi
  chmod +x "$exe" 2>/dev/null || { rm -rf "$dl"; return 1; }
  if mkdir -p "$GUARD_DIR/pinned" 2>/dev/null; then
    cp "$exe" "$GUARD_DIR/pinned/bun.new" 2>/dev/null \
      && mv -f "$GUARD_DIR/pinned/bun.new" "$GUARD_DIR/pinned/bun" 2>/dev/null \
      && { rm -rf "$dl"; printf '%s\n' "$GUARD_DIR/pinned/bun"; return 0; }
  fi
  # Store unavailable: hand back the extracted binary path WITHOUT deleting the
  # temp tree — the caller pins from it in the same invocation. A later rearm
  # re-downloads if the tree is gone.
  printf '%s\n' "$exe"
  return 0
}

rearm() {
  # Returns 0 only when the wrapper was restored from the package source AND
  # bun-real is verified pinned. Source order for the pinned binary: the
  # clobbering ELF at $BUN_PATH itself (the installer re-installed the pinned
  # build — promote it over bun-real BEFORE the wrapper restore consumes the
  # path), the package-managed store, then the sha-verified download. The
  # sentinel re-runs the static chain and the functional probe afterwards.
  local pinned_src
  if ! mkdir -p "$GUARD_DIR" 2>/dev/null; then
    return 1
  fi
  exec 9>"$GUARD_DIR/rearm.lock" 2>/dev/null || return 1
  flock -n 9 2>/dev/null || {
    echo "$(date -u +%FT%TZ) rearm deferred (concurrent rearm holds $GUARD_DIR/rearm.lock)" >> "$GUARD_DIR/sentinel.log" 2>/dev/null
    return 1
  }
  if [ -f "$REAL" ] && is_elf "$REAL" && [ "$(sha256_of "$REAL")" = "$PINNED_BUN_SHA256" ]; then
    : # real already pinned — nothing to do
  elif is_elf "$BUN_PATH" && [ "$(sha256_of "$BUN_PATH")" = "$PINNED_BUN_SHA256" ]; then
    pin_real_from "$BUN_PATH" || return 1
  elif [ -f "$GUARD_DIR/pinned/bun" ] && is_elf "$GUARD_DIR/pinned/bun" \
       && [ "$(sha256_of "$GUARD_DIR/pinned/bun")" = "$PINNED_BUN_SHA256" ]; then
    pin_real_from "$GUARD_DIR/pinned/bun" || return 1
  else
    pinned_src=$(download_pinned_bun) || return 1
    pin_real_from "$pinned_src" || return 1
  fi
  # restore the wrapper from the package source (atomic: .new + mv -f)
  [ -r "$WRAPPER_SOURCE" ] || return 1
  cp "$WRAPPER_SOURCE" "$BUN_PATH.new" 2>/dev/null || return 1
  chmod +x "$BUN_PATH.new" 2>/dev/null || { rm -f "$BUN_PATH.new"; return 1; }
  mv -f "$BUN_PATH.new" "$BUN_PATH" 2>/dev/null || { rm -f "$BUN_PATH.new"; return 1; }
  echo "$(date -u +%FT%TZ) rearm: wrapper restored from $WRAPPER_SOURCE; bun-real pinned to $PINNED_BUN_VERSION (sha ${PINNED_BUN_SHA256:0:16})" >> "$GUARD_DIR/sentinel.log" 2>/dev/null
  flock -u 9 2>/dev/null
  return 0
}

static_check
if [ -n "$fail" ] && [ "$rearmable" = "1" ]; then
  if rearm; then
    static_check
    if [ -n "$fail" ] && [ "$rearmable" = "1" ]; then
      fail="auto-rearm FAILED: re-verification still reports $fail"
    fi
  else
    fail="auto-rearm FAILED: $fail — could not produce a verified wrapper and pinned bun-real ($PINNED_BUN_VERSION)"
  fi
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
