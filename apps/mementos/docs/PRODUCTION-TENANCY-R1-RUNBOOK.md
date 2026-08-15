# Production tenancy R1 prerequisite and rollback

This is the reviewed execution packet for Todo
`0428b6f7-706e-408f-9891-b7c023152e37`. It is intentionally fail-closed and
does not make migration 36/37 part of `mementos-deploy`.

The finite acceptance condition is: the negative probe discriminates on the
old service; a snapshot is available before writes stop; the standalone runner
applies exactly 36 and 37 from incoming ledger 0..35 and reads back every R1
invariant; the normal service gate then applies 38..40; one PRIMARY deployment
is complete; `/health`, `/v1/health`, `/ready`, and `/v1/ready` each return HTTP
200; and the positive probe proves an 8-character partial-ID update changes the
value, its version increments by exactly one, and an 8-character partial-ID
forget persists so an independent full-ID read returns HTTP 404.

`PROJECT_GUARD_MIGRATION_IDS` remains exactly `[38,39,40]`. The prerequisite
runner owns `[36,37]` only and deliberately leaves 38, 39, and 40 pending.

## Fixed inputs and capture discipline

Run every command with separate stdout/stderr files and record its immediate
exit status. Never pipe an AWS, Mementos, or health response before reading it.
The values below identify targets, not credentials.

```bash
export AWS_PROFILE=hasna-xyz-infra
export AWS_REGION=us-east-1
export CLUSTER=oss-fleet-prod
export SERVICE=mementos-prod
export CONTAINER=mementos
export SOURCE_DB=hasna-xyz-infra-apps-prod-postgres
export ROLLBACK_TD=mementos-prod:13
export CANDIDATE_TD=mementos-prod:15
export APP_SECRET_NAME=hasna/oss/mementos/database-url
export OWNER_SECRET_NAME=hasna/oss/mementos/database-url-owner
export API_URL=https://mementos.hasna.xyz
export TODO_ID=0428b6f7-706e-408f-9891-b7c023152e37
```

Resolve the live service, source database, task definition, and the two secret
containers by name. `describe-secret` is metadata-only; never call
`get-secret-value` by hand.

```bash
aws ecs describe-services --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  > pre-service.json 2> pre-service.err
aws ecs describe-task-definition --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --task-definition "$ROLLBACK_TD" \
  > pre-taskdef.json 2> pre-taskdef.err
aws rds describe-db-instances --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --db-instance-identifier "$SOURCE_DB" \
  > pre-source-rds.json 2> pre-source-rds.err
aws secretsmanager describe-secret --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --secret-id "$APP_SECRET_NAME" \
  > pre-app-secret.json 2> pre-app-secret.err
aws secretsmanager describe-secret --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --secret-id "$OWNER_SECRET_NAME" \
  > pre-owner-secret.json 2> pre-owner-secret.err
```

Abort unless the service is ACTIVE on `$ROLLBACK_TD`, desired/running/pending
is 1/1/0, the source RDS instance is `available`, private, encrypted,
Multi-AZ, and deletion-protected, and the task definition maps `DATABASE_URL`
and `MIGRATION_DATABASE_URL` to the exact two secret names above.

## 1. Discriminating pre-deploy negative

Run this before drain, snapshot, migration, or task-definition registration.
The API key is consumed from the vault without being printed.

```bash
secrets exec hasna/oss/mementos/api-key --as HASNA_MEMENTOS_API_KEY -- \
  env HASNA_MEMENTOS_API_URL="$API_URL" \
  bun scripts/partial-id-acceptance.ts pre-deploy-negative \
  > partial-pre.out 2> partial-pre.err
```

Require literal `value_unchanged=true version_unchanged=true` and
`full_id_persisted=true`. The probe cleans its disposable row by full UUID. If
it mutates or deletes by the partial ID, stop: the negative target is not the
known pre-fix service.

## 2. Build the reviewed runner image and drain only Mementos

Build and push the reviewed commit under its immutable Git SHA. Record the ECR
digest and require it to match the task-definition image before running.

