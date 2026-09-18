#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <canonical-base-url> <receipt.json>" >&2
  exit 2
fi

BASE_URL="${1%/}"
OUT="$2"
[[ "$BASE_URL" == "https://api.hasna.com/files" ]] || { echo "canonical Files base URL mismatch" >&2; exit 2; }

request() {
  local url="$1"
  curl --silent --show-error --max-time 15 --max-redirs 0 --output - --write-out $'\n%{http_code}' "$url"
}

OPENAPI_RESPONSE="$(request "${BASE_URL}/openapi.json")"
OPENAPI_STATUS="${OPENAPI_RESPONSE##*$'\n'}"
OPENAPI_BODY="${OPENAPI_RESPONSE%$'\n'*}"
[[ "$OPENAPI_STATUS" == "200" ]] || { echo "canonical Files OpenAPI returned HTTP ${OPENAPI_STATUS}" >&2; exit 1; }

OPENAPI_PROOF="$(jq -c -e -s '
  if length != 1 or (.[0] | type) != "object" then error("OpenAPI must be exactly one JSON object") else .[0] end
  | select(.openapi | type == "string")
  | select(.servers == [{"url":"/v1"}])
  | select((.paths["/knowledge/manifest"].get | type) == "object")
  | select(([.paths | keys[] | select(startswith("/v1"))] | length) == 0)
  | {openapi,server:.servers[0].url,route:"/knowledge/manifest",double_v1_paths:0}
' <<<"$OPENAPI_BODY")" || { echo "canonical Files OpenAPI data-plane contract mismatch" >&2; exit 1; }

ROUTE="${BASE_URL}/v1/knowledge/manifest?limit=1"
ROUTE_RESPONSE="$(request "$ROUTE")"
ROUTE_STATUS="${ROUTE_RESPONSE##*$'\n'}"
ROUTE_BODY="${ROUTE_RESPONSE%$'\n'*}"
[[ "$ROUTE_STATUS" == "401" ]] || { echo "canonical Files data-plane auth boundary returned HTTP ${ROUTE_STATUS}" >&2; exit 1; }
jq -e -s 'length == 1 and (.[0] | type) == "object" and (.[0].error | type) == "string"' <<<"$ROUTE_BODY" >/dev/null \
  || { echo "canonical Files data-plane refusal was not one JSON error object" >&2; exit 1; }

jq -n \
  --arg base_url "$BASE_URL" \
  --arg route "$ROUTE" \
  --argjson openapi "$OPENAPI_PROOF" \
  '{schema:"hasna.files.canonical_data_plane.v1",base_url:$base_url,openapi:$openapi,probe:{url:$route,http_status:401,credentials_sent:false,redirects_followed:false},single_v1:true}' \
  > "$OUT"
chmod 600 "$OUT"
