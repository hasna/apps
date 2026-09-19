#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <canonical-base-url> <api-key-file> <credential-ref> <receipt.json>" >&2
  exit 2
fi

BASE_URL="${1%/}"
API_KEY_FILE="$2"
CREDENTIAL_REF="$3"
OUT="$4"
[[ "$BASE_URL" == "https://api.hasna.com/files" ]] || { echo "canonical Files base URL mismatch" >&2; exit 2; }
[[ -f "$API_KEY_FILE" && ! -L "$API_KEY_FILE" ]] || { echo "Files API key file must be a regular non-symlink file" >&2; exit 2; }
[[ "$CREDENTIAL_REF" == "hasna/oss/files/api-key" ]] || { echo "Files client credential reference mismatch" >&2; exit 2; }
KEY_MODE="$(stat -c '%a' "$API_KEY_FILE")"
[[ "$KEY_MODE" == "400" || "$KEY_MODE" == "600" ]] || { echo "Files API key file must be owner-only (0400 or 0600)" >&2; exit 2; }
KEY_BYTES="$(wc -c < "$API_KEY_FILE" | tr -d '[:space:]')"
[[ "$KEY_BYTES" =~ ^[1-9][0-9]*$ && "$KEY_BYTES" -le 8192 ]] || { echo "Files API key file is empty or too large" >&2; exit 2; }
API_KEY="$(cat "$API_KEY_FILE")"
[[ "${#API_KEY}" -eq "$KEY_BYTES" && "$API_KEY" != *[[:space:]]* ]] || { echo "Files API key must be one non-whitespace value" >&2; exit 2; }
HEADER_FILE="$(mktemp "${RUNNER_TEMP:-/tmp}/files-data-plane-header.XXXXXX")"
trap 'rm -f "$HEADER_FILE"' EXIT
chmod 600 "$HEADER_FILE"
printf 'x-api-key: %s\n' "$API_KEY" > "$HEADER_FILE"
unset API_KEY

request() {
  local url="$1"
  curl --silent --show-error --max-time 15 --max-redirs 0 --output - --write-out $'\n%{http_code}' "$url"
}

authenticated_request() {
  local url="$1"
  curl --silent --show-error --max-time 15 --max-redirs 0 --header "@${HEADER_FILE}" --output - --write-out $'\n%{http_code}' "$url"
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
ANONYMOUS_RESPONSE="$(request "$ROUTE")"
ANONYMOUS_STATUS="${ANONYMOUS_RESPONSE##*$'\n'}"
ANONYMOUS_BODY="${ANONYMOUS_RESPONSE%$'\n'*}"
[[ "$ANONYMOUS_STATUS" == "401" ]] || { echo "canonical Files data-plane auth boundary returned HTTP ${ANONYMOUS_STATUS}" >&2; exit 1; }
jq -e -s 'length == 1 and (.[0] | type) == "object" and (.[0].error | type) == "string"' <<<"$ANONYMOUS_BODY" >/dev/null \
  || { echo "canonical Files data-plane refusal was not one JSON error object" >&2; exit 1; }

AUTHENTICATED_RESPONSE="$(authenticated_request "$ROUTE")"
AUTHENTICATED_STATUS="${AUTHENTICATED_RESPONSE##*$'\n'}"
AUTHENTICATED_BODY="${AUTHENTICATED_RESPONSE%$'\n'*}"
[[ "$AUTHENTICATED_STATUS" == "200" ]] || { echo "authenticated canonical Files manifest returned HTTP ${AUTHENTICATED_STATUS}" >&2; exit 1; }
AUTHENTICATED_PROOF="$(jq -c -e -s '
  if length != 1 or (.[0] | type) != "object" then error("manifest must be exactly one JSON object") else .[0] end
  | select(.filter_contract == "files.knowledge.manifest.v1")
  | select(.cursor_contract == "files.knowledge.manifest.change.v1")
  | select((.item_count | type) == "number")
  | select(.item_count >= 0 and .item_count <= 1 and ((.item_count | floor) == .item_count))
  | select((.items | type) == "array" and (.items | length) == .item_count)
  | select((.has_more | type) == "boolean" and (.complete | type) == "boolean")
  | select(.complete == (.has_more | not))
  | select(.delta == false)
  | select((.high_watermark | type) == "string" and (.high_watermark | length) > 0)
  | select((.delta_cursor | type) == "string" and (.delta_cursor | length) > 0)
  | {filter_contract,cursor_contract,item_count,has_more,complete,delta,high_watermark_present:true,delta_cursor_present:true}
' <<<"$AUTHENTICATED_BODY")" || { echo "authenticated canonical Files manifest contract mismatch" >&2; exit 1; }

jq -n \
  --arg base_url "$BASE_URL" \
  --arg route "$ROUTE" \
  --arg credential_ref "$CREDENTIAL_REF" \
  --argjson openapi "$OPENAPI_PROOF" \
  --argjson authenticated "$AUTHENTICATED_PROOF" \
  '{schema:"hasna.files.canonical_data_plane.v1",base_url:$base_url,openapi:$openapi,anonymous_boundary:{url:$route,http_status:401,credentials_sent:false,redirects_followed:false},authenticated_manifest:{url:$route,http_status:200,credentials_sent:true,credential_ref:$credential_ref,header:"x-api-key",redirects_followed:false,contract:$authenticated},single_v1:true}' \
  > "$OUT"
chmod 600 "$OUT"
