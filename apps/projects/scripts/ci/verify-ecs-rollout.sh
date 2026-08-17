#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <cluster> <service> <expected-task-definition>" >&2
  exit 2
fi

CLUSTER="$1"
SERVICE="$2"
EXPECTED_TASK_DEF="$3"
MAX_ATTEMPTS="${ROLLOUT_VERIFY_MAX_ATTEMPTS:-12}"
DELAY_SECONDS="${ROLLOUT_VERIFY_DELAY_SECONDS:-5}"

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::ROLLOUT_VERIFY_MAX_ATTEMPTS must be a positive integer" >&2
  exit 2
fi
if ! [[ "$DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "::error::ROLLOUT_VERIFY_DELAY_SECONDS must be a non-negative integer" >&2
  exit 2
fi

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  SVC="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output json)"
  FAILURE_COUNT="$(jq -r '(.failures // []) | length' <<<"$SVC")"
  PRIMARY_COUNT="$(jq -r '[.services[0].deployments[]? | select(.status=="PRIMARY")] | length' <<<"$SVC")"

  if [ "$FAILURE_COUNT" != "0" ] || [ "$PRIMARY_COUNT" != "1" ]; then
    echo "::error::unable to verify exactly one PRIMARY deployment (failures=$FAILURE_COUNT primaryCount=$PRIMARY_COUNT)"
    exit 1
  fi

  RS="$(jq -r '.services[0].deployments[] | select(.status=="PRIMARY") | .rolloutState // ""' <<<"$SVC")"
  LIVE_TD="$(jq -r '.services[0].deployments[] | select(.status=="PRIMARY") | .taskDefinition // ""' <<<"$SVC")"
  echo "primary rolloutState=$RS liveTaskDef=$LIVE_TD deployed=$EXPECTED_TASK_DEF"

  if [ "$LIVE_TD" != "$EXPECTED_TASK_DEF" ]; then
    echo "::error::live task def ($LIVE_TD) != deployed ($EXPECTED_TASK_DEF) — deployment was rolled back"
    exit 1
  fi

  case "$RS" in
    COMPLETED)
      exit 0
      ;;
    IN_PROGRESS)
      if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
        echo "::error::deployment rolloutState remained IN_PROGRESS after $MAX_ATTEMPTS verification attempts"
        exit 1
      fi
      if [ "$DELAY_SECONDS" -gt 0 ]; then
        sleep "$DELAY_SECONDS"
      fi
      ;;
    *)
      echo "::error::deployment did not complete (rolloutState=${RS:-missing}) — likely circuit-breaker rollback"
      exit 1
      ;;
  esac

  attempt=$((attempt + 1))
done
