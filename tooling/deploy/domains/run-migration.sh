#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 10 ]; then
  echo "usage: $0 <cluster> <task-definition> <container> <subnets> <security-groups> <assign-public-ip> <candidate-image> <source-sha> <launch.json> <observed.json>" >&2
  exit 2
fi

CLUSTER="$1"
REQUESTED_TASK_DEFINITION="$2"
CONTAINER="$3"
SUBNETS="$4"
SECURITY_GROUPS="$5"
ASSIGN_PUBLIC_IP="$6"
CANDIDATE_IMAGE="$7"
SOURCE_SHA="$8"
LAUNCH_OUT="$9"
OBSERVED_OUT="${10}"
TASK_ARN=""

[[ "$REQUESTED_TASK_DEFINITION" == *":task-definition/"*:* ]] || { echo "requested migration task definition must be an ARN revision" >&2; exit 2; }
[[ "$CANDIDATE_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "candidate image is not digest-pinned" >&2; exit 2; }
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "source SHA is invalid" >&2; exit 2; }

capture_observed() {
  local reason="$1"
  local command_status="$2"
  local described=""
  local describe_status=0
  set +e
  if [ -n "$TASK_ARN" ]; then
    described="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json 2>/dev/null)"
    describe_status=$?
  else
    describe_status=1
  fi
  set -e

  if [ "$describe_status" -eq 0 ] && jq -e '.tasks | length == 1' <<<"$described" >/dev/null 2>&1; then
    jq -n \
      --arg source_sha "$SOURCE_SHA" \
      --arg reason "$reason" \
      --argjson command_status "$command_status" \
      --arg requested_task_definition "$REQUESTED_TASK_DEFINITION" \
      --arg candidate_image "$CANDIDATE_IMAGE" \
      --arg task_arn "$TASK_ARN" \
      --arg observed_task_definition "$(jq -r '.tasks[0].taskDefinitionArn // ""' <<<"$described")" \
      --arg last_status "$(jq -r '.tasks[0].lastStatus // "UNKNOWN"' <<<"$described")" \
      --arg stop_code "$(jq -r '.tasks[0].stopCode // ""' <<<"$described")" \
      --arg stopped_reason "$(jq -r '.tasks[0].stoppedReason // ""' <<<"$described")" \
      --arg container_image "$(jq -r --arg c "$CONTAINER" '.tasks[0].containers[]? | select(.name == $c) | .image // ""' <<<"$described")" \
      --arg container_digest "$(jq -r --arg c "$CONTAINER" '.tasks[0].containers[]? | select(.name == $c) | .imageDigest // ""' <<<"$described")" \
      --arg container_status "$(jq -r --arg c "$CONTAINER" '.tasks[0].containers[]? | select(.name == $c) | .lastStatus // "UNKNOWN"' <<<"$described")" \
      --arg exit_code "$(jq -r --arg c "$CONTAINER" '.tasks[0].containers[]? | select(.name == $c) | .exitCode // ""' <<<"$described")" \
      '{schema:"hasna.domains.migration_observed_state.v1",source_sha:$source_sha,capture_reason:$reason,command_status:$command_status,requested:{task_definition:$requested_task_definition,image:$candidate_image},task_arn:$task_arn,describe_available:true,observed:{task_definition:$observed_task_definition,last_status:$last_status,stop_code:$stop_code,stopped_reason:$stopped_reason,container:{image:$container_image,image_digest:$container_digest,last_status:$container_status,exit_code:$exit_code}}}' > "$OBSERVED_OUT"
  else
    jq -n \
      --arg source_sha "$SOURCE_SHA" \
      --arg reason "$reason" \
      --argjson command_status "$command_status" \
      --arg requested_task_definition "$REQUESTED_TASK_DEFINITION" \
      --arg candidate_image "$CANDIDATE_IMAGE" \
      --arg task_arn "$TASK_ARN" \
      '{schema:"hasna.domains.migration_observed_state.v1",source_sha:$source_sha,capture_reason:$reason,command_status:$command_status,requested:{task_definition:$requested_task_definition,image:$candidate_image},task_arn:$task_arn,describe_available:false,observed:null}' > "$OBSERVED_OUT"
  fi
  chmod 600 "$OBSERVED_OUT"
}

on_error() {
  local status=$?
  trap - ERR
  capture_observed "command_failure" "$status" || true
  exit "$status"
}
trap on_error ERR

RUN_RESULT="$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$REQUESTED_TASK_DEFINITION" \
  --launch-type FARGATE \
  --count 1 \
  --started-by "gha-domains-migrate-${GITHUB_RUN_ID:-local}" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=$ASSIGN_PUBLIC_IP}" \
  --output json)"
