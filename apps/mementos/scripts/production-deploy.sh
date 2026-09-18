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

for name in AWS_REGION CLUSTER SERVICE WEB_FAMILY WEB_CONTAINER MIGRATION_FAMILY MIGRATION_CONTAINER; do
  require_env "$name"
done

AWS_ARGS=(aws --region "$AWS_REGION")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "$AWS_PROFILE")
fi

TMP_DIR="$(mktemp -d)"
ROLLBACK_ARMED=false
ROLLBACK_COMPLETED=false
DEPLOYMENT_PROVEN=false

cleanup_and_guard_rollback() {
  local rc=$?
  trap - EXIT
  if [[ "$ROLLBACK_ARMED" == "true" && "$ROLLBACK_COMPLETED" != "true" && "$DEPLOYMENT_PROVEN" != "true" ]]; then
    printf 'unexpected failure after candidate update; finalizer is restoring %s before exit
'       "${PREVIOUS_TASK_DEFINITION:-unknown}" >&2
    if rollback_service; then
      printf 'finalizer rollback restored one stable PRIMARY on %s
'         "${PREVIOUS_TASK_DEFINITION}" >&2
    else
      printf 'finalizer rollback could not be proven; manual recovery required
' >&2
    fi
    rc=1
  fi
  rm -rf -- "$TMP_DIR"
  exit "$rc"
}
trap cleanup_and_guard_rollback EXIT

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
    if ! try_aws "$service_json" "$service_err" ecs describe-services \
      --cluster "$CLUSTER" --services "$SERVICE"; then
      return 1
    fi

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
MIGRATION_TASK_DEFINITION_JSON=""

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
  # The deploy lane owns the command states below. ["mementos-deploy"] marks
  # task definitions this lane registered (every revision carries the marker).
  # ["mementos-serve"] and [] are the pre-lane legacy baselines (nested-lane/
  # Terraform era): the live task definition carries NO command override
  # (measured: mementos-prod:29 command=null), and a null/absent command runs
  # the image's default CMD, which is ["mementos-serve"]. Accepting those is
  # what makes the very first deploy bootstrappable: the gate must not demand
  # the marker state only the deploy itself can create (O15-05020). Any other
  # command means the service is not this lane's web surface, and the deploy
  # refuses.
  if [[ "$command_count" != "1" ]] \
    || { [[ "$command_json" != '["mementos-deploy"]' ]] \
      && [[ "$command_json" != '["mementos-serve"]' ]] \
      && [[ "$command_json" != '[]' ]]; }; then
    fail "automated deploy prerequisite unmet: stable ${LIVE_TASK_DEFINITION} does not run a deploy-lane-managed command (command=${command_json}); refusing before image build, task-definition registration, or service update"
  fi
}

preflight_migration_template() {
  MIGRATION_TASK_DEFINITION_JSON="$TMP_DIR/live-migration-task-definition.json"
  run_aws "$MIGRATION_TASK_DEFINITION_JSON" "$TMP_DIR/live-migration-task-definition.err" \
    ecs describe-task-definition --task-definition "$MIGRATION_FAMILY"

  local family container_count command_json
  family="$(jq -r '.taskDefinition.family // ""' "$MIGRATION_TASK_DEFINITION_JSON")"
  container_count="$(jq -r --arg container "$MIGRATION_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container)] | length' \
    "$MIGRATION_TASK_DEFINITION_JSON")"
  command_json="$(jq -c --arg container "$MIGRATION_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container) | (.command // [])][0] // []' \
    "$MIGRATION_TASK_DEFINITION_JSON")"
  if [[ "$family" != "$MIGRATION_FAMILY" || "$container_count" != "1" \
    || "$command_json" != '["mementos","storage","migrate"]' ]]; then
    fail "migration prerequisite unmet: ${MIGRATION_FAMILY} must contain exactly one ${MIGRATION_CONTAINER} container running mementos storage migrate"
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

