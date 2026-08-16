#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <cluster> <service> <deployed-task-definition-arn>" >&2
  exit 64
fi

CLUSTER="$1"
SERVICE="$2"
DEPLOYED_TASK_DEFINITION="$3"
MAX_ATTEMPTS="${ECS_DEPLOYMENT_MAX_ATTEMPTS:-60}"
POLL_SECONDS="${ECS_DEPLOYMENT_POLL_SECONDS:-10}"

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::ECS_DEPLOYMENT_MAX_ATTEMPTS must be a positive integer" >&2
  exit 64
fi

if ! [[ "$POLL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "::error::ECS_DEPLOYMENT_POLL_SECONDS must be a non-negative integer" >&2
  exit 64
fi

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  if ! SERVICE_JSON="$(
    aws ecs describe-services \
      --cluster "$CLUSTER" \
      --services "$SERVICE"
  )"; then
    echo "::error::could not describe ECS service $SERVICE" >&2
    exit 1
  fi

  PRIMARY_COUNT="$(
    jq -r \
      '[.services[0].deployments[]? | select(.status == "PRIMARY")] | length' \
      <<<"$SERVICE_JSON"
  )"
  if [ "$PRIMARY_COUNT" != "1" ]; then
    echo "::error::expected exactly one PRIMARY deployment, found $PRIMARY_COUNT" >&2
    exit 1
  fi

  ROLLOUT_STATE="$(
    jq -r \
      '.services[0].deployments[] | select(.status == "PRIMARY") | .rolloutState // ""' \
      <<<"$SERVICE_JSON"
  )"
  LIVE_TASK_DEFINITION="$(
    jq -r \
      '.services[0].deployments[] | select(.status == "PRIMARY") | .taskDefinition // ""' \
      <<<"$SERVICE_JSON"
  )"

  echo "primary rolloutState=$ROLLOUT_STATE liveTaskDef=$LIVE_TASK_DEFINITION deployed=$DEPLOYED_TASK_DEFINITION attempt=$attempt/$MAX_ATTEMPTS"

  if [ "$LIVE_TASK_DEFINITION" != "$DEPLOYED_TASK_DEFINITION" ]; then
    echo "::error::live task def ($LIVE_TASK_DEFINITION) != deployed ($DEPLOYED_TASK_DEFINITION) — deployment rolled back or wrong revision became PRIMARY" >&2
    exit 1
  fi

  case "$ROLLOUT_STATE" in
    COMPLETED)
      exit 0
      ;;
    FAILED)
      echo "::error::deployment rolloutState=FAILED for $DEPLOYED_TASK_DEFINITION" >&2
      exit 1
      ;;
    IN_PROGRESS)
      if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
        echo "::error::deployment timed out after $MAX_ATTEMPTS checks while rolloutState=IN_PROGRESS" >&2
        exit 1
      fi
      sleep "$POLL_SECONDS"
      ;;
    *)
      echo "::error::unexpected PRIMARY rolloutState=$ROLLOUT_STATE" >&2
      exit 1
      ;;
  esac
done
