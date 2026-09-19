#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 10 ]; then
  echo "usage: $0 <phase> <cluster> <task-definition> <container> <subnets> <security-groups> <assign-public-ip> <catalog.json> <source-sha> <receipt.json>" >&2
  exit 2
fi

PHASE="$1"
CLUSTER="$2"
TASK_DEFINITION="$3"
CONTAINER="$4"
SUBNETS="$5"
SECURITY_GROUPS="$6"
ASSIGN_PUBLIC_IP="$7"
CATALOG="$8"
SOURCE_SHA="$9"
OUT="${10}"

[[ "$PHASE" == "before" || "$PHASE" == "after" ]] || { echo "invalid ledger phase" >&2; exit 2; }
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid source sha" >&2; exit 2; }
jq -e '.schema == "hasna.domains.migration_catalog.v1"
  and (.migrations | type == "array" and length > 0)
  and all(.migrations[]; (.id | type == "string" and length > 0) and (.checksum | type == "string" and test("^sha256:[0-9a-f]{64}$")))
  and ([.migrations[].id] | length == (unique | length))
  and (.acknowledged_legacy_ids | type == "array")
  and all(.acknowledged_legacy_ids[]; type == "string" and length > 0)
  and ([.acknowledged_legacy_ids[]] | length == (unique | length))
  and (([.migrations[].id] + .acknowledged_legacy_ids) | length == (unique | length))' "$CATALOG" >/dev/null
CATALOG_ROWS="$(jq -c '{migrations:(.migrations | map({id,checksum})),acknowledged_legacy_ids}' "$CATALOG")"
CALCULATED_CATALOG_DIGEST="sha256:$(printf '%s' "$CATALOG_ROWS" | sha256sum | awk '{print $1}')"
[[ "$(jq -er '.catalog_digest' "$CATALOG")" == "$CALCULATED_CATALOG_DIGEST" ]] || { echo "migration catalog digest mismatch" >&2; exit 1; }

TASK_JSON="$(aws ecs describe-task-definition --task-definition "$TASK_DEFINITION" --query taskDefinition --output json)"
IMAGE="$(jq -er --arg c "$CONTAINER" '.containerDefinitions[] | select(.name == $c) | .image' <<<"$TASK_JSON")"
[[ "$IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "ledger probe task is not digest-pinned" >&2; exit 1; }
LOG_DRIVER="$(jq -r --arg c "$CONTAINER" '.containerDefinitions[] | select(.name == $c) | .logConfiguration.logDriver // ""' <<<"$TASK_JSON")"
LOG_GROUP="$(jq -r --arg c "$CONTAINER" '.containerDefinitions[] | select(.name == $c) | .logConfiguration.options["awslogs-group"] // ""' <<<"$TASK_JSON")"
LOG_REGION="$(jq -r --arg c "$CONTAINER" '.containerDefinitions[] | select(.name == $c) | .logConfiguration.options["awslogs-region"] // ""' <<<"$TASK_JSON")"
LOG_PREFIX="$(jq -r --arg c "$CONTAINER" '.containerDefinitions[] | select(.name == $c) | .logConfiguration.options["awslogs-stream-prefix"] // ""' <<<"$TASK_JSON")"
[[ "$LOG_DRIVER" == "awslogs" && -n "$LOG_GROUP" && -n "$LOG_REGION" && -n "$LOG_PREFIX" ]] || { echo "ledger probe requires an awslogs task" >&2; exit 1; }

PROBE_JS='const{Client}=require("pg");const{createHash}=require("node:crypto");const c=new Client({connectionString:process.env.HASNA_DOMAINS_DATABASE_URL});await c.connect();const q=await c.query("SELECT id, checksum FROM schema_migrations ORDER BY id ASC");const rows=q.rows.map(r=>({id:String(r.id),checksum:String(r.checksum)}));const digest="sha256:"+createHash("sha256").update(JSON.stringify(rows)).digest("hex");console.log(JSON.stringify({schema:"hasna.domains.migration_ledger_probe.v1",phase:process.env.DOMAINS_LEDGER_PHASE,rows,ledger_digest:digest}));await c.end();'
OVERRIDES="$(jq -cn --arg c "$CONTAINER" --arg phase "$PHASE" --arg script "$PROBE_JS" '{containerOverrides:[{name:$c,command:["bun","-e",$script],environment:[{name:"DOMAINS_LEDGER_PHASE",value:$phase}]}]}')"
RUN="$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEFINITION" \
  --launch-type FARGATE \
  --count 1 \
  --started-by "gha-domains-ledger-${PHASE}-${GITHUB_RUN_ID:-local}" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=$ASSIGN_PUBLIC_IP}" \
  --overrides "$OVERRIDES" \
  --output json)"
jq -e '.failures | length == 0' <<<"$RUN" >/dev/null
TASK_ARN="$(jq -er '.tasks[0].taskArn' <<<"$RUN")"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
STOPPED="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json)"
ACTUAL_TASK_DEFINITION="$(jq -er '.tasks[0].taskDefinitionArn' <<<"$STOPPED")"
ACTUAL_IMAGE="$(jq -er --arg c "$CONTAINER" '.tasks[0].containers[] | select(.name == $c) | .image' <<<"$STOPPED")"
ACTUAL_DIGEST="$(jq -er --arg c "$CONTAINER" '.tasks[0].containers[] | select(.name == $c) | .imageDigest' <<<"$STOPPED")"
EXIT_CODE="$(jq -r --arg c "$CONTAINER" '.tasks[0].containers[] | select(.name == $c) | .exitCode // "null"' <<<"$STOPPED")"
[[ "$ACTUAL_TASK_DEFINITION" == "$TASK_DEFINITION" && "$ACTUAL_IMAGE" == "$IMAGE" && "$IMAGE" == *"@$ACTUAL_DIGEST" ]] || { echo "ledger probe task identity mismatch" >&2; exit 1; }
[[ "$EXIT_CODE" == "0" ]] || { echo "ledger probe task failed (task=$TASK_ARN exit=$EXIT_CODE)" >&2; exit 1; }

TASK_ID="${TASK_ARN##*/}"
LOG_STREAM="$LOG_PREFIX/$CONTAINER/$TASK_ID"
PROBE=""
for _ in $(seq 1 20); do
  MESSAGES="$(aws logs get-log-events --region "$LOG_REGION" --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" --start-from-head --limit 100 --query 'events[].message' --output json 2>/dev/null || printf '[]')"
  PROBE="$(jq -c --arg phase "$PHASE" '[.[] | fromjson? | select(.schema == "hasna.domains.migration_ledger_probe.v1" and .phase == $phase)] | if length == 1 then .[0] else empty end' <<<"$MESSAGES")"
  [ -n "$PROBE" ] && break
  sleep 3