```bash
export RUNNER_COMMIT="$(git rev-parse HEAD)"
export ECR_URL=789877399345.dkr.ecr.us-east-1.amazonaws.com/mementos
export RUNNER_IMAGE="${ECR_URL}:${RUNNER_COMMIT}"
docker buildx build --platform linux/arm64 --provenance=false \
  --tag "$RUNNER_IMAGE" --push . \
  > runner-build.out 2> runner-build.err

aws ecs update-service --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --desired-count 0 \
  > drain.json 2> drain.err
aws ecs wait services-stable --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  > drain-wait.out 2> drain-wait.err
```

Read back desired/running/pending 0/0/0. This drains Mementos writes only;
every other application using the shared RDS remains untouched.

## 3. Snapshot before the first database mutation

```bash
export SNAPSHOT_ID="mementos-pre-r1-36-37-$(date -u +%Y%m%dT%H%M%SZ)"
aws rds create-db-snapshot --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --db-instance-identifier "$SOURCE_DB" \
  --db-snapshot-identifier "$SNAPSHOT_ID" \
  --tags Key=service,Value=mementos Key=purpose,Value=pre-r1-36-37 \
    Key=todo,Value="$TODO_ID" \
  > snapshot-create.json 2> snapshot-create.err
aws rds wait db-snapshot-available --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --db-snapshot-identifier "$SNAPSHOT_ID" \
  > snapshot-wait.out 2> snapshot-wait.err
aws rds describe-db-snapshots --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --db-snapshot-identifier "$SNAPSHOT_ID" \
  > snapshot-readback.json 2> snapshot-readback.err
```

Require `Status=available`, `StorageEncrypted=true`, the exact source instance,
engine/version, ARN, and creation time. Restore `$ROLLBACK_TD` desired count 1
and stop if this gate fails.

## 4. Register and run exactly one standalone prerequisite task

Create the task definition from the current reviewed service definition. The
container has an explicit `.command=["mementos-tenancy-r1"]` and
`del(.entryPoint)`. This is mandatory after fleet incident 683702: an added
entry point with a null command suppresses the image command and can start with
zero arguments. Never register this one-off task with an entry point and no
explicit command.

```bash
jq --arg image "$RUNNER_IMAGE" --arg container "$CONTAINER" '
  .taskDefinition
  | .family="mementos-prod-tenancy-r1"
  | .containerDefinitions |= map(
      if .name==$container
      then (.image=$image | .command=["mementos-tenancy-r1"] | del(.entryPoint))
      else . end)
  | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,
        .registeredAt,.registeredBy,.deregisteredAt)
' pre-taskdef.json > tenancy-r1-taskdef.json

aws ecs register-task-definition --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cli-input-json file://tenancy-r1-taskdef.json \
  > tenancy-r1-register.json 2> tenancy-r1-register.err

aws ecs run-task --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition mementos-prod-tenancy-r1 \
  --network-configuration "$(jq -c '.services[0].networkConfiguration' pre-service.json)" \
  --count 1 > tenancy-r1-run.json 2> tenancy-r1-run.err
```

Capture the one task ARN, wait for `tasks-stopped`, and require
`EssentialContainerExited`, exit code 0, and runner JSON with
`applied=[36,37]`. The runner uses `MIGRATION_DATABASE_URL`, the package's
existing PostgreSQL advisory lock, and its own postcondition readback. It
refuses any incoming ledger other than exact 0..35 and refuses a package
migration inventory other than 0..40; 38..40 remain absent.

## 5. Read back tenancy invariants while writes remain drained

Require runner JSON and an independent owner-role read to agree on all of:

- `_pg_migrations` is exactly 0..37; `_migrations` contains 36 and 37 but not
  38, 39, or 40.
- `tenants`, `users`, and `memberships` exist, and the fixed Hasna root tenant
  has the package-owned UUID, slug, name, and `kind=root`.
- Every table named by migration 37 has a nullable `tenant_id` column and zero
  rows where `tenant_id IS NULL`.
- no named R1 table has row-level security enabled.

Any mismatch stops before `$CANDIDATE_TD`. Keep the original shared instance;
do not drop, rename, truncate, or repair its schema in place.

