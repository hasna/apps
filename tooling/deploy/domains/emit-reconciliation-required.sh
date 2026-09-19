#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <reconciliation.json>" >&2
  exit 2
fi

OUT="$1"
TMP="${OUT}.tmp.$$"
SCRIPT_STATUS=0

write_fallback() {
  local status="$1"
  trap - ERR
  rm -f "$TMP"
  jq -n \
    --arg source_sha "${SOURCE_SHA:-unavailable}" \
    --arg reason "${RECONCILIATION_REASON:-reconciliation_capture_failed}" \
    --argjson capture_status "$status" \
    '{schema:"hasna.domains.deployment_reconciliation_required.v2",status:"RECONCILIATION_REQUIRED",reason:$reason,source_sha:$source_sha,capture:{complete:false,command_status:$capture_status},schema_advanced:null,observed:{service:{describe_available:false},tasks:{describe_available:false}},automatic_rollback_performed:null}' \
    > "$TMP" 2>/dev/null || printf '%s\n' '{"schema":"hasna.domains.deployment_reconciliation_required.v2","status":"RECONCILIATION_REQUIRED","reason":"reconciliation_capture_failed","capture":{"complete":false},"observed":{"service":{"describe_available":false},"tasks":{"describe_available":false}},"automatic_rollback_performed":null}' > "$TMP"
  chmod 600 "$TMP"
  mv -f "$TMP" "$OUT"
  exit 0
}
trap 'SCRIPT_STATUS=$?; write_fallback "$SCRIPT_STATUS"' ERR

: "${CLUSTER:?CLUSTER is required}"
: "${SERVICE:?SERVICE is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}"
: "${PREVIOUS_TASK_DEFINITION:?PREVIOUS_TASK_DEFINITION is required}"
: "${PREVIOUS_IMAGE:?PREVIOUS_IMAGE is required}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$CANDIDATE_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]
[[ "$PREVIOUS_TASK_DEFINITION" == *":task-definition/"*:* ]]
[[ -n "$PREVIOUS_IMAGE" ]]

SERVICE_MUTATED="${SERVICE_MUTATED:-false}"
[[ "$SERVICE_MUTATED" == "true" || "$SERVICE_MUTATED" == "false" ]]
SCHEMA_ADVANCED="${SCHEMA_ADVANCED:-unknown}"
[[ "$SCHEMA_ADVANCED" == "true" || "$SCHEMA_ADVANCED" == "false" || "$SCHEMA_ADVANCED" == "unknown" ]]
AUTOMATIC_ROLLBACK_PERFORMED="${AUTOMATIC_ROLLBACK_PERFORMED:-false}"
[[ "$AUTOMATIC_ROLLBACK_PERFORMED" == "true" || "$AUTOMATIC_ROLLBACK_PERFORMED" == "false" || "$AUTOMATIC_ROLLBACK_PERFORMED" == "unknown" ]]

if [ -n "${RECONCILIATION_REASON:-}" ]; then
  REASON="$RECONCILIATION_REASON"
elif [ "$SCHEMA_ADVANCED" = "true" ] && [ "$SERVICE_MUTATED" = "false" ]; then
  REASON="failure_after_schema_advance_before_service_mutation"
elif [ "$SCHEMA_ADVANCED" = "true" ]; then
  REASON="service_failure_after_schema_advance"
else
  REASON="deployment_state_uncertain"
fi

json_file_or_null() {
  local file="$1"
  if [ -f "$file" ] && jq -e . "$file" >/dev/null 2>&1; then jq -c . "$file"; else printf 'null'; fi
}

SERVICE_FILE="$(mktemp "${RUNNER_TEMP:-/tmp}/domains-reconcile-service.XXXXXX")"
TASKS_FILE="$(mktemp "${RUNNER_TEMP:-/tmp}/domains-reconcile-tasks.XXXXXX")"
trap 'rm -f "$SERVICE_FILE" "$TASKS_FILE" "$TMP"' EXIT

SERVICE_STATUS=0
if aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output json > "$SERVICE_FILE" 2>/dev/null \
  && jq -e '(.failures | length) == 0 and (.services | length) == 1' "$SERVICE_FILE" >/dev/null 2>&1; then
  SERVICE_STATE="$(jq -c '
    .services[0]
    | {
        describe_available:true,
        status,
        task_definition:.taskDefinition,
        desired_count:.desiredCount,
        running_count:.runningCount,
        pending_count:.pendingCount,
        deployments:[.deployments[]? | {
          id,
          status,
          rollout_state:(.rolloutState // "UNKNOWN"),
          task_definition:.taskDefinition,
          desired_count:.desiredCount,
          running_count:.runningCount,
          pending_count:.pendingCount
        }]
      }
  ' "$SERVICE_FILE")"
else
  SERVICE_STATUS=$?
  SERVICE_STATE="$(jq -cn --argjson command_status "$SERVICE_STATUS" '{describe_available:false,command_status:$command_status}')"
fi

TASK_ARNS='[]'
TASK_LIST_STATUS=0
for desired_status in RUNNING PENDING; do
  if listed="$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" --desired-status "$desired_status" --max-results 100 --output json 2>/dev/null)" \
    && jq -e '.taskArns | type == "array"' <<<"$listed" >/dev/null 2>&1; then
    TASK_ARNS="$(jq -cn --argjson left "$TASK_ARNS" --argjson right "$(jq -c '.taskArns' <<<"$listed")" '$left + $right | unique | .[0:100]')"
  else
    TASK_LIST_STATUS=$?
    break
  fi
