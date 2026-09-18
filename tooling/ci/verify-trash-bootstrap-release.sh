#!/usr/bin/env bash
set -euo pipefail

# The controller stays on the existing CI-passed main lane. Only the explicitly
# reviewed staged image may retain its historical source for first migration.
[[ "${GITHUB_REPOSITORY:-}" == hasna/apps ]]
[[ "${SOURCE_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git rev-parse HEAD)" == "$SOURCE_SHA" ]]
release=$(jq -ces 'if length == 1 and (.[0] | type == "object") then .[0].bootstrap_release else error("invalid manifest") end | select(type == "object")' "$TRASH_DEPLOY_MANIFEST_FILE")
image=$(jq -er '.image | strings' <<<"$release")
source=$(jq -er '.source_sha | strings' <<<"$release")
[[ "$source" =~ ^[0-9a-f]{40}$ ]]
[[ "$image" =~ ^789877399345\.dkr\.ecr\.us-east-1\.amazonaws\.com/trash@sha256:[0-9a-f]{64}$ ]]
[[ "$image" == "$PREVIOUS_IMAGE" ]]
jq -es 'length == 1 and (.[0].failures | length == 0) and (.[0].services | length == 1) and (.[0].services[0] | .status == "ACTIVE" and .desiredCount == 0 and .runningCount == 0 and .pendingCount == 0)' "$TRASH_STAGED_SERVICE_FILE" >/dev/null
git merge-base --is-ancestor "${source}^{commit}" "${SOURCE_SHA}^{commit}"

verified_ci() {
  local sha=$1 file=$2
  gh api "repos/hasna/apps/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&head_sha=${sha}&per_page=100" > "$file"
  jq -ers --arg sha "$sha" '
    if length != 1 or (.[0].workflow_runs | type) != "array" then error("invalid CI response") else .[0].workflow_runs end
    | [.[] | select(.name == "ci" and .path == ".github/workflows/ci.yml" and .head_sha == $sha and .head_branch == "main" and .event == "push" and .status == "completed" and .conclusion == "success")
       | .id | numbers | select(. > 0 and floor == .)]
    | if length > 0 then max else error("exact source CI success required") end' "$file"
}
controller_ci=$(verified_ci "$SOURCE_SHA" "$RUNNER_TEMP/trash-bootstrap-controller-ci.json")
bootstrap_ci=$(verified_ci "$source" "$RUNNER_TEMP/trash-bootstrap-source-ci.json")
{
  printf 'source_sha=%s\n' "$source"
  printf 'image=%s\n' "$image"
  printf 'bootstrap_ci_run_id=%s\n' "$bootstrap_ci"
  printf 'controller_ci_run_id=%s\n' "$controller_ci"
} >> "$GITHUB_OUTPUT"
