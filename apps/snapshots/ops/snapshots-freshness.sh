#!/bin/bash
# snapshots-freshness.sh — alert #incidents when the local capture cron is stale.
#
# Canonical home: hasna/apps monorepo, apps/snapshots/ops/snapshots-freshness.sh.
# Deployed to ~/.hasna/bin/snapshots-freshness.sh on each station (station02/03/04)
# by the snapshots-deploy crontab entry (`*/5 * * * * ... snapshots-freshness.sh`).
#
# todos 27f3d817 (2026-08-24): the alarm used to key off the age of the newest
# UNIQUE snapshot (`snapshots list --limit 1`). `snapshots capture` dedups identical
# state by design and only mints a new snapshot when state changes, so on a stable
# machine the newest unique snapshot aged past the 900s threshold and the alarm
# posted [INCIDENT] every 5 minutes while the capture cron was alive.
#
# The alarm now keys off capture-RUN recency via `snapshots freshness`:
#   - `snapshots capture` records a capture run on EVERY attempt (dedup or new).
#   - `snapshots freshness` returns ok:true when the latest run is inside the
#     threshold (alive-but-deduping stays green); ok:false with a reason when the
#     capture is genuinely dead/stalled (no recent run) or has never run.
#   - Exit code contract: 0 fresh, 1 stale verdict, 2 could not determine.
#     A "could not read the status" (exit 2) is logged, never posted as an
#     [INCIDENT]: we do not have evidence the capture is dead, and treating an
#     unreadable status as "no snapshots" was exactly the false alarm this fixes.
#
# Threshold: 3 capture intervals (900s default). Every run is logged (never /dev/null).
# Alert identity: <machine>-snapshot-freshness (CONVERSATIONS_AGENT_ID, per-process).
set -uo pipefail
export PATH="${SNAPSHOTS_FRESHNESS_PATH:-$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
MACHINE="$(hostname 2>/dev/null | sed -E 's/[^A-Za-z0-9-]/_/g' || echo unknown)"
export CONVERSATIONS_AGENT_ID="${CONVERSATIONS_AGENT_ID:-${MACHINE}-snapshot-freshness}"
CONV_ENV="$HOME/.hasna/fleet-env/conversations.env"
if [ -r "$CONV_ENV" ]; then set -a; . "$CONV_ENV"; set +a
elif [ -r "$HOME/.hasna/cloud/conversations.env" ]; then set -a; . "$HOME/.hasna/cloud/conversations.env"; set +a; fi
BIN="${SNAPSHOTS_BIN:-$(command -v snapshots)}"
LOG="$HOME/.hasna/logs/snapshots-freshness.log"
mkdir -p "$(dirname "$LOG")"
THRESHOLD="${SNAPSHOTS_FRESHNESS_THRESHOLD:-900}"

# Capture-path discipline: redirect, never pipe a large CLI read.
OUT_FILE="$(mktemp)"
ERR_FILE="$(mktemp)"
"$BIN" freshness --threshold "$THRESHOLD" --json > "$OUT_FILE" 2> "$ERR_FILE"
RC=$?

if [ "$RC" -eq 2 ]; then
  # Could not determine (CLI/DB read error). Log it; never post an INCIDENT —
  # "could not read the status" is not evidence the capture cron is dead.
  echo "$(date -u +%FT%TZ) check-error rc=2 $(head -c 300 "$ERR_FILE" 2>/dev/null)" >> "$LOG"
  rm -f "$OUT_FILE" "$ERR_FILE"
  exit 0
fi

# Parse the verdict fields. BSD/macOS-safe: no GNU-only `\|` alternation, which
# GNU sed accepts but /usr/bin/sed (BSD) treats as a literal and returns empty.
# `grep -o` + `awk` are portable. The decision below keys off REASON, never OK, so
# a healthy run cannot be misread as an alert (and vice versa) by a parse failure.
OK="$(grep -o '"ok": [a-z]*' "$OUT_FILE" | head -1 | awk '{print $2}')"
REASON="$(grep -o '"reason": "[a-z-]*"' "$OUT_FILE" | head -1 | awk -F'"' '{print $4}')"
LAST_RUN="$(grep -o '"last_capture_run_at": "[^"]*"' "$OUT_FILE" | head -1 | awk -F'"' '{print $4}')"
AGE="$(grep -o '"last_capture_run_age_seconds": [0-9]*' "$OUT_FILE" | head -1 | awk '{print $2}')"
rm -f "$OUT_FILE" "$ERR_FILE"

case "$REASON" in
  fresh)
    echo "$(date -u +%FT%TZ) ok last_run=${LAST_RUN:-?} age=${AGE:-?}s threshold=$THRESHOLD" >> "$LOG"
    exit 0
    ;;
  capture-run-stale)
    echo "$(date -u +%FT%TZ) ALERT last_run=${LAST_RUN:-?} age=${AGE:-?}s threshold=$THRESHOLD" >> "$LOG"
    conversations send --channel incidents --priority high \
      "[INCIDENT] $MACHINE snapshot freshness: last capture run ${LAST_RUN:-?} is ${AGE:-unknown}s old (threshold ${THRESHOLD}s) — capture cron may be dead." >> "$LOG" 2>&1
    exit 1
    ;;
  no-capture-runs)
    echo "$(date -u +%FT%TZ) ALERT no capture runs recorded; age=infinity > threshold=$THRESHOLD" >> "$LOG"
    conversations send --channel incidents --priority high \
      "[INCIDENT] $MACHINE snapshot freshness: no capture run has ever been recorded (capture cron may be dead or never ran)." >> "$LOG" 2>&1
    exit 1
    ;;
  *)
    # Fail-closed: the CLI emits exactly the three reasons above, so an
    # unrecognized or missing reason means the contract changed or the output is
    # malformed — do NOT silently suppress the alert.
    echo "$(date -u +%FT%TZ) ALERT unexpected freshness result reason=${REASON:-unknown} ok=${OK:-unknown}" >> "$LOG"
    conversations send --channel incidents --priority high \
      "[INCIDENT] $MACHINE snapshot freshness: unexpected freshness check result (reason=${REASON:-unknown}, ok=${OK:-unknown}) — the snapshots freshness check needs attention." >> "$LOG" 2>&1
    exit 1
    ;;
esac
