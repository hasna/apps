#!/usr/bin/env bash
#
# src-conversations.sh — source reader: conversations channel -> max id + summary.
#
# Usage:
#   SIM_CURSOR_FILE=<file> [SIM_BASELINE=1] [SIM_CONVERSATIONS_WINDOW=24h] \
#     src-conversations.sh <channel>
#
# Reads `conversations digest <channel> --since <window> --json`, follows
# has_more/next_cursor to exhaustion, computes the max message id, compares it to
# the cursor file, and when new content exists: atomically stores the new cursor
# and prints one `NEW ` line per message (capped summary). Prints NOTHING and
# stores the cursor when the cursor file is absent (baseline).
#
# Capture-path discipline: every JSON read is redirected to a file and parsed
# from the file; large JSON is never piped. Payloads never reach stdout except
# the capped `NEW <from> <snippet>` lines; snippets are truncated at 200 chars.
#
# Env:
#   SIM_CURSOR_FILE              (required) path to the cursor file
#   SIM_CURSOR_STORE_ON_EMPTY    (default 0) 1 = store cursor even when result is empty
#   SIM_BASELINE                 (default 0) 1 = store cursor, print nothing
#   SIM_CONVERSATIONS_WINDOW     (default 24h) --since window passed to digest
#   SIM_CONVERSATIONS_CMD        (default conversations) CLI override
#   SIM_NEWLINE_CAP              (default 200) per-NEW-line character cap

set -euo pipefail

usage() { sed -n '2,12p' "$0"; }

# ---------- config ----------
: "${SIM_CURSOR_FILE:?SIM_CURSOR_FILE is required}"
SIM_BASELINE="${SIM_BASELINE:-0}"
SIM_CONVERSATIONS_WINDOW="${SIM_CONVERSATIONS_WINDOW:-24h}"
SIM_CONVERSATIONS_CMD="${SIM_CONVERSATIONS_CMD:-conversations}"
SIM_NEWLINE_CAP="${SIM_NEWLINE_CAP:-200}"
CHANNEL="${1:-}"

if [[ -z "$CHANNEL" ]]; then
  echo "src-conversations.sh: channel argument is required" >&2
  usage >&2
  exit 2
fi

cd "$(dirname "$0")" 2>/dev/null || true
LOCKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sim-conv.XXXXXX")"
trap 'rm -rf "$LOCKDIR"' EXIT
OUT_JSON="$LOCKDIR/digest.json"
ROWS_FILE="$LOCKDIR/rows.jsonl"

# ---------- fetch (paged to exhaustion, redirect to file, never pipe) ----------
page=1
cursor=""
while :; do
  page_file="$LOCKDIR/page-$page.json"
  if [[ -n "$cursor" ]]; then
    if ! "$SIM_CONVERSATIONS_CMD" digest "$CHANNEL" --since "$SIM_CONVERSATIONS_WINDOW" --cursor "$cursor" --json > "$page_file" 2> "$LOCKDIR/err.txt"; then
      cat "$LOCKDIR/err.txt" | head -c 500 >&2
      exit 2
    fi
  else
    if ! "$SIM_CONVERSATIONS_CMD" digest "$CHANNEL" --since "$SIM_CONVERSATIONS_WINDOW" --json > "$page_file" 2> "$LOCKDIR/err.txt"; then
      cat "$LOCKDIR/err.txt" | head -c 500 >&2
      exit 2
    fi
  fi

  # emit one compact row per message: id|from|snippet (tab separated is fragile;
  # use json lines via jq into a per-run file)
  jq -r '.messages[]? // .items[]? // .[]? | [.id, (.from // ""), (.snippet // "")] | @tsv' \
    "$page_file" >> "$ROWS_FILE" 2>/dev/null || true

  has_more="$(jq -r '.has_more // false' "$page_file" 2>/dev/null || echo false)"
  cursor="$(jq -r '.next_cursor // ""' "$page_file" 2>/dev/null || echo "")"
  if [[ "$has_more" != "true" || -z "$cursor" ]]; then break; fi
  page=$((page + 1))
  if (( page > 50 )); then
    echo "src-conversations.sh: paging exceeded 50 pages; refusing to continue" >&2
    exit 2
  fi
done

# ---------- cursor math ----------
if [[ ! -s "$ROWS_FILE" ]]; then
  # empty result: store cursor only when explicitly asked; otherwise stay put
  if [[ "${SIM_CURSOR_STORE_ON_EMPTY:-0}" == "1" ]]; then
    tmp="${SIM_CURSOR_FILE}.tmp.$$"; printf '0\n' > "$tmp"; mv "$tmp" "$SIM_CURSOR_FILE"
  fi
  exit 0
fi

max_id="$(awk -F '\t' '$1 ~ /^[0-9]+$/ { if ($1+0 > m) m=$1+0 } END { print m+0 }' "$ROWS_FILE")"
old="0"
[[ -f "$SIM_CURSOR_FILE" ]] && old="$(cat "$SIM_CURSOR_FILE" 2>/dev/null || echo 0)"

# ---------- act ----------
if [[ "${SIM_BASELINE:-0}" == "1" ]]; then
  tmp="${SIM_CURSOR_FILE}.tmp.$$"; printf '%s\n' "$max_id" > "$tmp"; mv "$tmp" "$SIM_CURSOR_FILE"
  exit 0
fi

if (( max_id <= old )); then exit 0; fi

# store new cursor atomically BEFORE emitting; a crash after emit loses nothing
tmp="${SIM_CURSOR_FILE}.tmp.$$"
printf '%s\n' "$max_id" > "$tmp"
mv "$tmp" "$SIM_CURSOR_FILE"

# emit NEW lines, oldest message first, capped per line
awk -F '\t' -v old="$old" -v cap="$SIM_NEWLINE_CAP" '
  $1 ~ /^[0-9]+$/ && $1+0 > old+0 {
    from=$2; snip=$3
    if (length(snip) > cap) snip=substr(snip,1,cap) "..."
    printf "%s\tNEW [%s] %s\n", $1, from, snip
  }' "$ROWS_FILE" | sort -t $'\t' -k1,1n | cut -f2- || true
exit 0