done

if [ "$TASK_LIST_STATUS" -ne 0 ]; then
  TASK_STATE="$(jq -cn --argjson command_status "$TASK_LIST_STATUS" '{list_available:false,describe_available:false,command_status:$command_status,tasks:[]}')"
elif [ "$(jq 'length' <<<"$TASK_ARNS")" -eq 0 ]; then
  TASK_STATE='{"list_available":true,"describe_available":true,"tasks":[],"failures":[]}'
else
  mapfile -t TASK_ARN_ARGS < <(jq -r '.[]' <<<"$TASK_ARNS")
  if aws ecs describe-tasks --cluster "$CLUSTER" --tasks "${TASK_ARN_ARGS[@]}" --output json > "$TASKS_FILE" 2>/dev/null \
    && jq -e '(.tasks | type == "array") and (.failures | type == "array")' "$TASKS_FILE" >/dev/null 2>&1; then
    TASK_STATE="$(jq -c '{
      list_available:true,
      describe_available:true,
      tasks:[.tasks[0:100][] | {
        task_arn:.taskArn,
        task_definition:.taskDefinitionArn,
        last_status:.lastStatus,
        desired_status:.desiredStatus,
        health_status:(.healthStatus // "UNKNOWN"),
        launch_type:(.launchType // null),
        containers:[.containers[]? | {
          name,
          last_status:.lastStatus,
          image,
          image_digest:(.imageDigest // null),
          exit_code:(.exitCode // null)
        }]
      }],
      failures:[.failures[0:100][]? | {arn,reason}]
    }' "$TASKS_FILE")"
  else
    TASK_DESCRIBE_STATUS=$?
    TASK_STATE="$(jq -cn --argjson command_status "$TASK_DESCRIBE_STATUS" --argjson task_arns "$TASK_ARNS" '{list_available:true,describe_available:false,command_status:$command_status,task_arns:$task_arns,tasks:[]}')"
  fi
fi

LEDGER_BEFORE="$(json_file_or_null "${LEDGER_BEFORE_FILE:-ledger-before.json}")"
LEDGER_AFTER="$(json_file_or_null "${LEDGER_AFTER_FILE:-ledger-after.json}")"
MIGRATION_LAUNCH="$(json_file_or_null "${MIGRATION_LAUNCH_FILE:-migration-launch.json}")"
MIGRATION_OBSERVED="$(json_file_or_null "${MIGRATION_OBSERVED_FILE:-migration-observed.json}")"

jq -n \
  --arg source_sha "$SOURCE_SHA" \
  --arg reason "$REASON" \
  --arg cluster "$CLUSTER" \
  --arg service "$SERVICE" \
  --arg candidate_task_definition "${CANDIDATE_TASK_DEFINITION:-}" \
  --arg candidate_image "$CANDIDATE_IMAGE" \
  --arg previous_task_definition "$PREVIOUS_TASK_DEFINITION" \
  --arg previous_image "$PREVIOUS_IMAGE" \
  --arg schema_advanced "$SCHEMA_ADVANCED" \
  --arg service_mutated "$SERVICE_MUTATED" \
  --arg deploy_outcome "${DEPLOY_OUTCOME:-unknown}" \
  --arg verify_outcome "${VERIFY_OUTCOME:-unknown}" \
  --arg automatic_rollback "$AUTOMATIC_ROLLBACK_PERFORMED" \
  --argjson ledger_before "$LEDGER_BEFORE" \
  --argjson ledger_after "$LEDGER_AFTER" \
  --argjson migration_launch "$MIGRATION_LAUNCH" \
  --argjson migration_observed "$MIGRATION_OBSERVED" \
  --argjson service_state "$SERVICE_STATE" \
  --argjson task_state "$TASK_STATE" \
  '{
    schema:"hasna.domains.deployment_reconciliation_required.v2",
    status:"RECONCILIATION_REQUIRED",
    reason:$reason,
    source_sha:$source_sha,
    cluster:$cluster,
    service:$service,
    schema_advanced:(if $schema_advanced == "true" then true elif $schema_advanced == "false" then false else null end),
    deployment:{service_mutated:($service_mutated == "true"),deploy_outcome:$deploy_outcome,verify_outcome:$verify_outcome},
    candidate:{task_definition:(if $candidate_task_definition == "" then null else $candidate_task_definition end),image:$candidate_image},
    previous:{task_definition:$previous_task_definition,image:$previous_image,compatibility:(if $schema_advanced == "true" then "unproven_against_advanced_schema" else "schema_not_advanced" end)},
    ledger:{before:$ledger_before,after:$ledger_after},
    migration:{launch:$migration_launch,observed:$migration_observed},
    observed:{service:$service_state,tasks:$task_state},
    capture:{complete:true},
    automatic_rollback_performed:(if $automatic_rollback == "true" then true elif $automatic_rollback == "false" then false else null end)
  }' > "$TMP"
chmod 600 "$TMP"
mv -f "$TMP" "$OUT"
trap - ERR EXIT
rm -f "$SERVICE_FILE" "$TASKS_FILE"