run_migration_task() {
  local task_definition="$1"
  local service_json="$TMP_DIR/service-preflight.json"
  local network_json="$TMP_DIR/migration-network.json"
  local capacity_json="$TMP_DIR/migration-capacity.json"
  local overrides_json="$TMP_DIR/migration-overrides.json"
  local run_json="$TMP_DIR/migration-run.json"
  local stopped_json="$TMP_DIR/migration-stopped.json"

  [[ -s "$service_json" ]] || fail "migration refused: stable service preflight evidence is missing"
  jq -e '
    .services[0].networkConfiguration
    | select(.awsvpcConfiguration.subnets | type == "array" and length > 0)
    | select(.awsvpcConfiguration.securityGroups | type == "array" and length > 0)
    | select(.awsvpcConfiguration.assignPublicIp == "ENABLED" or .awsvpcConfiguration.assignPublicIp == "DISABLED")
  ' "$service_json" > "$network_json" || fail "migration refused: service network configuration is incomplete"
  jq -e '.services[0].capacityProviderStrategy | select(type == "array" and length > 0)' \
    "$service_json" > "$capacity_json" || fail "migration refused: service has no capacity-provider strategy"
  jq -n --arg container "$MIGRATION_CONTAINER" '{
    containerOverrides: [{
      name: $container,
      command: ["mementos", "storage", "migrate"]
    }]
  }' > "$overrides_json"

  run_aws "$run_json" "$TMP_DIR/migration-run.err" ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$task_definition" \
    --capacity-provider-strategy "file://${capacity_json}" \
    --network-configuration "file://${network_json}" \
    --overrides "file://${overrides_json}" \
    --count 1

  local failures task_count migration_task
  failures="$(jq -r '.failures | length' "$run_json")"
  task_count="$(jq -r '.tasks | length' "$run_json")"
  migration_task="$(jq -r '.tasks[0].taskArn // ""' "$run_json")"
  if [[ "$failures" != "0" || "$task_count" != "1" || -z "$migration_task" ]]; then
    fail "migration task launch did not return exactly one task"
  fi

  run_aws "$TMP_DIR/migration-wait.out" "$TMP_DIR/migration-wait.err" ecs wait tasks-stopped \
    --cluster "$CLUSTER" --tasks "$migration_task"
  run_aws "$stopped_json" "$TMP_DIR/migration-stopped.err" ecs describe-tasks \
    --cluster "$CLUSTER" --tasks "$migration_task"

  local stopped_failures stopped_count observed_td container_count exit_code image_digest
  local stop_code stopped_reason container_reason
  stopped_failures="$(jq -r '.failures | length' "$stopped_json")"
  stopped_count="$(jq -r '.tasks | length' "$stopped_json")"
  observed_td="$(jq -r '.tasks[0].taskDefinitionArn // ""' "$stopped_json")"
  container_count="$(jq -r --arg container "$MIGRATION_CONTAINER" '[.tasks[0].containers[]? | select(.name == $container)] | length' "$stopped_json")"
  exit_code="$(jq -r --arg container "$MIGRATION_CONTAINER" '[.tasks[0].containers[]? | select(.name == $container) | .exitCode][0] // -1' "$stopped_json")"
  image_digest="$(jq -r --arg container "$MIGRATION_CONTAINER" '[.tasks[0].containers[]? | select(.name == $container) | .imageDigest][0] // ""' "$stopped_json")"
  stop_code="$(jq -r '.tasks[0].stopCode // ""' "$stopped_json")"
  stopped_reason="$(jq -r '.tasks[0].stoppedReason // ""' "$stopped_json")"
  container_reason="$(jq -r --arg container "$MIGRATION_CONTAINER" '[.tasks[0].containers[]? | select(.name == $container) | (.reason // "")][0] // ""' "$stopped_json")"

  printf 'migration task=%s task_definition=%s exit_code=%s stop_code=%s image_digest=%s\n' \
    "$migration_task" "$observed_td" "$exit_code" "${stop_code:-none}" "$image_digest"
  if [[ "$stopped_failures" != "0" || "$stopped_count" != "1" \
    || "$observed_td" != "$task_definition" || "$container_count" != "1" \
    || "$exit_code" != "0" || "$image_digest" != "$CANDIDATE_DIGEST" ]]; then
    printf 'migration failed: stopped_reason=%s container_reason=%s\n' \
      "${stopped_reason:-none}" "${container_reason:-none}" >&2
    fail "migration task did not prove an exact-image transactional migration with exit code 0"
  fi

  emit_output "migration_task_definition=${task_definition}"
  emit_output "migration_task=${migration_task}"
  emit_output "migration_exit_code=0"
}