jq -e '(.failures | length) == 0 and (.tasks | length) == 1' <<<"$RUN_RESULT" >/dev/null
TASK_ARN="$(jq -er '.tasks[0].taskArn' <<<"$RUN_RESULT")"
REQUESTED_BY_ECS="$(jq -er '.tasks[0].taskDefinitionArn' <<<"$RUN_RESULT")"

# Durable launch identity is emitted before validation, waiter, or follow-up
# describe so a provider-side task-definition substitution is still retained.
jq -n \
  --arg source_sha "$SOURCE_SHA" \
  --arg task_arn "$TASK_ARN" \
  --arg requested_task_definition "$REQUESTED_TASK_DEFINITION" \
  --arg accepted_task_definition "$REQUESTED_BY_ECS" \
  --arg candidate_image "$CANDIDATE_IMAGE" \
  '{schema:"hasna.domains.migration_launch.v1",source_sha:$source_sha,task_arn:$task_arn,requested_task_definition:$requested_task_definition,accepted_task_definition:$accepted_task_definition,candidate_image:$candidate_image}' > "$LAUNCH_OUT"
chmod 600 "$LAUNCH_OUT"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    printf 'task=%s\n' "$TASK_ARN"
    printf 'task_definition=%s\n' "$REQUESTED_TASK_DEFINITION"
    printf 'image=%s\n' "$CANDIDATE_IMAGE"
    printf 'image_digest=%s\n' "${CANDIDATE_IMAGE##*@}"
  } >> "$GITHUB_OUTPUT"
fi
[[ "$REQUESTED_BY_ECS" == "$REQUESTED_TASK_DEFINITION" ]] || { echo "run-task accepted a different task definition" >&2; exit 1; }

echo "migration launched task=$TASK_ARN requestedTaskDefinition=$REQUESTED_TASK_DEFINITION candidateImage=$CANDIDATE_IMAGE"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
capture_observed "terminal_describe" 0

OBSERVED_TASK_DEFINITION="$(jq -er '.observed.task_definition' "$OBSERVED_OUT")"
OBSERVED_IMAGE="$(jq -er '.observed.container.image' "$OBSERVED_OUT")"
OBSERVED_DIGEST="$(jq -er '.observed.container.image_digest' "$OBSERVED_OUT")"
EXIT_CODE="$(jq -r '.observed.container.exit_code' "$OBSERVED_OUT")"
[[ "$OBSERVED_TASK_DEFINITION" == "$REQUESTED_TASK_DEFINITION" ]] || { echo "migration task definition identity mismatch" >&2; exit 1; }
[[ "$OBSERVED_IMAGE" == "$CANDIDATE_IMAGE" && "$CANDIDATE_IMAGE" == *"@$OBSERVED_DIGEST" ]] || { echo "migration image identity mismatch" >&2; exit 1; }
if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'exit_code=%s\n' "$EXIT_CODE" >> "$GITHUB_OUTPUT"; fi
[[ "$EXIT_CODE" == "0" ]] || { echo "migration task did not exit 0 (task=$TASK_ARN exit=$EXIT_CODE)" >&2; exit 1; }
trap - ERR
