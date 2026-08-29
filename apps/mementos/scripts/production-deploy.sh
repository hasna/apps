#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf 'missing required environment variable: %s\n' "$name" >&2
    exit 2
  fi
}

for name in AWS_REGION CLUSTER SERVICE WEB_FAMILY WEB_CONTAINER; do
  require_env "$name"
done

AWS_ARGS=(aws --region "$AWS_REGION")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "$AWS_PROFILE")
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT

try_aws() {
  local stdout_file="$1"
  local stderr_file="$2"
  shift 2

  set +e
  "${AWS_ARGS[@]}" "$@" > "$stdout_file" 2> "$stderr_file"
  local rc=$?
  set -e
  if (( rc != 0 )); then
    printf 'AWS command failed (rc=%s): aws %s\n' "$rc" "$*" >&2
    sed -n '1,8p' "$stderr_file" >&2
    return "$rc"
  fi
}

run_aws() {
  try_aws "$@" || exit $?
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

emit_output() {
  local line="$1"
  printf '%s\n' "$line"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s\n' "$line" >> "$GITHUB_OUTPUT"
  fi
}

settle_deployment_readback() {
  local expected_task_definition="$1"
  local service_json="$TMP_DIR/service-readback.json"
  local service_err="$TMP_DIR/service-readback.err"
  local max_attempts=6
  local delay_seconds=2
  local attempt failures services status primary_count primary_state primary_td
  local desired running pending

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    run_aws "$service_json" "$service_err" ecs describe-services \
      --cluster "$CLUSTER" --services "$SERVICE"

    failures="$(jq -r '.failures | length' "$service_json")"
    services="$(jq -r '.services | length' "$service_json")"
    status="$(jq -r '.services[0].status // ""' "$service_json")"
    primary_count="$(jq -r '[.services[0].deployments[]? | select(.status == "PRIMARY")] | length' "$service_json")"
    primary_state="$(jq -r '[.services[0].deployments[]? | select(.status == "PRIMARY") | (.rolloutState // "")][0] // ""' "$service_json")"
    primary_td="$(jq -r '[.services[0].deployments[]? | select(.status == "PRIMARY") | (.taskDefinition // "")][0] // ""' "$service_json")"
    desired="$(jq -r '.services[0].desiredCount // -1' "$service_json")"
    running="$(jq -r '.services[0].runningCount // -1' "$service_json")"
    pending="$(jq -r '.services[0].pendingCount // -1' "$service_json")"

    if [[ "$failures" == "0" && "$services" == "1" && "$status" == "ACTIVE" \
      && "$primary_count" == "1" && "$primary_state" == "COMPLETED" \
      && "$primary_td" == "$expected_task_definition" && "$desired" -ge 1 \
      && "$running" == "$desired" && "$pending" == "0" ]]; then
      return 0
    fi

    if (( attempt < max_attempts )); then
      sleep "$delay_seconds"
    fi
  done

  printf 'deployment readback did not prove one ACTIVE stable PRIMARY on expected_task_definition=%s after attempts=%s; observed failures=%s services=%s service_status=%s primary_count=%s primary_task_definition=%s primary_rollout_state=%s desired/running/pending=%s/%s/%s\n' \
    "$expected_task_definition" "$max_attempts" "$failures" "$services" \
    "$status" "$primary_count" "$primary_td" "$primary_state" \
    "$desired" "$running" "$pending" >&2
  return 1
}

LIVE_TASK_DEFINITION=""
LIVE_TASK_DEFINITION_JSON=""

preflight_service() {
  local service_json="$TMP_DIR/service-preflight.json"
  local service_err="$TMP_DIR/service-preflight.err"
  run_aws "$service_json" "$service_err" ecs describe-services \
    --cluster "$CLUSTER" --services "$SERVICE"

  local failures services status desired running pending primary_count
  local primary_state primary_td command_count command_json
  failures="$(jq -r '.failures | length' "$service_json")"
  services="$(jq -r '.services | length' "$service_json")"
  status="$(jq -r '.services[0].status // ""' "$service_json")"
  desired="$(jq -r '.services[0].desiredCount // -1' "$service_json")"
  running="$(jq -r '.services[0].runningCount // -1' "$service_json")"
  pending="$(jq -r '.services[0].pendingCount // -1' "$service_json")"
  LIVE_TASK_DEFINITION="$(jq -r '.services[0].taskDefinition // ""' "$service_json")"
  primary_count="$(jq -r '[.services[0].deployments[]? | select(.status == "PRIMARY")] | length' "$service_json")"
  primary_state="$(jq -r '.services[0].deployments[]? | select(.status == "PRIMARY") | .rolloutState // ""' "$service_json")"
  primary_td="$(jq -r '.services[0].deployments[]? | select(.status == "PRIMARY") | .taskDefinition // ""' "$service_json")"

  if [[ "$failures" != "0" || "$services" != "1" || "$status" != "ACTIVE" ]]; then
    fail "automated deploy prerequisite unmet: service lookup is not one ACTIVE service; refusing before image build, task-definition registration, or service update"
  fi
  if [[ "$desired" -lt 1 || "$running" != "$desired" || "$pending" != "0" ]]; then
    fail "automated deploy prerequisite unmet: service is not stable (desired/running/pending=${desired}/${running}/${pending}); refusing before image build, task-definition registration, or service update"
  fi
  if [[ "$primary_count" != "1" || "$primary_state" != "COMPLETED" || "$primary_td" != "$LIVE_TASK_DEFINITION" ]]; then
    fail "automated deploy prerequisite unmet: PRIMARY deployment does not prove the current stable task definition; refusing before image build, task-definition registration, or service update"
  fi

  LIVE_TASK_DEFINITION_JSON="$TMP_DIR/live-task-definition.json"
  run_aws "$LIVE_TASK_DEFINITION_JSON" "$TMP_DIR/live-task-definition.err" \
    ecs describe-task-definition --task-definition "$LIVE_TASK_DEFINITION"

  command_count="$(jq -r --arg container "$WEB_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container)] | length' \
    "$LIVE_TASK_DEFINITION_JSON")"
  command_json="$(jq -c --arg container "$WEB_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container) | (.command // [])][0] // []' \
    "$LIVE_TASK_DEFINITION_JSON")"
  # The deploy lane owns two command states. ["mementos-deploy"] marks task
  # definitions this lane registered (every revision carries the marker).
  # ["mementos-serve"] is the pre-lane legacy baseline (nested-lane/Terraform
  # era, and the image's default CMD) — accepting it is what makes the very
  # first deploy bootstrappable: the gate must not demand the marker state
  # only the deploy itself can create (O15-05020). Any other command means the
  # service is not this lane's web surface, and the deploy refuses.
  if [[ "$command_count" != "1" ]] \
    || { [[ "$command_json" != '["mementos-deploy"]' ]] && [[ "$command_json" != '["mementos-serve"]' ]]; }; then
    fail "automated deploy prerequisite unmet: stable ${LIVE_TASK_DEFINITION} does not run a deploy-lane-managed command (command=${command_json}); refusing before image build, task-definition registration, or service update"
  fi
}

