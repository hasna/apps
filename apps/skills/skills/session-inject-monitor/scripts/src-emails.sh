#!/usr/bin/env bash
#
# src-emails.sh — source reader: email inbox since cursor -> max id + subject line.
#
# Usage:
#   SIM_CURSOR_FILE=<file> [SIM_BASELINE=1] src-emails.sh
#
# Runs the emails inbox read, computes the newest message id / timestamp, compares
# to the cursor file, and when new: atomically stores the new cursor and prints
# one `NEW <subject>` line per message (oldest first). Prints NOTHING and stores
# the cursor when the cursor file is absent (baseline).
#
# Capture-path: the read is redirected to files; JSON is parsed from the file.
# The cursor is the max message id when ids are numeric, otherwise the max ISO
# received_at timestamp; comparison is lexicographic for ISO (sortable) cursors.
#
# [unverified] The exact `emails inbox read` flags were not measurable on this
# box on 2026-08-19 (vault auth absent here); the default invocation is the
# documented shape and overridable via SIM_EMAILS_CMD / SIM_EMAILS_READ_ARGS.
# Run the command by hand once before relying on it.
#
# Env:
#   SIM_CURSOR_FILE           (required)
#   SIM_BASELINE              (default 0)
#   SIM_EMAILS_CMD            (default emails)
#   SIM_EMAILS_READ_ARGS      (default "inbox read --json") override if the CLI
#                             shape differs from the documented one
#   SIM_NEWLINE_CAP           (default 200) per-NEW-line character cap

set -euo pipefail

usage() { sed -n '2,14p' "$0"; }

: "${SIM_CURSOR_FILE:?SIM_CURSOR_FILE is required}"
SIM_BASELINE="${SIM_BASELINE:-0}"
SIM_EMAILS_CMD="${SIM_EMAILS_CMD:-emails}"
SIM_EMAILS_READ_ARGS="${SIM_EMAILS_READ_ARGS:-inbox read --json}"
SIM_NEWLINE_CAP="${SIM_NEWLINE_CAP:-200}"

# read args into an array safely (word splitting is intentional for CLI args)
# shellcheck disable=SC2086
read -r -a EMAIL_ARGS <<< "$SIM_EMAILS_READ_ARGS"

LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-mail.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
OUT_JSON="$LOCKDIR/inbox.json"

if ! "$SIM_EMAILS_CMD" "${EMAIL_ARGS[@]}" > "$OUT_JSON" 2> "$LOCKDIR/err.txt"; then
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  echo "src-emails.sh: run '$SIM_EMAILS_CMD $SIM_EMAILS_READ_ARGS' by hand once to confirm its shape" >&2
  exit 2
fi

# defensive shape: array, .messages, .items, .rows
jq -c '
  (if type=="array" then . elif .messages then .messages elif .items then .items elif .rows then .rows else [] end)
  | map(select(. != null))
' "$OUT_JSON" > "$LOCKDIR/norm.json" 2>/dev/null || true

count="$(jq 'length' "$LOCKDIR/norm.json" 2>/dev/null || echo 0)"
if [[ "$count" == "0" ]]; then
  if [[ "${SIM_CURSOR_STORE_ON_EMPTY:-0}" == "1" ]]; then
    tmp="${SIM_CURSOR_FILE}.tmp.$$"; printf '0\n' > "$tmp"; mv "$tmp" "$SIM_CURSOR_FILE"
  fi
  exit 0
fi

# cursor token: numeric id if present, else ISO timestamp
cursor_token="$(jq -r '
  (map(.id // .message_id // empty) | map(select(test("^[0-9]+$"))) | map(tonumber) | max // empty)
  // (map(.received_at // .created_at // .date // empty) | sort | last // "")
' "$LOCKDIR/norm.json" 2>/dev/null || echo "")"

if [[ -z "$cursor_token" ]]; then
  echo "src-emails.sh: no usable id/timestamp field in emails JSON; set SIM_EMAILS_READ_ARGS to a shape exposing .id or .received_at" >&2
  exit 2
fi

old="0"
[[ -f "$SIM_CURSOR_FILE" ]] && old="$(cat "$SIM_CURSOR_FILE" 2>/dev/null || echo 0)"

if [[ "$cursor_token" =~ ^[0-9]+$ ]]; then
  newer='.id // .message_id | numbers | select(. > (($old|tonumber)))'
  sortkey='tonumber'
else
  newer='(.received_at // .created_at // .date) as $t | select($t > $old)'
  sortkey='.'
fi

if [[ "${SIM_BASELINE:-0}" == "1" ]]; then
  tmp="${SIM_CURSOR_FILE}.tmp.$$"; printf '%s\n' "$cursor_token" > "$tmp"; mv "$tmp" "$SIM_CURSOR_FILE"
  exit 0
fi

# numeric comparison, else lexicographic (ISO stays lexicographically sortable)
is_new="$(jq -r --arg old "$old" "[ .[] | select($newer) ] | length" "$LOCKDIR/norm.json" 2>/dev/null || echo 0)"
if [[ "$is_new" == "0" ]]; then exit 0; fi

if [[ "$cursor_token" =~ ^[0-9]+$ ]]; then
  if (( 10#$cursor_token <= 10#$old )); then exit 0; fi
else
  if [[ "$cursor_token" < "$old" ]]; then exit 0; fi
fi

tmp="${SIM_CURSOR_FILE}.tmp.$$"
printf '%s\n' "$cursor_token" > "$tmp"
mv "$tmp" "$SIM_CURSOR_FILE"

jq -r --arg old "$old" --argjson cap "$SIM_NEWLINE_CAP" '
  [ .[] | select($newer) ] | sort_by('"$sortkey"') | .[]
  | ((.subject // .title // "(no subject)") as $s
     | if ($s|length) > $cap then $s[0:$cap]+"..." else $s end) as $subj
  | "NEW " + $subj
' "$LOCKDIR/norm.json"
exit 0