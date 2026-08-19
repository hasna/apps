#!/usr/bin/env bash
#
# src-todos.sh — source reader: todos assigned/status changes -> max updated + titles.
#
# Usage:
#   SIM_CURSOR_FILE=<file> [SIM_BASELINE=1] src-todos.sh
#
# Runs `todos list --format json --sort updated --limit 500` (default; override
# with SIM_TODOS_ARGS), picks tasks whose updated_at is newer than the cursor,
# atomically stores the max updated_at as the cursor, and prints one
# `NEW [<status>] <title>` line per changed task. Prints NOTHING and stores the
# cursor when the cursor file is absent (baseline).
#
# Default filter is `--inbox` (work assigned to this identity that another agent
# filed); change SIM_TODOS_ARGS for `--assigned <name>`, `--status`, or a
# project/task-list scope. Capture-path: JSON redirected to a file, parsed from
# the file, never piped. Cursor is an ISO-8601 UTC timestamp (sorted string).
#
# Env:
#   SIM_CURSOR_FILE     (required)
#   SIM_BASELINE        (default 0)
#   SIM_TODOS_CMD       (default todos)
#   SIM_TODOS_ARGS      (default "list --inbox --format json --sort updated --limit 500")
#   SIM_NEWLINE_CAP     (default 200)
#   SIM_TODOS_MIN_AGE_S (default 0) seconds; ignore tasks newer than now-this
#                       (squelch churn within a firing window)

set -euo pipefail

usage() { sed -n '2,16p' "$0"; }

: "${SIM_CURSOR_FILE:?SIM_CURSOR_FILE is required}"
SIM_BASELINE="${SIM_BASELINE:-0}"
SIM_TODOS_CMD="${SIM_TODOS_CMD:-todos}"
SIM_TODOS_ARGS="${SIM_TODOS_ARGS:-list --inbox --format json --sort updated --limit 500}"
SIM_NEWLINE_CAP="${SIM_NEWLINE_CAP:-200}"
SIM_TODOS_MIN_AGE_S="${SIM_TODOS_MIN_AGE_S:-0}"

# shellcheck disable=SC2086
read -r -a TODO_ARGS <<< "$SIM_TODOS_ARGS"

LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-todo.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
OUT_JSON="$LOCKDIR/tasks.json"

if ! "$SIM_TODOS_CMD" "${TODO_ARGS[@]}" > "$OUT_JSON" 2> "$LOCKDIR/err.txt"; then
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  exit 2
fi

# defensive shape: array or .tasks / .items / .rows
jq -c '
  (if type=="array" then . elif .tasks then .tasks elif .items then .items elif .rows then .rows else [] end)
  | map(select(. != null))
' "$OUT_JSON" > "$LOCKDIR/norm.json" 2>/dev/null || true

count="$(jq 'length' "$LOCKDIR/norm.json" 2>/dev/null || echo 0)"
if [[ "$count" == "0" ]]; then exit 0; fi

# newest updated_at wins the cursor; fall back to created_at per row
cursor_token="$(jq -r '
  [ .[] | (.updated_at // .created_at // "") | select(. != "") ] | sort | last // ""
' "$LOCKDIR/norm.json" 2>/dev/null || echo "")"

if [[ -z "$cursor_token" ]]; then
  echo "src-todos.sh: no updated_at/created_at field in todos JSON; adjust SIM_TODOS_ARGS or the CLI version" >&2
  exit 2
fi

old="0"
[[ -f "$SIM_CURSOR_FILE" ]] && old="$(cat "$SIM_CURSOR_FILE" 2>/dev/null || echo 0)"

if [[ "${SIM_BASELINE:-0}" == "1" ]]; then
  tmp="${SIM_CURSOR_FILE}.tmp.$$"; printf '%s\n' "$cursor_token" > "$tmp"; mv "$tmp" "$SIM_CURSOR_FILE"
  exit 0
fi

if [[ "$cursor_token" < "$old" ]]; then exit 0; fi

# min-age squelch: a task whose updated_at is inside the squelch window is
# probably the reader's own heartbeat/status churn, not a signal
squelch_ts=""
if (( SIM_TODOS_MIN_AGE_S > 0 )); then
  squelch_ts="$(date -u -d "@$(( $(date +%s) - SIM_TODOS_MIN_AGE_S ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")"
fi

tmp="${SIM_CURSOR_FILE}.tmp.$$"
printf '%s\n' "$cursor_token" > "$tmp"
mv "$tmp" "$SIM_CURSOR_FILE"

jq -r --arg old "$old" --arg sq "$squelch_ts" --argjson cap "$SIM_NEWLINE_CAP" '
  [ .[] | ((.updated_at // .created_at // "")) as $u | select($u != "") | select($u > $old) | select($sq == "" or $u >= $sq) ]
  | sort_by(.updated_at // .created_at)
  | .[]
  | (((.status // "") + " ") | if . == " " then "" else . end) as $st
  | ((.title // .description // "(no title)") as $t | if ($t|length) > $cap then $t[0:$cap]+"..." else $t end) as $tt
  | "NEW [" + $st + "] " + $tt
' "$LOCKDIR/norm.json"
exit 0