CANDIDATE_DIGEST=""
CANDIDATE_IMAGE=""

resolve_candidate() {
  require_env ECR_REPOSITORY
  require_env ECR_URL
  if [[ "${ECR_URL##*/}" != "$ECR_REPOSITORY" ]]; then
    fail "ECR_URL and ECR_REPOSITORY identify different repositories"
  fi
  local candidate_sha="${CANDIDATE_SHA:-${GITHUB_SHA:-}}"
  if [[ ! "$candidate_sha" =~ ^[0-9a-f]{40}$ ]]; then
    fail "candidate SHA must be an exact 40-character lowercase Git commit"
  fi

  local image_json="$TMP_DIR/candidate-image.json"
  run_aws "$image_json" "$TMP_DIR/candidate-image.err" ecr describe-images \
    --repository-name "$ECR_REPOSITORY" \
    --image-ids "imageTag=${candidate_sha}"

  local detail_count
  detail_count="$(jq -r '.imageDetails | length' "$image_json")"
  CANDIDATE_DIGEST="$(jq -r '.imageDetails[0].imageDigest // ""' "$image_json")"
  if [[ "$detail_count" != "1" || ! "$CANDIDATE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    fail "candidate artifact is not one exact digest-backed ECR image for commit ${candidate_sha}"
  fi
  CANDIDATE_IMAGE="${ECR_URL}@${CANDIDATE_DIGEST}"
}

deploy_service() {
  # Close the build-time/pre-mutation gap: the workflow calls preflight before
  # building, and deploy repeats it immediately before any ECS mutation.
  preflight_service
  resolve_candidate

  # The production host/Origin allowlist for state-changing requests is
  # deployment config, not a code default: without it the server refuses every
  # state-changing request with 403 "Host is not allowed" (CONFIGURATION.md).
  # Fail the deploy loudly rather than silently shipping a write-refusing
  # service.
  require_env MEMENTOS_CORS_ORIGIN

  local taskdef_json="$TMP_DIR/new-task-definition.json"
  jq --arg image "$CANDIDATE_IMAGE" \
    --arg container "$WEB_CONTAINER" \
    --arg family "$WEB_FAMILY" \
    --arg cors_origin "$MEMENTOS_CORS_ORIGIN" '
      .taskDefinition
      | .family=$family
      | .containerDefinitions |= map(
          if .name==$container
          then (.image=$image
               | .command=["mementos-deploy"]
               | del(.entryPoint)
               | .environment = ((.environment // [])
                   | if any(.name == "MEMENTOS_CORS_ORIGIN")
                     then .
                     else . + [{"name":"MEMENTOS_CORS_ORIGIN","value":$cors_origin}]
                     end))
          else .
          end
        )
      | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,
            .registeredAt,.registeredBy,.deregisteredAt)
    ' "$LIVE_TASK_DEFINITION_JSON" > "$taskdef_json"

  local register_json="$TMP_DIR/register.json"
  run_aws "$register_json" "$TMP_DIR/register.err" ecs register-task-definition \
    --cli-input-json "file://${taskdef_json}"
  local new_td
  new_td="$(jq -r '.taskDefinition.taskDefinitionArn // ""' "$register_json")"
  [[ -n "$new_td" ]] || fail "task-definition registration returned no ARN"
  local registered_count registered_image registered_command
  registered_count="$(jq -r --arg container "$WEB_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container)] | length' \
    "$register_json")"
  registered_image="$(jq -r --arg container "$WEB_CONTAINER" \
    '.taskDefinition.containerDefinitions[]? | select(.name == $container) | .image // ""' \
    "$register_json")"
  registered_command="$(jq -c --arg container "$WEB_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container) | (.command // [])][0] // []' \
    "$register_json")"
  if [[ "$registered_count" != "1" || "$registered_image" != "$CANDIDATE_IMAGE" || "$registered_command" != '["mementos-deploy"]' ]]; then
    fail "registered task definition does not preserve the digest-pinned migration-gated candidate"
  fi

  run_aws "$TMP_DIR/update.json" "$TMP_DIR/update.err" ecs update-service \
    --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$new_td" --force-new-deployment
  run_aws "$TMP_DIR/wait.out" "$TMP_DIR/wait.err" ecs wait services-stable \
    --cluster "$CLUSTER" --services "$SERVICE"
  settle_deployment_readback "$new_td" || exit $?

  run_aws "$TMP_DIR/task-list.json" "$TMP_DIR/task-list.err" ecs list-tasks \
    --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status RUNNING
  local task_count
  task_count="$(jq -r '.taskArns | length' "$TMP_DIR/task-list.json")"
  (( task_count > 0 )) || fail "deployment readback returned no running service tasks"
  mapfile -t task_arns < <(jq -r '.taskArns[]' "$TMP_DIR/task-list.json")
  run_aws "$TMP_DIR/task-readback.json" "$TMP_DIR/task-readback.err" ecs describe-tasks \
    --cluster "$CLUSTER" --tasks "${task_arns[@]}"

  local task_failures readback_task_count bad_tasks
  task_failures="$(jq -r '.failures | length' "$TMP_DIR/task-readback.json")"
  readback_task_count="$(jq -r '.tasks | length' "$TMP_DIR/task-readback.json")"
  if [[ "$task_failures" != "0" || "$readback_task_count" != "$task_count" ]]; then
    fail "running task readback is incomplete"
  fi
  bad_tasks="$(jq -r \
    --arg taskdef "$new_td" \
    --arg container "$WEB_CONTAINER" \
    --arg digest "$CANDIDATE_DIGEST" '
      [
        .tasks[]?
        | select(
            .taskDefinitionArn != $taskdef
            or ([.containers[]? | select(
              .name == $container
              and .lastStatus == "RUNNING"
              and .imageDigest == $digest
            )] | length) != 1
          )
      ] | length
    ' "$TMP_DIR/task-readback.json")"
  [[ "$bad_tasks" == "0" ]] || fail "running task digest readback does not match ${CANDIDATE_DIGEST}"

  emit_output "previous_task_definition=${LIVE_TASK_DEFINITION}"
  emit_output "deployed_task_definition=${new_td}"
  emit_output "candidate_image=${CANDIDATE_IMAGE}"
  emit_output "candidate_digest=${CANDIDATE_DIGEST}"
}

