#!/usr/bin/env bash
#
# inject-codex.sh — injector: Codex headless exec-resume path.
#
# [unverified] No measured push into a LIVE codex session exists on this fleet
# (codex-cli 0.147.0 on 2026-08-19). The best documented headless shape resumes a
# previous session in a NEW process:
#
#   codex exec resume <session-id>   (prompt via stdin)
#   codex exec resume --last <prompt>
#
# This is not a stream into a running TUI (the `--remote` / `remote-control`
# app-server surface is experimental and unmeasured). To avoid pretending, this
# script REFUSES by default. Set SESSION_INJECT_UNVERIFIED_OK=1 to run the
# best-documented unverified shape; a warning is printed to stderr.
#
# Usage:
#   SESSION_INJECT_UNVERIFIED_OK=1 inject-codex.sh --session <id> --text "<prompt>"
#
# Env:
#   SIM_TARGET_SESSION   session id (or --session; empty + SIM_CODEX_LAST=1 -> --last)
#   SIM_CODEX_LAST       (default 0) resume most recent session instead of by id
#   SIM_PROMPT_TEXT      prompt text (or --text; sent via stdin)
#   SIM_CODEX_CMD        (default codex)

set -euo pipefail

usage() { echo "usage: SESSION_INJECT_UNVERIFIED_OK=1 inject-codex.sh --session <id> --text \"<prompt>\""; }

SESSION=""
TEXT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "inject-codex.sh: unknown arg $1" >&2; usage >&2; exit 2 ;;
  esac
done
SESSION="${SESSION:-${SIM_TARGET_SESSION:-}}"
TEXT="${TEXT:-${SIM_PROMPT_TEXT:-}}"
SIM_CODEX_CMD="${SIM_CODEX_CMD:-codex}"
SIM_CODEX_LAST="${SIM_CODEX_LAST:-0}"

if [[ -z "$TEXT" ]]; then echo "inject-codex.sh: no prompt text" >&2; usage >&2; exit 2; fi
if [[ "$SIM_CODEX_LAST" != "1" && -z "$SESSION" ]]; then
  echo "inject-codex.sh: no session id (use --session or SIM_CODEX_LAST=1)" >&2; usage >&2; exit 2
fi

if [[ "${SESSION_INJECT_UNVERIFIED_OK:-0}" != "1" ]]; then
  cat >&2 <<'EOF'
inject-codex.sh: REFUSED.

Live prompt injection into a running codex session is UNVERIFIED on this fleet.
The best documented headless shape is

  codex exec resume <id>    (prompt via stdin)
  codex exec resume --last

which resumes a session in a NEW process — not a stream into a live TUI. Set
SESSION_INJECT_UNVERIFIED_OK=1 to run the headless resume shape anyway.
EOF
  exit 2
fi

LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-injcx.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
echo "inject-codex.sh: WARNING running UNVERIFIED exec-resume shape" >&2
if [[ "$SIM_CODEX_LAST" == "1" ]]; then
  printf '%s\n' "$TEXT" | "$SIM_CODEX_CMD" exec resume --last > "$LOCKDIR/out.txt" 2> "$LOCKDIR/err.txt"
else
  printf '%s\n' "$TEXT" | "$SIM_CODEX_CMD" exec resume "$SESSION" > "$LOCKDIR/out.txt" 2> "$LOCKDIR/err.txt"
fi
rc=$?
if (( rc != 0 )); then
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  echo "inject-codex.sh: inject failed rc=$rc" >&2
  exit $rc
fi
exit 0