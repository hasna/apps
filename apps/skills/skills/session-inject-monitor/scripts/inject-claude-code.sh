#!/usr/bin/env bash
#
# inject-claude-code.sh — injector: Claude Code headless resume path.
#
# [unverified] No measured push into a LIVE interactive Claude Code client exists
# on this fleet (claude 2.1.235 on 2026-08-19). The best documented headless
# shape resumes an existing conversation non-interactively:
#
#   claude -p --session-id <uuid> --resume <session-id> -- "TEXT"
#
# This runs a NEW headless process continuing the same conversation; it is NOT a
# prompt streamed into a running TUI. Claude's `--remote-control` / `--bg`
# surfaces are the plausible live-injection channels but were NOT measured.
#
# To avoid pretending, this script REFUSES by default. Set SESSION_INJECT_UNVERIFIED_OK=1
# to run the best-documented unverified shape; a warning is printed to stderr.
#
# Usage:
#   SESSION_INJECT_UNVERIFIED_OK=1 inject-claude-code.sh --session <id> --text "<prompt>"
#
# Env:
#   SIM_TARGET_SESSION   session id (or --session)
#   SIM_PROMPT_TEXT      prompt text (or --text)
#   SIM_CLAUDE_CMD       (default claude)
#   SIM_CLAUDE_RESUME    (default 1) pass --resume <id>; set 0 to rely on --session-id only

set -euo pipefail

usage() { echo "usage: SESSION_INJECT_UNVERIFIED_OK=1 inject-claude-code.sh --session <id> --text \"<prompt>\""; }

SESSION=""
TEXT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "inject-claude-code.sh: unknown arg $1" >&2; usage >&2; exit 2 ;;
  esac
done
SESSION="${SESSION:-${SIM_TARGET_SESSION:-}}"
TEXT="${TEXT:-${SIM_PROMPT_TEXT:-}}"
SIM_CLAUDE_CMD="${SIM_CLAUDE_CMD:-claude}"
SIM_CLAUDE_RESUME="${SIM_CLAUDE_RESUME:-1}"

if [[ -z "$SESSION" ]]; then echo "inject-claude-code.sh: no session id" >&2; usage >&2; exit 2; fi
if [[ -z "$TEXT" ]]; then echo "inject-claude-code.sh: no prompt text" >&2; usage >&2; exit 2; fi

if [[ "${SESSION_INJECT_UNVERIFIED_OK:-0}" != "1" ]]; then
  cat >&2 <<'EOF'
inject-claude-code.sh: REFUSED.

Prompt injection into a LIVE interactive Claude Code client is UNVERIFIED on
this fleet. The best documented headless shape is

  claude -p --session-id <id> --resume <id> -- "TEXT"

which resumes the conversation in a NEW process — it is not a stream into a
running TUI. The --remote-control / --bg surfaces are plausible but unmeasured.
Set SESSION_INJECT_UNVERIFIED_OK=1 to run the headless resume shape anyway; for
a live client, prefer an external carrier that starts its own headless session
(monitoring is continuity; it never hijacks an interactive client).
EOF
  exit 2
fi

ARGS=(-p --session-id "$SESSION")
if [[ "$SIM_CLAUDE_RESUME" == "1" ]]; then ARGS+=(--resume "$SESSION"); fi
ARGS+=(-- "$TEXT")

LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-injcc.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
echo "inject-claude-code.sh: WARNING running UNVERIFIED headless-resume shape for $SESSION" >&2
"$SIM_CLAUDE_CMD" "${ARGS[@]}" > "$LOCKDIR/out.txt" 2> "$LOCKDIR/err.txt"
rc=$?
if (( rc != 0 )); then
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  echo "inject-claude-code.sh: inject failed rc=$rc" >&2
  exit $rc
fi
exit 0