#!/usr/bin/env bash
#
# src-knowledge.sh — source reader: knowledge list since cursor -> max updated + titles.
#
# Usage:
#   SIM_CURSOR_FILE=<file> [SIM_BASELINE=1] src-knowledge.sh
#
# Runs `knowledge list --limit 200 --sort created --desc --json` (default;
# override with SIM_KNOWLEDGE_ARGS), picks items newer than the cursor, stores
# the max updated_at (fallback created_at) atomically, and prints one
# `NEW <title>` line per new/updated item. Prints NOTHING and stores the cursor
# when the cursor file is absent (baseline).
#
# Note: the knowledge CLI has no `--sort updated`; detection of updates relies
# on updated_at in the row and a client-side sort, per fleet documentation.
# Capture-path: JSON redirected to a file, parsed from the file.
#
# Env:
#   SIM_CURSOR_FILE      (required)
#   SIM_BASELINE         (default 0)
#   SIM_KNOWLEDGE_CMD    (default knowledge)
#   SIM_KNOWLEDGE_ARGS   (default "list --limit 200 --sort created --desc --json")
#   SIM_NEWLINE_CAP      (default 200)

set -euo pipefail

usage() { sed -n '2,16p' "$0"; }

: "${SIM_CURSOR_FILE:?SIM_CURSOR_FILE is required}"
SIM_BASELINE="${SIM_BASELINE:-0}"
SIM_KNOWLEDGE_CMD="${SIM_KNOWLEDGE_CMD:-knowledge}"
SIM_KNOWLEDGE_ARGS="${SIM_KNOWLEDGE_ARGS:-list --limit 200 --sort created --desc --json}"
SIM_NEWLINE_CAP="${SIM_NEWLINE_CAP:-200}"

# shellcheck disable=SC2086
read -r -a KNOW_ARGS <<< "$SIM_KNOWLEDGE_ARGS"

LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-know.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
OUT_JSON="$LOCKDIR/items.json"

if ! "$SIM_KNOWLEDGE_CMD" "${KNOW_ARGS[@]}" > "$OUT_JSON" 2> "$LOCKDIR/err.txt"; then
  cat "$LOCKDIR/err.txt" | head -c 500 >&2
  exit 2
fi

jq -c '
  (if type=="array" then . elif .items then .items elif .rows then .rows elif .results then .results else [] end)
  | map(select(. != null))
' "$OUT_JSON" > "$LOCKDIR/norm.json" 2>/dev/null || true

count="$(jq 'length' "$LOCKDIR/norm.json" 2>/dev/null || echo 0)"
if [[ "$count" == "0" ]]; then exit 0; fi

cursor_token="$(jq -r '
  [ .[] | (.updated_at // .created_at // "") | select(. != "") ] | sort | last // ""
' "$LOCKDIR/norm.json" 2>/dev/null || echo "")"

if [[ -z "$cursor_token" ]]; then
  echo "src-knowledge.sh: no updated_at/created_at field in knowledge JSON; adjust SIM_KNOWLEDGE_ARGS or the CLI version" >&2
  exit 2
fi

old="0"
[[ -f "$SIM_CURSOR_FILE" ]] && old="$(cat "$SIM_CURSOR_FILE" 2>/dev/null || echo 0)"

if [[ "${SIM_BASELINE:-0}" == "1" ]]; then
  tmp="${SIM_CURSOR_FILE}.tmp.$$"; printf '%s\n' "$cursor_token" > "$tmp"; mv "$tmp" "$SIM_CURSOR_FILE"
  exit 0
fi

if [[ "$cursor_token" < "$old" ]]; then exit 0; fi

tmp="${SIM_CURSOR_FILE}.tmp.$$"
printf '%s\n' "$cursor_token" > "$tmp"
mv "$tmp" "$SIM_CURSOR_FILE"

jq -r --arg old "$old" --argjson cap "$SIM_NEWLINE_CAP" '
  [ .[] | ((.updated_at // .created_at // "")) as $u | select($u != "") | select($u > $old) ]
  | sort_by(.updated_at // .created_at)
  | .[]
  | ((.tags // []) | join(",")) as $tags
  | ((.title // .name // "(untitled)") as $t | if ($t|length) > $cap then $t[0:$cap]+"..." else $t end) as $tt
  | (if $tags == "" then $tt else $tt + "  (tags: " + $tags + ")" end)
  | "NEW " + .
' "$LOCKDIR/norm.json"
exit 0