## 6. Deploy the already-reviewed project-guard candidate

```bash
aws ecs update-service --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$CANDIDATE_TD" --desired-count 1 --force-new-deployment \
  > deploy-candidate.json 2> deploy-candidate.err
aws ecs wait services-stable --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  > deploy-candidate-wait.out 2> deploy-candidate-wait.err
```

Require one PRIMARY deployment on `$CANDIDATE_TD`, `rolloutState=COMPLETED`,
desired/running/pending 1/1/0, the reviewed image digest, ledger 0..40, all four
project-guard tables, and all three immutable triggers.

Run all four public endpoint gates individually and require HTTP 200 from each:

```bash
for path in /health /v1/health /ready /v1/ready; do
  curl -sS -o "health-${path//\//_}.body" -w '%{http_code}\n' \
    --max-time 15 "${API_URL}${path}" \
    > "health-${path//\//_}.code" 2> "health-${path//\//_}.err"
done
```

Then run the real positive mutation probe:

```bash
secrets exec hasna/oss/mementos/api-key --as HASNA_MEMENTOS_API_KEY -- \
  env HASNA_MEMENTOS_API_URL="$API_URL" \
  bun scripts/partial-id-acceptance.ts post-deploy-positive \
  > partial-post.out 2> partial-post.err
```

Require literal `value_changed=true`, `version=<n>-><n+1>`, and
`full_id_readback=404 persisted_deletion=true`. This is an independent full-ID
readback, not an update/delete receipt.

## 7. Executable exact-state rollback to a new clone

Use this only for a concrete post-migration data-integrity defect. Code-only
failure rolls back to `$ROLLBACK_TD` against the forward-compatible original
database. The shared RDS source is never modified or replaced by this rollback.

First keep Mementos drained. Resolve restore settings from the source metadata
captured before mutation; do not hand-copy subnet, security-group, class,
parameter-group, or option-group identifiers.

```bash
export CLONE_DB="${SOURCE_DB}-mementos-r1-restore-$(date -u +%Y%m%d%H%M%S)"
export DB_CLASS="$(jq -r '.DBInstances[0].DBInstanceClass' pre-source-rds.json)"
export SUBNET_GROUP="$(jq -r '.DBInstances[0].DBSubnetGroup.DBSubnetGroupName' pre-source-rds.json)"
export PARAMETER_GROUP="$(jq -r '.DBInstances[0].DBParameterGroups[0].DBParameterGroupName' pre-source-rds.json)"
export OPTION_GROUP="$(jq -r '.DBInstances[0].OptionGroupMemberships[0].OptionGroupName' pre-source-rds.json)"
mapfile -t VPC_SECURITY_GROUPS < <(jq -r '.DBInstances[0].VpcSecurityGroups[].VpcSecurityGroupId' pre-source-rds.json)

RESTORE_ARGS=(
  rds restore-db-instance-from-db-snapshot
  --db-instance-identifier "$CLONE_DB"
  --db-snapshot-identifier "$SNAPSHOT_ID"
  --db-instance-class "$DB_CLASS"
  --db-subnet-group-name "$SUBNET_GROUP"
  --db-parameter-group-name "$PARAMETER_GROUP"
  --option-group-name "$OPTION_GROUP"
  --vpc-security-group-ids "${VPC_SECURITY_GROUPS[@]}"
  --no-publicly-accessible
  --deletion-protection
  --copy-tags-to-snapshot
  --tags Key=service,Value=mementos Key=purpose,Value=r1-exact-rollback-clone Key=todo,Value="$TODO_ID"
)
if jq -e '.DBInstances[0].MultiAZ == true' pre-source-rds.json >/dev/null; then
  RESTORE_ARGS+=(--multi-az)
else
  RESTORE_ARGS+=(--no-multi-az)
fi
aws "${RESTORE_ARGS[@]}" --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  > clone-restore.json 2> clone-restore.err
aws rds wait db-instance-available --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --db-instance-identifier "$CLONE_DB" \
  > clone-wait.out 2> clone-wait.err
aws rds describe-db-instances --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --db-instance-identifier "$CLONE_DB" \
  > clone-readback.json 2> clone-readback.err
```