deploy_service() {
  # Close the build-time/pre-mutation gap: the workflow calls preflight before
  # building, and deploy repeats it immediately before any ECS mutation.
  preflight_service
  preflight_migration_template
  resolve_candidate

  # The production host/Origin allowlist for state-changing requests is
  # deployment config, not a code default: without it the server refuses every
  # state-changing request with 403 "Host is not allowed" (CONFIGURATION.md).
  # Fail the deploy loudly rather than silently shipping a write-refusing
  # service.
  require_env MEMENTOS_CORS_ORIGIN

  local migration_taskdef_json="$TMP_DIR/new-migration-task-definition.json"
  jq --arg image "$CANDIDATE_IMAGE" \
    --arg container "$MIGRATION_CONTAINER" \
    --arg family "$MIGRATION_FAMILY" '
      .taskDefinition
      | .family=$family
      | .containerDefinitions |= map(
          if .name==$container
          then (.image=$image
               | .command=["mementos","storage","migrate"])
          else .
          end
        )
      | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,
            .registeredAt,.registeredBy,.deregisteredAt)
    ' "$MIGRATION_TASK_DEFINITION_JSON" > "$migration_taskdef_json"

  local migration_register_json="$TMP_DIR/register-migration.json"
  run_aws "$migration_register_json" "$TMP_DIR/register-migration.err" ecs register-task-definition \
    --cli-input-json "file://${migration_taskdef_json}"
  local migration_td migration_registered_count migration_registered_image migration_registered_command
  migration_td="$(jq -r '.taskDefinition.taskDefinitionArn // ""' "$migration_register_json")"
  migration_registered_count="$(jq -r --arg container "$MIGRATION_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container)] | length' \
    "$migration_register_json")"
  migration_registered_image="$(jq -r --arg container "$MIGRATION_CONTAINER" \
    '.taskDefinition.containerDefinitions[]? | select(.name == $container) | .image // ""' \
    "$migration_register_json")"
  migration_registered_command="$(jq -c --arg container "$MIGRATION_CONTAINER" \
    '[.taskDefinition.containerDefinitions[]? | select(.name == $container) | (.command // [])][0] // []' \
    "$migration_register_json")"
  if [[ -z "$migration_td" || "$migration_registered_count" != "1" \
    || "$migration_registered_image" != "$CANDIDATE_IMAGE" \
    || "$migration_registered_command" != '["mementos","storage","migrate"]' ]]; then
    fail "registered migration task definition does not preserve the digest-pinned candidate and migration command"
  fi

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

  # The runtime never applies PostgreSQL DDL. Run the exact candidate image in
  # the IAM-sanctioned migration family (which preserves the owner DSN) first;
  # applyPgMigrations serializes migration 41
  # with a transaction-level advisory lock and records its receipt in the same
  # transaction. A refusal (including unsafe legacy machine rows) exits nonzero
  # and stops before the service task definition is updated.
  run_migration_task "$migration_td"

  # From the first update-service attempt onward, every failure is an
  # uncertain production mutation. Keep the rollback anchor in this same shell
  # step and restore it before returning failure; the later verify step may be
  # skipped by Actions when this step fails, so it cannot own this recovery.
  export PREVIOUS_TASK_DEFINITION="$LIVE_TASK_DEFINITION"
  export DEPLOYED_TASK_DEFINITION="$new_td"
  local deployment_failure=""
  ROLLBACK_ARMED=true

  if ! try_aws "$TMP_DIR/update.json" "$TMP_DIR/update.err" ecs update-service \
    --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$new_td" --force-new-deployment; then
    deployment_failure="ECS update-service did not return success"
  elif ! try_aws "$TMP_DIR/wait.out" "$TMP_DIR/wait.err" ecs wait services-stable \
    --cluster "$CLUSTER" --services "$SERVICE"; then
    deployment_failure="ECS services-stable waiter failed after candidate activation"
  elif ! settle_deployment_readback "$new_td"; then
    deployment_failure="strict service readback failed after candidate activation"
  elif ! try_aws "$TMP_DIR/task-list.json" "$TMP_DIR/task-list.err" ecs list-tasks \
    --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status RUNNING; then
    deployment_failure="running task list failed after candidate activation"
  else
    local task_count
    task_count="$(jq -r '.taskArns | length' "$TMP_DIR/task-list.json")"
    if (( task_count == 0 )); then
      deployment_failure="deployment readback returned no running service tasks"
    else
      task_arns=()
      while IFS= read -r task_arn; do
        [[ -n "$task_arn" ]] && task_arns+=("$task_arn")
      done < <(jq -r '.taskArns[]' "$TMP_DIR/task-list.json")
      if ! try_aws "$TMP_DIR/task-readback.json" "$TMP_DIR/task-readback.err" ecs describe-tasks \
        --cluster "$CLUSTER" --tasks "${task_arns[@]}"; then
        deployment_failure="running task detail readback failed after candidate activation"
      else
        local task_failures readback_task_count bad_tasks
        task_failures="$(jq -r '.failures | length' "$TMP_DIR/task-readback.json")"
        readback_task_count="$(jq -r '.tasks | length' "$TMP_DIR/task-readback.json")"
        if [[ "$task_failures" != "0" || "$readback_task_count" != "$task_count" ]]; then
          deployment_failure="running task readback is incomplete"
        else
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
          if [[ "$bad_tasks" != "0" ]]; then
            deployment_failure="running task digest readback does not match ${CANDIDATE_DIGEST}"
          fi
        fi
      fi
    fi
  fi

  if [[ -n "$deployment_failure" ]]; then
    printf 'candidate deployment proof failed: %s; restoring %s in the same guarded step\n' \
      "$deployment_failure" "$PREVIOUS_TASK_DEFINITION" >&2
    if rollback_service; then
      ROLLBACK_COMPLETED=true
      ROLLBACK_ARMED=false
      fail "candidate deployment rejected: ${deployment_failure}; rollback restored one stable PRIMARY on ${PREVIOUS_TASK_DEFINITION}"
    fi
    ROLLBACK_COMPLETED=true
    ROLLBACK_ARMED=false
    fail "candidate deployment failed and rollback could not be proven: ${deployment_failure}; manual recovery required"
  fi

  emit_output "previous_task_definition=${LIVE_TASK_DEFINITION}"
  emit_output "deployed_task_definition=${new_td}"
  emit_output "candidate_image=${CANDIDATE_IMAGE}"
  emit_output "candidate_digest=${CANDIDATE_DIGEST}"
  DEPLOYMENT_PROVEN=true
  ROLLBACK_ARMED=false
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
