#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 9 ]; then
  echo "usage: $0 <cluster> <service> <candidate-task-definition> <previous-task-definition> <source-sha> <candidate-image> <previous-image> <rollback.json> <reconciliation.json>" >&2
  exit 2
fi

CLUSTER="$1"
SERVICE="$2"
CANDIDATE_TASK_DEFINITION="$3"
PREVIOUS_TASK_DEFINITION="$4"
SOURCE_SHA="$5"
CANDIDATE_IMAGE="$6"
PREVIOUS_IMAGE="$7"
ROLLBACK_OUT="$8"
RECONCILIATION_OUT="$9"

[[ "$CANDIDATE_TASK_DEFINITION" == *":task-definition/"*:* ]] || { echo "candidate task definition must be an ARN revision" >&2; exit 2; }
[[ "$PREVIOUS_TASK_DEFINITION" == *":task-definition/"*:* ]] || { echo "previous task definition must be an ARN revision" >&2; exit 2; }
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "source SHA is invalid" >&2; exit 2; }
[[ "$CANDIDATE_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "candidate image is not digest-pinned" >&2; exit 2; }
[[ "$PREVIOUS_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "previous image is not digest-pinned" >&2; exit 2; }

SERVICE_JSON="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output json)"
jq -e '(.failures | length) == 0 and (.services | length) == 1' <<<"$SERVICE_JSON" >/dev/null
OBSERVED_TASK_DEFINITION="$(jq -er '.services[0].taskDefinition' <<<"$SERVICE_JSON")"
DEPLOYMENTS="$(jq -c '[.services[0].deployments[]? | {status,rolloutState:(.rolloutState // "UNKNOWN"),taskDefinition,desiredCount,runningCount,pendingCount}]' <<<"$SERVICE_JSON")"
PRIMARY_COUNT="$(jq '[.services[0].deployments[]? | select(.status == "PRIMARY" and .taskDefinition == $candidate)] | length' --arg candidate "$CANDIDATE_TASK_DEFINITION" <<<"$SERVICE_JSON")"

if [ "$OBSERVED_TASK_DEFINITION" != "$CANDIDATE_TASK_DEFINITION" ] || [ "$PRIMARY_COUNT" != "1" ]; then
  jq -n \
    --arg source_sha "$SOURCE_SHA" \
    --arg cluster "$CLUSTER" \
    --arg service "$SERVICE" \
    --arg candidate_task_definition "$CANDIDATE_TASK_DEFINITION" \
    --arg candidate_image "$CANDIDATE_IMAGE" \
    --arg previous_task_definition "$PREVIOUS_TASK_DEFINITION" \
    --arg previous_image "$PREVIOUS_IMAGE" \
    --arg observed_task_definition "$OBSERVED_TASK_DEFINITION" \
    --argjson deployments "$DEPLOYMENTS" \
    '{schema:"hasna.domains.deployment_reconciliation_required.v1",status:"RECONCILIATION_REQUIRED",reason:"concurrent_service_change_before_rollback",source_sha:$source_sha,cluster:$cluster,service:$service,candidate:{task_definition:$candidate_task_definition,image:$candidate_image},previous:{task_definition:$previous_task_definition,image:$previous_image},observed:{task_definition:$observed_task_definition,deployments:$deployments},automatic_rollback_performed:false}' \
    > "$RECONCILIATION_OUT"
  chmod 600 "$RECONCILIATION_OUT"
  echo "rollback CAS refused: candidate=$CANDIDATE_TASK_DEFINITION observed=$OBSERVED_TASK_DEFINITION" >&2
  exit 1
fi

# The immediately preceding read is the ECS control plane's available CAS
# boundary: only this run's exact candidate may be replaced by its captured
# predecessor. A different current task definition is never overwritten.
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$PREVIOUS_TASK_DEFINITION" >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
FINAL_JSON="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output json)"
FINAL_TASK_DEFINITION="$(jq -er '.services[0].taskDefinition' <<<"$FINAL_JSON")"
[[ "$FINAL_TASK_DEFINITION" == "$PREVIOUS_TASK_DEFINITION" ]] || { echo "rollback did not restore the previous task definition" >&2; exit 1; }

jq -n \
  --arg source_sha "$SOURCE_SHA" \
  --arg cluster "$CLUSTER" \
  --arg service "$SERVICE" \
  --arg candidate_task_definition "$CANDIDATE_TASK_DEFINITION" \
  --arg candidate_image "$CANDIDATE_IMAGE" \
  --arg previous_task_definition "$PREVIOUS_TASK_DEFINITION" \
  --arg previous_image "$PREVIOUS_IMAGE" \
  '{schema:"hasna.domains.rollback_receipt.v1",source_sha:$source_sha,cluster:$cluster,service:$service,candidate:{task_definition:$candidate_task_definition,image:$candidate_image},restored:{task_definition:$previous_task_definition,image:$previous_image},automatic_rollback_performed:true,cas_anchor_verified:true}' \
  > "$ROLLBACK_OUT"
chmod 600 "$ROLLBACK_OUT"
