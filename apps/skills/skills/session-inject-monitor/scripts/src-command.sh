#!/usr/bin/env bash
#
# src-command.sh — source reader: any command whose stdout changes (hash compare).
#
# Usage:
#   SIM_CURSOR_FILE=<file> [SIM_BASELINE=1] src-command.sh -- <command...>
#   SIM_CURSOR_FILE=<file> SIM_COMMAND="ls -la /some/path" src-command.sh
#
# Runs the command (via SIM_COMMAND or the `--` argv), takes a sha256 of its
# stdout, and when the hash differs from the stored cursor: stores the new hash
# and prints `NEW <hash> <first line>` plus a line-count note. Prints NOTHING and
# stores the hash when the cursor file is absent (baseline).
#
# Capture-path: the command's stdout and stderr are redirected to separate files
# and read from there; stdout is never piped. The full stdout is never printed
# to the monitor's stdout — only the hash and ONE capped first line. Work
# happens in a scratch dir that is removed on exit.
#
# Env:
#   SIM_CURSOR_FILE     (required)
#   SIM_BASELINE        (default 0)
#   SIM_COMMAND         optional command string (used when no `--` argv given)
#   SIM_NEWLINE_CAP     (default 200)
#   SIM_COMMAND_TIMEOUT (default 120) seconds

set -euo pipefail

usage() { sed -n '2,16p' "$0"; }

: "${SIM_CURSOR_FILE:?SIM_CURSOR_FILE is required}"
SIM_BASELINE="${SIM_BASELINE:-0}"
SIM_NEWLINE_CAP="${SIM_NEWLINE_CAP:-200}"
SIM_COMMAND_TIMEOUT="${SIM_COMMAND_TIMEOUT:-120}"

LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-cmd.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
OUT_FILE="$LOCKDIR/out.txt"
ERR_FILE="$LOCKDIR/err.txt"

# command source: `-- argv...` wins over SIM_COMMAND
if [[ "${1:-}" == "--" ]]; then
  shift
  if (( $# == 0 )); then
    echo "src-command.sh: nothing after --" >&2
    usage >&2
    exit 2
  fi
  CMD=("$@")
elif [[ -n "${SIM_COMMAND:-}" ]]; then
  # shellcheck disable=SC2086
  read -r -a CMD <<< "$SIM_COMMAND"
else
  echo "src-command.sh: pass a command after -- or set SIM_COMMAND" >&2
  usage >&2
  exit 2
fi

if ! timeout "$SIM_COMMAND_TIMEOUT" "${CMD[@]}" > "$OUT_FILE" 2> "$ERR_FILE"; then
  cat "$ERR_FILE" | head -c 500 >&2
  echo "src-command.sh: command failed (rc=$?); nothing injected" >&2
  exit 2
fi

new_hash="$(sha256sum "$OUT_FILE" | awk '{print $1}')"
old_hash=""
[[ -f "$SIM_CURSOR_FILE" ]] && old_hash="$(cat "$SIM_CURSOR_FILE" 2>/dev/null || echo "")"

if [[ "${SIM_BASELINE:-0}" == "1" || -z "$old_hash" ]]; then
  tmp="${SIM_CURSOR_FILE}.tmp.$$"; printf '%s\n' "$new_hash" > "$tmp"; mv "$tmp" "$SIM_CURSOR_FILE"
  exit 0
fi

# treat the absence of output as a real state (a command that flips to empty is
# a change even if the hash of empty is a constant)
if [[ "$new_hash" == "$old_hash" ]]; then exit 0; fi

tmp="${SIM_CURSOR_FILE}.tmp.$$"
printf '%s\n' "$new_hash" > "$tmp"
mv "$tmp" "$SIM_CURSOR_FILE"

lines="$(wc -l < "$OUT_FILE" | tr -d ' ')"
first="$(head -1 "$OUT_FILE" | head -c "$SIM_NEWLINE_CAP")"
printf 'NEW %s (%s lines) %s\n' "$new_hash" "$lines" "$first"
exit 0