rollback_service() {
  require_env PREVIOUS_TASK_DEFINITION
  require_env DEPLOYED_TASK_DEFINITION
  if [[ "$PREVIOUS_TASK_DEFINITION" == "$DEPLOYED_TASK_DEFINITION" ]]; then
    printf 'rollback refused: previous and deployed task definitions are identical\n' >&2
    return 1
  fi

  if ! try_aws "$TMP_DIR/rollback-update.json" "$TMP_DIR/rollback-update.err" \
    ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$PREVIOUS_TASK_DEFINITION" --force-new-deployment; then
    printf 'rollback failed: ECS did not accept restoration of %s\n' \
      "$PREVIOUS_TASK_DEFINITION" >&2
    return 1
  fi
  if ! try_aws "$TMP_DIR/rollback-wait.out" "$TMP_DIR/rollback-wait.err" \
    ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"; then
    printf 'rollback failed: ECS did not become stable on %s\n' \
      "$PREVIOUS_TASK_DEFINITION" >&2
    return 1
  fi
  if ! try_aws "$TMP_DIR/rollback-readback.json" "$TMP_DIR/rollback-readback.err" \
    ecs describe-services --cluster "$CLUSTER" --services "$SERVICE"; then
    printf 'rollback failed: ECS state could not be read back\n' >&2
    return 1
  fi

  local failures services status primary_count primary_state primary_td
  local desired running pending
  failures="$(jq -r '.failures | length' "$TMP_DIR/rollback-readback.json")"
  services="$(jq -r '.services | length' "$TMP_DIR/rollback-readback.json")"
  status="$(jq -r '.services[0].status // ""' "$TMP_DIR/rollback-readback.json")"
  primary_count="$(jq -r '[.services[0].deployments[]? | select(.status == "PRIMARY")] | length' "$TMP_DIR/rollback-readback.json")"
  primary_state="$(jq -r '.services[0].deployments[]? | select(.status == "PRIMARY") | .rolloutState // ""' "$TMP_DIR/rollback-readback.json")"
  primary_td="$(jq -r '.services[0].deployments[]? | select(.status == "PRIMARY") | .taskDefinition // ""' "$TMP_DIR/rollback-readback.json")"
  desired="$(jq -r '.services[0].desiredCount // -1' "$TMP_DIR/rollback-readback.json")"
  running="$(jq -r '.services[0].runningCount // -1' "$TMP_DIR/rollback-readback.json")"
  pending="$(jq -r '.services[0].pendingCount // -1' "$TMP_DIR/rollback-readback.json")"

  if [[ "$failures" != "0" || "$services" != "1" || "$status" != "ACTIVE" \
    || "$primary_count" != "1" || "$primary_state" != "COMPLETED" \
    || "$primary_td" != "$PREVIOUS_TASK_DEFINITION" || "$desired" -lt 1 \
    || "$running" != "$desired" || "$pending" != "0" ]]; then
    printf 'rollback failed: readback did not prove one ACTIVE stable PRIMARY on %s (primary=%s state=%s desired/running/pending=%s/%s/%s)\n' \
      "$PREVIOUS_TASK_DEFINITION" "$primary_td" "$primary_state" \
      "$desired" "$running" "$pending" >&2
    return 1
  fi

  emit_output "rolled_back_task_definition=${PREVIOUS_TASK_DEFINITION}"
}

