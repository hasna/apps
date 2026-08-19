#!/usr/bin/env bash
#
# inject-opencode.sh — injector: classic opencode (pre-v2 beta).
#
# [unverified] No live-client prompt injection into a running opencode TUI/agent
# has been measured for classic opencode on this fleet (only the opencode2
# background-server API in inject-opencode2.sh is measured). The best documented
# shape is to attach to a running opencode server and continue a session:
#
#   opencode run --attach <server-url> --session <session-id> -- "TEXT"
#
# `opencode run -c/--continue` or `-s/--session` WITHOUT `--attach` starts a NEW
# headless server and session — that is a fresh run, NOT an injection into the
# live client, and must not be presented as one. There is no `--prompt` flag on
# classic opencode; the prompt is the positional message.
#
# To avoid pretending, this script REFUSES by default. Set SESSION_INJECT_UNVERIFIED_OK=1
# to run the best-documented unverified shape; a warning is printed to stderr.
#
# Usage:
#   SESSION_INJECT_UNVERIFIED_OK=1 inject-opencode.sh --session <id> [--server <url>] --text "<prompt>"
#
# Env:
#   SIM_TARGET_SESSION   session id (or --session)
#   SIM_TARGET_SERVER    running server URL (or --server, or SIM_OPCODE_SERVER)
#   SIM_PROMPT_TEXT      prompt text (or --text)
#   SIM_OPCODE_CMD       (default opencode)

set -euo pipefail

usage() { echo "usage: SESSION_INJECT_UNVERIFIED_OK=1 inject-opencode.sh --session <id> [--server <url>] --text \"<prompt>\""; }

SESSION=""
SERVER=""
TEXT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "inject-opencode.sh: unknown arg $1" >&2; usage >&2; exit 2 ;;
  esac
done
SESSION="${SESSION:-${SIM_TARGET_SESSION:-}}"
SERVER="${SERVER:-${SIM_OPCODE_SERVER:-}}"
TEXT="${TEXT:-${SIM_PROMPT_TEXT:-}}"
SIM_OPCODE_CMD="${SIM_OPCODE_CMD:-opencode}"

if [[ -z "$SESSION" ]]; then echo "inject-opencode.sh: no session id" >&2; usage >&2; exit 2; fi
if [[ -z "$TEXT" ]]; then echo "inject-opencode.sh: no prompt text" >&2; usage >&2; exit 2; fi

if [[ "${SESSION_INJECT_UNVERIFIED_OK:-0}" != "1" ]]; then
  cat >&2 <<'EOF'
inject-opencode.sh: REFUSED.

Live-client prompt injection for classic opencode is UNVERIFIED on this fleet
(only opencode2 v2.session.prompt is measured). The best documented shape is

  opencode run --attach <server-url> --session <id> -- "TEXT"

but it has not been measured and may not stream into the attached client. To run
it anyway (unverified), set SESSION_INJECT_UNVERIFIED_OK=1. Reroute to
inject-opencode2.sh instead when the target is an opencode2 session.
EOF
  exit 2
fi

ARGS=(run)
[[ -n "$SERVER" ]] && ARGS+=(--attach "$SERVER")
ARGS+=(--session "$SESSION" -- "$TEXT")

# capture-path: redirect; the response is a stream (not parsed here)
LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-injoc.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
echo "inject-opencode.sh: WARNING running UNVERIFIED injector shape for $SESSION" >&2
"$SIM_OPCODE_CMD" "${ARGS[@]}" > "$LOCKDIR/out.txt" 2> "$LOCKDIR/err.txt"
rc=$?
if (( rc != 0 )); then
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  echo "inject-opencode.sh: inject failed rc=$rc" >&2
  exit $rc
fi
exit 0