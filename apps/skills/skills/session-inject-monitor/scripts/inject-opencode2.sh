#!/usr/bin/env bash
#
# inject-opencode2.sh — injector: opencode2 background-server prompt API.
#
# [measured] 2026-08-19 on this fleet, opencode2 v0.0.0-beta-17595.
# The working primitive is the server API operation `v2.session.prompt`
# (POST /api/session/{sessionID}/prompt, body {"text":"..."}), invoked as:
#
#   opencode2 api v2.session.prompt --param sessionID=<id> -d '{"text":"..."}'
#
# This streams a real user turn to the attached client of the live session.
# The prompt body is JSON-encoded with python3 so quotes/newlines are safe.
# The opencode-scheduler npm plugin does NOT load on opencode2 (SchemaError) —
# do not claim it works; this is the supported path.
#
# Usage:
#   inject-opencode2.sh --session <id> --text "<prompt>"
#
# Env:
#   SIM_TARGET_SESSION   session id (or --session)
#   SIM_PROMPT_TEXT      prompt text (or --text)
#   SIM_OPCODE2_CMD      (default opencode2)

set -euo pipefail

usage() { echo "usage: inject-opencode2.sh --session <id> --text \"<prompt>\" (or SIM_TARGET_SESSION / SIM_PROMPT_TEXT)"; }

SESSION=""
TEXT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "inject-opencode2.sh: unknown arg $1" >&2; usage >&2; exit 2 ;;
  esac
done
SESSION="${SESSION:-${SIM_TARGET_SESSION:-}}"
TEXT="${TEXT:-${SIM_PROMPT_TEXT:-}}"
SIM_OPCODE2_CMD="${SIM_OPCODE2_CMD:-opencode2}"

if [[ -z "$SESSION" ]]; then echo "inject-opencode2.sh: no session id" >&2; usage >&2; exit 2; fi
if [[ -z "$TEXT" ]]; then echo "inject-opencode2.sh: no prompt text" >&2; usage >&2; exit 2; fi

# JSON-encode the body (prompt may contain quotes/newlines) — no credentials here.
# delivery=steer: a monitor turn must steer the live session's context, not be
# queued silently (Session.Inbox.Delivery enum: steer|queue). Root-cause memento
# 28f2bd7a.
BODY="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "delivery": "steer"}))' "$TEXT")"

# capture-path: output/error to files; never pipe the response
LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-inj2.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
# `if`/`else` guard (never `if !`, which captures the negation's exit, and never a
# bare set -e call which suppresses diagnostics): the else branch captures the real
# command rc, the failure diagnostic runs, and set -e does not kill the script
# (reviewer-validated shape, 2026-08-19).
if "$SIM_OPCODE2_CMD" api v2.session.prompt --param "sessionID=$SESSION" -d "$BODY" \
    > "$LOCKDIR/out.txt" 2> "$LOCKDIR/err.txt"; then
  :
else
  rc=$?
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  echo "inject-opencode2.sh: v2.session.prompt failed rc=$rc" >&2
  exit $rc
fi
# Exact response readback — STRONG discriminator, Fable verdict 2026-08-19 (adopted
# verbatim from Side B's live deployment). A body that merely echoes the requested
# sessionID is NOT delivery: SessionNotFoundError carries the requested id in its body,
# so a sessionID-match readback passes on a never-delivered turn. Delivery is confirmed
# only when the response is structured as `.data.type=="user" and .data.delivery=="steer"
# and .data.payload.text==<the exact prompt text>` — anything else (error objects
# included) exits nonzero and the gate's fail-closed cursor restore fires.
if ! jq -e --arg want "$TEXT" \
    '.data.type=="user" and .data.delivery=="steer" and .data.payload.text==$want' \
    "$LOCKDIR/out.txt" >/dev/null 2>&1; then
  echo "inject-opencode2.sh: response not a delivered steer turn (error or wrong text) — session $SESSION (not delivered)" >&2
  exit 2
fi
exit 0