verify_endpoints() {
  require_env APP_BASE_URL
  require_env PREVIOUS_TASK_DEFINITION
  require_env DEPLOYED_TASK_DEFINITION

  local path code curl_rc failure=""
  for path in /health /v1/health /ready /v1/ready; do
    set +e
    code="$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "${APP_BASE_URL}${path}")"
    curl_rc=$?
    set -e
    printf 'GET %s -> %s (curl_rc=%s)\n' "$path" "${code:-no-status}" "$curl_rc"
    if (( curl_rc != 0 )) || [[ "$code" != "200" ]]; then
      failure="endpoint ${path} returned ${code:-no-status} (curl_rc=${curl_rc})"
      break
    fi
  done

  if [[ -n "$failure" ]]; then
    printf 'deployment verification failed: %s; restoring %s\n' \
      "$failure" "$PREVIOUS_TASK_DEFINITION" >&2
    if rollback_service; then
      printf 'deployment rejected: %s; rollback restored one stable PRIMARY on %s\n' \
        "$failure" "$PREVIOUS_TASK_DEFINITION" >&2
      return 1
    fi
    printf 'deployment rejected and rollback could not be proven: %s; manual recovery required\n' \
      "$failure" >&2
    return 1
  fi

  emit_output "verified_task_definition=${DEPLOYED_TASK_DEFINITION}"
  printf 'deployment verified: all required endpoints returned 200 on %s\n' \
    "$DEPLOYED_TASK_DEFINITION"
}

case "$MODE" in
  preflight)
    preflight_service
    emit_output "live_task_definition=${LIVE_TASK_DEFINITION}"
    ;;
  deploy)
    deploy_service
    ;;
  verify)
    verify_endpoints
    ;;
  *)
    printf 'usage: %s preflight|deploy|verify\n' "$0" >&2
    exit 2
    ;;
esac
