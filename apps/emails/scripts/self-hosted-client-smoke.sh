#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'self-hosted client smoke: %s\n' "$*" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required"

emails_cli="${EMAILS_SMOKE_CLI:-emails}"
command -v "$emails_cli" >/dev/null 2>&1 || fail "Emails CLI is not executable: $emails_cli"

# The client must be configured for the operator-owned service, and that
# selection is a fact about STORAGE configuration, not a deployment word. The
# URL and credential resolve through the shared credential resolver: either the
# canonical names, the one-release aliases, or the resolver's other tiers
# (Keychain / ~/.hasna/emails/config/credentials). A live session or identity
# token is also a credential.
if test -n "${EMAILS_SELF_HOSTED_URL:-}" || test -n "${HASNA_EMAILS_API_URL:-}"; then
  if test -z "${EMAILS_SESSION_TOKEN:-}" &&
    test -z "${EMAILS_IDP_TOKEN:-}" &&
    test -z "${EMAILS_SELF_HOSTED_API_KEY:-}" &&
    test -z "${HASNA_EMAILS_API_KEY:-}"; then
    fail "set a credential for the configured service URL"
  fi
elif test -z "${EMAILS_SESSION_TOKEN:-}" && test -z "${EMAILS_IDP_TOKEN:-}" &&
  test -z "${EMAILS_SELF_HOSTED_API_KEY:-}" && test -z "${HASNA_EMAILS_API_KEY:-}"; then
  # Neither a URL nor any credential in the environment: the resolver may still
  # find a Keychain item or a credentials file, but a smoke run should not depend
  # on the operator's machine state — require explicit configuration here.
  fail "configure the self-hosted client: set HASNA_EMAILS_API_URL / HASNA_EMAILS_API_KEY (or the EMAILS_SELF_HOSTED_URL / EMAILS_SELF_HOSTED_API_KEY aliases)"
fi

# A database-path setting is evidence of an unresolved two-store configuration,
# even when its current value is blank. Retirement proof must exercise the API
# with no local database selector available to this process.
if test "${HASNA_EMAILS_DB_PATH+x}" = "x" || test "${EMAILS_DB_PATH+x}" = "x"; then
  fail "HASNA_EMAILS_DB_PATH and EMAILS_DB_PATH must both be unset"
fi

smoke_tmp="$(mktemp -d "${TMPDIR:-/tmp}/emails-self-hosted-smoke.XXXXXX")"
cleanup() {
  rm -rf -- "$smoke_tmp"
}
trap cleanup EXIT HUP INT TERM

status_json="$smoke_tmp/status.json"
providers_json="$smoke_tmp/providers.json"
inbox_json="$smoke_tmp/inbox.json"

cli_version="$("$emails_cli" --version)"
test -n "$cli_version" || fail "emails --version returned an empty version"

"$emails_cli" status --json >"$status_json"
jq -e '
  type == "object"
  and .degraded == false
  and (.failures | type == "array" and length == 0)
' "$status_json" >/dev/null || fail "emails status did not report a healthy remote read"

"$emails_cli" provider list --json >"$providers_json"
jq -e 'type == "array"' "$providers_json" >/dev/null ||
  fail "emails provider list did not return a JSON array"

"$emails_cli" inbox list --limit 1 --json >"$inbox_json"
jq -e 'type == "array" and length <= 1' "$inbox_json" >/dev/null ||
  fail "emails inbox list did not return the requested bounded JSON array"

# Deliberately emit only aggregate proof. The command responses can contain
# operator data and remain in the private temporary directory until cleanup.
jq -n -c \
  --arg completed_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg cli_version "$cli_version" \
  '{
    schema_version: 1,
    purpose: "self-hosted-client-smoke",
    status: "passed",
    completed_at: $completed_at,
    cli_version: $cli_version,
    commands: [
      "emails --version",
      "emails status --json",
      "emails provider list --json",
      "emails inbox list --limit 1 --json"
    ]
  }'
