#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: $0 <url> <expected-version> <expected-source-sha> <expected-image> <receipt.json>" >&2
  exit 2
fi

URL="$1"
EXPECTED_VERSION="$2"
EXPECTED_SOURCE_SHA="$3"
EXPECTED_IMAGE="$4"
OUT="$5"

[[ "$URL" =~ ^https://[^[:space:]]+$ ]] || { echo "readiness URL must be HTTPS" >&2; exit 2; }
[[ "$EXPECTED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "expected source SHA is invalid" >&2; exit 2; }
[[ "$EXPECTED_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "expected image is not digest-pinned" >&2; exit 2; }
EXPECTED_DIGEST="${EXPECTED_IMAGE##*@}"

RESPONSE="$(curl --silent --show-error --max-time 15 --max-redirs 0 --output - --write-out $'\n%{http_code}' "$URL")"
HTTP_STATUS="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"
[[ "$HTTP_STATUS" == "200" ]] || { echo "readiness returned HTTP $HTTP_STATUS" >&2; exit 1; }

OBSERVED="$(jq -c -e -s --arg version "$EXPECTED_VERSION" --arg source "$EXPECTED_SOURCE_SHA" --arg image "$EXPECTED_IMAGE" --arg digest "$EXPECTED_DIGEST" '
  if length != 1 or (.[0] | type) != "object" then error("readiness must be exactly one JSON object") else .[0] end
  | select(.status == "ok" and .storage == "postgres" and .version == $version)
  | select((has("source_sha") | not) or .source_sha == $source)
  | select((has("source") | not) or .source == $source)
  | select((has("image") | not) or .image == $image)
  | select((has("image_digest") | not) or .image_digest == $digest)
  | {status,storage,version,source_sha:(.source_sha // null),source:(.source // null),image:(.image // null),image_digest:(.image_digest // null)}
' <<<"$BODY")" || { echo "readiness JSON contract mismatch" >&2; exit 1; }

jq -n --arg url "$URL" --argjson observed "$OBSERVED" \
  '{schema:"hasna.files.readiness_receipt.v1",http_status:200,url:$url,redirects_followed:false,observed:$observed}' > "$OUT"
chmod 600 "$OUT"
