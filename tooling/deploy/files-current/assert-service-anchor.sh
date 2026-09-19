#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <cluster> <service> <expected-task-definition>" >&2
  exit 2
fi

CLUSTER="$1"
SERVICE="$2"
EXPECTED_TASK_DEFINITION="$3"
SERVICE_JSON="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output json)"

jq -e --arg expected "$EXPECTED_TASK_DEFINITION" '
  (.failures | length) == 0
  and (.services | length) == 1
  and .services[0].status == "ACTIVE"
  and .services[0].taskDefinition == $expected
  and ([.services[0].deployments[] | select(.status == "PRIMARY")] | length) == 1
  and ([.services[0].deployments[] | select(.status == "PRIMARY")][0].taskDefinition == $expected)
' <<<"$SERVICE_JSON" >/dev/null || {
  observed="$(jq -r '.services[0].taskDefinition // "unavailable"' <<<"$SERVICE_JSON" 2>/dev/null || printf unavailable)"
  echo "service anchor changed before mutation: expected=$EXPECTED_TASK_DEFINITION observed=$observed" >&2
  exit 1
}