done
[ -n "$PROBE" ] || { echo "ledger probe receipt was not found in the bounded log window" >&2; exit 1; }

APPLIED="$(jq -c '.rows' <<<"$PROBE")"
CALCULATED_DIGEST="sha256:$(printf '%s' "$APPLIED" | sha256sum | awk '{print $1}')"
[[ "$(jq -r '.ledger_digest' <<<"$PROBE")" == "$CALCULATED_DIGEST" ]] || { echo "ledger probe digest mismatch" >&2; exit 1; }

# Every applied row must either be a current exact-checksum migration or one
# of the explicitly acknowledged historical IDs whose SQL/checksum is not
# reproducible from public source. No other unknown ledger row is accepted.
jq -e --argjson applied "$APPLIED" '
  (.migrations | map({key:.id,value:.checksum}) | from_entries) as $known
  | (.acknowledged_legacy_ids | INDEX(.)) as $legacy
  | ($applied | all(.[]; (($known[.id] // null) == .checksum) or ($legacy[.id] != null)))
' "$CATALOG" >/dev/null || { echo "applied ledger is unknown to or checksum-incompatible with this candidate" >&2; exit 1; }
PENDING="$(jq -c --argjson applied "$APPLIED" '
  ($applied | map(.id) | INDEX(.)) as $seen
  | [.migrations[] | select($seen[.id] == null)]
' "$CATALOG")"
CATALOG_DIGEST="$CALCULATED_CATALOG_DIGEST"

jq -n \
  --arg phase "$PHASE" \
  --arg source_sha "$SOURCE_SHA" \
  --arg task_arn "$TASK_ARN" \
  --arg task_definition "$ACTUAL_TASK_DEFINITION" \
  --arg image "$ACTUAL_IMAGE" \
  --arg image_digest "$ACTUAL_DIGEST" \
  --arg ledger_digest "$CALCULATED_DIGEST" \
  --arg catalog_digest "$CATALOG_DIGEST" \
  --argjson applied "$APPLIED" \
  --argjson pending "$PENDING" \
  '{schema:"hasna.domains.migration_ledger_receipt.v1",phase:$phase,source_sha:$source_sha,probe:{task_arn:$task_arn,task_definition:$task_definition,image:$image,image_digest:$image_digest},catalog_digest:$catalog_digest,ledger_digest:$ledger_digest,applied:$applied,pending:$pending}' > "$OUT"
chmod 600 "$OUT"