Require `available`, private, encrypted, deletion-protected, the same subnet
group/security groups/class/parameter group, and a different identifier and
endpoint. Validate the clone's Mementos ledger/data while the service remains
drained.

Stage clone endpoints in new `AWSPENDING` versions of only
`hasna/oss/mementos/database-url` and
`hasna/oss/mementos/database-url-owner`. The helper consumes secret values in
memory, sends new values to AWS on stdin, prints names/version metadata only,
and writes a mode-600 reversal receipt containing no credential value.

```bash
bun scripts/dsn-clone-cutover.ts stage \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --container "$CONTAINER" \
  --source-db "$SOURCE_DB" --clone-db "$CLONE_DB" \
  --receipt dsn-cutover-receipt.json --apply \
  > dsn-stage.out 2> dsn-stage.err
bun scripts/dsn-clone-cutover.ts verify-staged \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --container "$CONTAINER" \
  --source-db "$SOURCE_DB" --clone-db "$CLONE_DB" \
  --receipt dsn-cutover-receipt.json \
  > dsn-verify-staged.out 2> dsn-verify-staged.err
bun scripts/dsn-clone-cutover.ts cutover \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --container "$CONTAINER" \
  --source-db "$SOURCE_DB" --clone-db "$CLONE_DB" \
  --receipt dsn-cutover-receipt.json --apply \
  > dsn-cutover.out 2> dsn-cutover.err
```

The helper refuses a non-drained service, wrong secret name, wrong database or
role, same source/clone identifier, public/unprotected clone, or network drift.
After label cutover, deploy `$ROLLBACK_TD` against the clone-backed Mementos
secrets:

```bash
aws ecs update-service --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$ROLLBACK_TD" --desired-count 1 --force-new-deployment \
  > rollback-clone-deploy.json 2> rollback-clone-deploy.err
aws ecs wait services-stable --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  > rollback-clone-wait.out 2> rollback-clone-wait.err
```

Verify the task still references exactly those two Mementos secret names, run
the four endpoint gates, then prove the consumer boundary points to the clone:

```bash
bun scripts/dsn-clone-cutover.ts verify-consumer \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --container "$CONTAINER" \
  --source-db "$SOURCE_DB" --clone-db "$CLONE_DB" \
  --receipt dsn-cutover-receipt.json --expect clone \
  > dsn-consumer-clone.out 2> dsn-consumer-clone.err
```

Keep the original instance and snapshot. Do not delete either.

## 8. Reversal of the clone cutover

Drain Mementos again, then move `AWSCURRENT` for the same two secret names back
to the original version IDs recorded in the receipt. The helper verifies that
both active DSNs still target the clone first and compensates the application
secret back to the clone if moving the owner secret fails:

```bash
aws ecs update-service --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --desired-count 0 \
  > reverse-drain.json 2> reverse-drain.err
aws ecs wait services-stable --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  > reverse-drain-wait.out 2> reverse-drain-wait.err
bun scripts/dsn-clone-cutover.ts reverse \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --container "$CONTAINER" \
  --source-db "$SOURCE_DB" --clone-db "$CLONE_DB" \
  --receipt dsn-cutover-receipt.json --apply \
  > dsn-reverse.out 2> dsn-reverse.err
```

Redeploy `$ROLLBACK_TD` against the original Mementos secret versions:

```bash
aws ecs update-service --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$ROLLBACK_TD" --desired-count 1 --force-new-deployment \
  > reverse-source-deploy.json 2> reverse-source-deploy.err
aws ecs wait services-stable --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --services "$SERVICE" \
  > reverse-source-wait.out 2> reverse-source-wait.err
bun scripts/dsn-clone-cutover.ts verify-consumer \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --cluster "$CLUSTER" --service "$SERVICE" --container "$CONTAINER" \
  --source-db "$SOURCE_DB" --clone-db "$CLONE_DB" \
  --receipt dsn-cutover-receipt.json --expect source \
  > dsn-consumer-source.out 2> dsn-consumer-source.err
```

Rerun all four HTTP 200 gates. This reversal changes no other application's
secret, task definition, service, or database target.
