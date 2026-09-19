#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <url> <expected-version> <receipt.json>" >&2
  exit 2
fi

URL="$1"
EXPECTED_VERSION="$2"
OUT="$3"
[[ "$URL" =~ ^https://[^[:space:]]+$ ]] || { echo "readiness URL must be HTTPS" >&2; exit 2; }
[[ "$EXPECTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || { echo "expected version is invalid" >&2; exit 2; }

RESPONSE="$(curl --silent --show-error --max-time 15 --max-redirs 0 --output - --write-out $'\n%{http_code}' "$URL")"
HTTP_STATUS="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"
[[ "$HTTP_STATUS" == "200" ]] || { echo "readiness returned HTTP $HTTP_STATUS" >&2; exit 1; }
OBSERVED="$(jq -c -e -s --arg version "$EXPECTED_VERSION" '
  if length != 1 or (.[0] | type) != "object" then error("readiness must be exactly one JSON object") else .[0] end
  | select(.status == "ok" and .version == $version)
  | select((.pendingMigrations | type) == "array" and (.pendingMigrations | length) == 0)
  | {status,version,pending_migrations:0}
' <<<"$BODY")" || { echo "readiness JSON contract mismatch" >&2; exit 1; }

jq -n --arg url "$URL" --argjson observed "$OBSERVED" \
  '{schema:"hasna.domains.readiness_receipt.v1",http_status:200,url:$url,redirects_followed:false,observed:$observed}' > "$OUT"
chmod 600 "$OUT"
