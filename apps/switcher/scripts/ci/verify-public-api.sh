#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 || "$#" -gt 3 ]]; then
  echo "usage: $0 <https-base> <version> [--wait-for-route]" >&2
  exit 2
fi
base="$1"
version="$2"
waiting=false
if [[ "$#" == 3 ]]; then
  [[ "$3" == --wait-for-route && "$base" == https://api.hasna.com/switcher ]] || exit 2
  waiting=true
fi
[[ "$base" =~ ^https://[a-z0-9.-]+(/[a-z0-9-]+)?$ && "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
max_seconds="${SWITCHER_PUBLIC_VERIFY_TIMEOUT_SECONDS:-1200}"
delay="${SWITCHER_PUBLIC_VERIFY_DELAY_SECONDS:-10}"
[[ "$max_seconds" =~ ^[1-9][0-9]{0,3}$ && "$max_seconds" -le 1200 ]] || exit 2
[[ "$delay" =~ ^[0-9]{1,2}$ && "$delay" -le 10 ]] || exit 2
deadline=$((SECONDS + max_seconds))
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

fail_verification() {
  printf '%s endpoint=%s http_status=%s error_class=%s\n' "$1" "$request_path" "$status" "$2" >&2
  exit 1
}

request() {
  request_path="$1"
  status=000
  local remaining=$((deadline - SECONDS))
  if [[ "$remaining" -le 0 ]]; then
    fail_verification "public API verification deadline exceeded" deadline_exceeded
  fi
  if [[ "$remaining" -gt 15 ]]; then remaining=15; fi
  status="$(curl --silent --show-error --connect-timeout 5 --max-time "$remaining" \
    --max-filesize 65536 --output "$body" --write-out '%{http_code}' "$base$1" 2>/dev/null)" || status=000
}

wait_after_transient_route_failure() {
  [[ "$waiting" == true ]] || return 1
  case "$status" in
    404)
      jq -es 'length == 1 and (.[0] | type == "object" and .error == "unknown_app")' "$body" >/dev/null 2>&1 || return 1
      ;;
    000|502|503|504) ;;
    *) return 1 ;;
  esac
  local remaining=$((deadline - SECONDS))
  [[ "$remaining" -gt 0 ]] || fail_verification "public API verification deadline exceeded" deadline_exceeded
  local pause="$delay"
  if [[ "$pause" -gt "$remaining" ]]; then pause="$remaining"; fi
  sleep "$pause"
}

while true; do
  request /ready
  if wait_after_transient_route_failure; then continue; fi
  case "$status" in
    200)
      jq -es --arg version "$version" 'length == 1 and (.[0] | type == "object" and .status == "ready" and .backend == "postgresql" and .version == $version)' "$body" >/dev/null 2>&1 || {
        fail_verification "public readiness contract did not match the deployed version and PostgreSQL backend" readiness_contract_mismatch
      }
      ;;
    404) fail_verification "public readiness returned an unexpected missing route" unexpected_missing_route ;;
    000|502|503|504) fail_verification "direct origin readiness failed" direct_readiness_failed ;;
    *) fail_verification "public readiness returned a terminal status" terminal_readiness_status ;;
  esac
  request /version
  if wait_after_transient_route_failure; then continue; fi
  [[ "$status" == 200 ]] && jq -es --arg version "$version" 'length == 1 and (.[0] | type == "object" and .version == $version)' "$body" >/dev/null 2>&1 || {
    fail_verification "public version does not match the deployed package" version_contract_mismatch
  }
  request /v1/providers
  if wait_after_transient_route_failure; then continue; fi
  [[ "$status" == 401 || "$status" == 403 ]] && jq -es 'length == 1 and (.[0] | type == "object" and (.error.code | type == "string" and startswith("auth_")))' "$body" >/dev/null 2>&1 || {
    fail_verification "anonymous Switcher API request was not denied by authentication" anonymous_auth_denial_mismatch
  }
  break
done
printf 'verified public API base=%s version=%s backend=postgresql anonymous=denied\n' "$base" "$version"
