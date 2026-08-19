#!/usr/bin/env bash
#
# inject-codewith.sh — injector: Codewith headless exec-resume path.
#
# [unverified] No measured push into a LIVE codewith session exists on this
# fleet (codewith 0.1.95 on 2026-08-19; codewith exec resume <id> is the best
# documented headless shape and it is NOT a stream into a running TUI or durable
# agent). Durable background agents exist (`codewith agent start|attach|logs`)
# but `codewith agent attach` only delivers pending interactions; it does not
# inject an arbitrary prompt. Native loops/goals run their own scheduler and
# cannot be prompted from outside without a new loop firing.
#
# To avoid pretending, this script REFUSES by default. Set SESSION_INJECT_UNVERIFIED_OK=1
# to run the best-documented unverified shape; a warning is printed to stderr.
#
# Usage:
#   SESSION_INJECT_UNVERIFIED_OK=1 inject-codewith.sh --session <id> --text "<prompt>"
#
# Env:
#   SIM_TARGET_SESSION   session/run id (or --session)
#   SIM_PROMPT_TEXT      prompt text (or --text; sent via stdin)
#   SIM_CODEWITH_CMD     (default codewith)

set -euo pipefail

usage() { echo "usage: SESSION_INJECT_UNVERIFIED_OK=1 inject-codewith.sh --session <id> --text \"<prompt>\""; }

SESSION=""
TEXT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "inject-codewith.sh: unknown arg $1" >&2; usage >&2; exit 2 ;;
  esac
done
SESSION="${SESSION:-${SIM_TARGET_SESSION:-}}"
TEXT="${TEXT:-${SIM_PROMPT_TEXT:-}}"
SIM_CODEWITH_CMD="${SIM_CODEWITH_CMD:-codewith}"

if [[ -z "$SESSION" ]]; then echo "inject-codewith.sh: no session id" >&2; usage >&2; exit 2; fi
if [[ -z "$TEXT" ]]; then echo "inject-codewith.sh: no prompt text" >&2; usage >&2; exit 2; fi

if [[ "${SESSION_INJECT_UNVERIFIED_OK:-0}" != "1" ]]; then
  cat >&2 <<'EOF'
inject-codewith.sh: REFUSED.

Live prompt injection into a running codewith session is UNVERIFIED on this
fleet. The best documented headless shape is

  codewith exec resume <id>   (prompt via stdin)

which resumes a previous session in a NEW process — not a stream into a live
TUI/durable agent. `codewith agent attach` delivers only pending interactions.
Set SESSION_INJECT_UNVERIFIED_OK=1 to run the headless resume shape anyway.
EOF
  exit 2
fi

LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-injcw.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
echo "inject-codewith.sh: WARNING running UNVERIFIED exec-resume shape for $SESSION" >&2
printf '%s\n' "$TEXT" | "$SIM_CODEWITH_CMD" exec resume "$SESSION" > "$LOCKDIR/out.txt" 2> "$LOCKDIR/err.txt"
rc=$?
if (( rc != 0 )); then
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  echo "inject-codewith.sh: inject failed rc=$rc" >&2
  exit $rc
fi
exit 0