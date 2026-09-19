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
[[ "$BASE_URL" == "https://api.hasna.com/domains" ]] || { echo "canonical Domains base URL mismatch" >&2; exit 2; }
[[ -f "$API_KEY_FILE" && ! -L "$API_KEY_FILE" ]] || { echo "Domains API key file must be a regular non-symlink file" >&2; exit 2; }
[[ "$CREDENTIAL_REF" =~ ^[A-Za-z0-9/_+=.@-]+$ ]] || { echo "Domains client credential reference is invalid" >&2; exit 2; }
KEY_MODE="$(stat -c '%a' "$API_KEY_FILE")"
[[ "$KEY_MODE" == "400" || "$KEY_MODE" == "600" ]] || { echo "Domains API key file must be owner-only" >&2; exit 2; }
KEY_BYTES="$(wc -c < "$API_KEY_FILE" | tr -d '[:space:]')"
[[ "$KEY_BYTES" =~ ^[1-9][0-9]*$ && "$KEY_BYTES" -le 8192 ]] || { echo "Domains API key file is empty or too large" >&2; exit 2; }
API_KEY="$(cat "$API_KEY_FILE")"
[[ "${#API_KEY}" -eq "$KEY_BYTES" && "$API_KEY" != *[[:space:]]* ]] || { echo "Domains API key must be one non-whitespace value" >&2; exit 2; }
HEADER_FILE="$(mktemp "${RUNNER_TEMP:-/tmp}/domains-data-plane-header.XXXXXX")"
trap 'rm -f "$HEADER_FILE"' EXIT
chmod 600 "$HEADER_FILE"
printf 'x-api-key: %s\n' "$API_KEY" > "$HEADER_FILE"
unset API_KEY

request() {
  curl --silent --show-error --max-time 15 --max-redirs 0 --output - --write-out $'\n%{http_code}' "$1"
}
authenticated_request() {
  curl --silent --show-error --max-time 15 --max-redirs 0 --header "@${HEADER_FILE}" --output - --write-out $'\n%{http_code}' "$1"
}

OPENAPI_RESPONSE="$(request "${BASE_URL}/openapi.json")"
OPENAPI_STATUS="${OPENAPI_RESPONSE##*$'\n'}"
OPENAPI_BODY="${OPENAPI_RESPONSE%$'\n'*}"
[[ "$OPENAPI_STATUS" == "200" ]] || { echo "canonical Domains OpenAPI returned HTTP ${OPENAPI_STATUS}" >&2; exit 1; }
OPENAPI_PROOF="$(jq -c -e -s '
  if length != 1 or (.[0] | type) != "object" then error("OpenAPI must be exactly one JSON object") else .[0] end
  | select(.openapi | type == "string")
  | select((.paths["/v1/provisioning"].post | type) == "object")
  | select((.paths["/v1/provisioning/{id}"].get | type) == "object")
  | select((.paths["/v1/domains"].get | type) == "object")
  | select(([.paths | keys[] | select(startswith("/v1/v1"))] | length) == 0)
  | select(([.paths | keys[] | select(startswith("/v1/"))] | length) > 0)
  | {openapi,provisioning_route:"/v1/provisioning/{id}",domains_route:"/v1/domains",double_v1_paths:0}
' <<<"$OPENAPI_BODY")" || { echo "canonical Domains OpenAPI contract mismatch" >&2; exit 1; }

# A deterministic nonexistent job exercises the authenticated provisioning read
# boundary without creating a reservation or contacting a registrar.
ROUTE="${BASE_URL}/v1/provisioning/00000000-0000-4000-8000-000000000000"
ANONYMOUS_RESPONSE="$(request "$ROUTE")"
ANONYMOUS_STATUS="${ANONYMOUS_RESPONSE##*$'\n'}"
ANONYMOUS_BODY="${ANONYMOUS_RESPONSE%$'\n'*}"
[[ "$ANONYMOUS_STATUS" == "401" ]] || { echo "canonical Domains provisioning auth boundary returned HTTP ${ANONYMOUS_STATUS}" >&2; exit 1; }
jq -e -s 'length == 1 and (.[0] | type) == "object" and (.[0].error | type) == "string"' <<<"$ANONYMOUS_BODY" >/dev/null \
  || { echo "canonical Domains anonymous refusal was not one JSON error object" >&2; exit 1; }

AUTH_RESPONSE="$(authenticated_request "$ROUTE")"
AUTH_STATUS="${AUTH_RESPONSE##*$'\n'}"
AUTH_BODY="${AUTH_RESPONSE%$'\n'*}"
[[ "$AUTH_STATUS" == "404" ]] || { echo "authenticated canonical Domains provisioning read returned HTTP ${AUTH_STATUS}" >&2; exit 1; }
AUTH_PROOF="$(jq -c -e -s '
  if length != 1 or (.[0] | type) != "object" then error("provisioning refusal must be one object") else .[0] end
  | select((.error | type) == "string" and (.error | test("not found"; "i")))
  | {not_found:true}
' <<<"$AUTH_BODY")" || { echo "authenticated canonical Domains provisioning contract mismatch" >&2; exit 1; }

jq -n \
  --arg base_url "$BASE_URL" \
  --arg route "$ROUTE" \
  --arg credential_ref "$CREDENTIAL_REF" \
  --argjson openapi "$OPENAPI_PROOF" \
  --argjson authenticated "$AUTH_PROOF" \
  '{schema:"hasna.domains.canonical_data_plane.v1",base_url:$base_url,openapi:$openapi,anonymous_boundary:{url:$route,http_status:401,credentials_sent:false,redirects_followed:false},authenticated_provisioning_read:{url:$route,http_status:404,credentials_sent:true,credential_ref:$credential_ref,header:"x-api-key",redirects_followed:false,contract:$authenticated},single_v1:true,side_effects:false}' \
  > "$OUT"
chmod 600 "$OUT"
