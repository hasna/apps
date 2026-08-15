# AWS Deployment Runbook

This runbook is for a reviewed AWS account target. It is intentionally dry-run
first: the local generator produces a plan and command list, but it does not
call AWS or mutate infrastructure.

## Generate The Plan

```bash
uptimemon cloud plan --json > open-uptime-aws-plan.json
uptimemon cloud private-probe-config --probe-id prb_private_01 --machine-id private-probe-01 --json > private-probe-01-preflight.json
uptimemon cloud private-probe-config --probe-id prb_private_01 --machine-id private-probe-01 --env --allow-blocked-env > private-probe-01-review-only.env
```

Public package defaults are placeholders:

- account/profile label: `aws-profile`
- region: `us-east-1`
- VPC: `vpc-xxxxxxxx`
- hosted data path: EFS-mounted SQLite at `/data/uptime/uptime.db`
- hostname: `uptime.example.com`
- workspace id: `workspace-id`
- protected access mode: `cloudfront_default_domain`

Override these with CLI flags or private deployment evidence for the real
account, hostname, workspace id, VPC id, secret refs, and repository names.

The generated AWS plan currently returns `status: "blocked"` and
`canApply: false`. The generated private-probe config returns `status: "blocked"` and
`canStart: false`. Treat both as review/preflight artifacts until the blockers
and required evidence in the JSON output are resolved.

The app repo includes a hosted runtime `Dockerfile` and Terraform/OpenTofu
starter files in `infra/aws`. The plan output points to these files and keeps
`applyAllowed: false`.

`uptimemon cloud private-probe-config --env` is blocked by default while hosted
probe routes remain fail-closed. It requires both a real `--probe-id` and the
explicit `--allow-blocked-env` review override; do not use that env output to
start a private probe until the JSON output says `canStart: true`.

## Preflight

1. Locate the real infrastructure repository or create the change in the
   approved owner repository.
2. Set the operator shell variables used by the command snippets:

   ```bash
   umask 077
   : "${AWS_PROFILE_NAME:?set AWS_PROFILE_NAME to the reviewed AWS profile}"
   AWS_REGION="${AWS_REGION:-us-east-1}"
   TF_DIR="${TF_DIR:-infra/aws}"
   PLAN_FILE="${PLAN_FILE:-open-uptime.tfplan}"
   ```

3. Confirm the AWS caller identity:

   ```bash
   aws sts get-caller-identity --profile "$AWS_PROFILE_NAME"
   ```

4. Confirm the target VPC, private subnets, KMS key, and EFS/Backup plan inputs
   still match the plan.
5. Confirm the protected access mode. The first zero-count deploy can use the
   CloudFront default HTTPS domain without custom DNS or ACM. Before
   token-bearing live traffic, either set
   `cloudfront_origin_protocol_policy = "https-only"` with a dedicated
   `cloudfront_origin_domain_name` that resolves to the ALB and a matching ACM
   `certificate_arn`, or record an explicit risk acceptance for the temporary
   HTTP-origin bridge. Custom hostname deploys still require Route53/edge
   ownership and an ACM certificate.
6. Confirm the deployment role uses short-lived credentials or OIDC, not copied
   access keys.
7. Create a private evidence directory outside the public repository. Store
   command output, plan summaries, screenshots, and incident notes there. Do
   not store tokens, database URLs, probe private keys, or secret values.

## Required Resources

The plan expects:

- ECR repository for the Open Uptime image.
- ECS/Fargate cluster with separate services for web, scheduler, public probe,
  reporter, and one-off migrations. In the current EFS SQLite bridge, only web
  may be enabled and it must run at desired count `0` or `1`.
- CloudFront default-domain HTTPS edge plus an ALB origin restricted to
  CloudFront origin-facing ranges. The default zero-count bridge uses HTTP to
  the origin; token-bearing live traffic should use the module's HTTPS-origin
  mode with `cloudfront_origin_domain_name` plus `certificate_arn`, or a
  documented risk acceptance. Direct ALB HTTPS mode also requires custom DNS and
  an ACM certificate.
- Encrypted EFS file system, access point, mount targets, and AWS Backup plan
  for `HASNA_UPTIME_HOSTED_SQLITE_DB=/data/uptime/uptime.db`.
- S3 bucket for redacted browser evidence and generated report artifacts, with
  KMS default encryption plus bucket-policy denies for explicit non-KMS uploads
  and uploads that specify the wrong KMS key.
- Secrets Manager refs for app env, hosted token, probe config, and reporting
  channel refs. If any ECS secret uses an SSM Parameter Store ARN, add `ssm` to
  `interface_vpc_endpoint_services` or document the approved alternate egress
  path before running private-only tasks.
- CloudWatch log groups for every component plus initial web 5xx/unhealthy
  alarms. Scheduler-stall, stale-probe, and report-delivery alarms remain
  blocked until those workers emit cloud metrics.

The module also keeps `desired_counts.web > 0` behind explicit ops-readiness
booleans. Leave `live_ops_backend_state_hardened`,
`live_ops_human_alert_delivery_ready`, `live_ops_backup_restore_ready`, and
`live_ops_evidence_retention_ready` as `false` until current no-secret evidence
proves those gates for the exact pinned package, image, Terraform backend, and
alert/backup/evidence path.

Provision these through the approved infrastructure repository and reviewed
plan/apply flow. The local `uptimemon cloud plan` output intentionally avoids
copy-pastable AWS mutation commands.

Plan the included Terraform/OpenTofu starter without a backend:

```bash
terraform -chdir="$TF_DIR" fmt -check
terraform -chdir="$TF_DIR" init -backend=false
terraform -chdir="$TF_DIR" validate
terraform -chdir="$TF_DIR" plan -out "$PLAN_FILE"
```

Use Terraform/OpenTofu 1.9 or newer for this starter.

## Zero-Count Apply

The first reviewed apply must create infrastructure with every ECS service at
desired count `0`.

1. Confirm the plan has no deletes or replacements and that all ECS services are
   dormant:

   ```bash
   terraform -chdir="$TF_DIR" show -json "$PLAN_FILE" \
     | jq -r '.resource_changes[] | select(.type=="aws_ecs_service") | [.address, .change.after.desired_count] | @tsv'
   ```

2. Confirm Terraform is not managing secret values:

   ```bash
   terraform -chdir="$TF_DIR" show -json "$PLAN_FILE" \
     | jq -r '.resource_changes[] | select(.type | test("secret_version|random_password|random_string")) | .address'
   ```

   This command must print nothing.

3. Apply only the reviewed zero-count plan:

   ```bash
   terraform -chdir="$TF_DIR" apply "$PLAN_FILE"
   ```

4. Capture outputs, the source commit, the package version, the plan summary,
   and the caller identity in private deployment evidence.

## Image And Secrets

After the zero-count apply, build the image through the approved deploy pipeline
or the declared image builder. Record only the immutable digest, not build logs
that contain environment values:

```bash
IMAGE_BUILDER_PROJECT="$(terraform -chdir="$TF_DIR" output -raw image_builder_project_name)"
aws codebuild start-build \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --project-name "$IMAGE_BUILDER_PROJECT"
```

The private infra root should set `runtime_package_integrity` to the published
npm `dist.integrity` value for the exact `runtime_package_version`. The image
builder refuses to extract the package unless that value matches, or unless
`allow_unpinned_runtime_package_integrity=true` is deliberately set for a
zero-count review build. Keep the service not-live when the package is not
integrity-pinned.

Update the approved infra root so `container_image` is the immutable ECR digest,
then re-plan with all services still at `0`.

Populate Secrets Manager values out of band. `secret_refs` is a sensitive output;
use this loop only in a private operator terminal and paste only redacted
metadata summaries into shared evidence:

```bash
terraform -chdir="$TF_DIR" output -json secret_refs | jq -r '.[]' | while read -r SECRET_ID; do
  aws secretsmanager describe-secret \
    --profile "$AWS_PROFILE_NAME" \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_ID"
  aws secretsmanager list-secret-version-ids \
    --profile "$AWS_PROFILE_NAME" \
    --region "$AWS_REGION" \
    --secret-id "$SECRET_ID"
done
```

Each required secret must have an `AWSCURRENT` version before any task is
started. Never run `get-secret-value` in shared logs or public evidence.

## Protected Web Scale-Up

Before setting `desired_counts.web = 1`, verify:

- the image is an immutable digest, not a mutable tag or placeholder;
- required secrets have `AWSCURRENT` versions;
- `HASNA_UPTIME_ALLOWED_ORIGINS` matches the public HTTPS edge origin;
- CloudFront-to-origin transport is either `https-only` with an origin hostname
  whose certificate matches that hostname, or the HTTP-origin bridge has a
  named risk owner and approval recorded in private evidence by setting
  `allow_cloudfront_http_origin_live_traffic = true`;
- CloudFront origin access is distribution-bound with the CloudFront-only origin
  verification header by setting `enable_cloudfront_origin_verify_header = true`,
  not just narrowed to CloudFront origin-facing ranges;
- origin-header creation or rotation is blocked unless
  `live_ops_backend_state_hardened = true`, or an explicit
  `allow_origin_verify_header_before_backend_state_hardened = true` exception is
  recorded for a zero-count setup/rotation window;
- web egress to ECR, Secrets Manager or SSM, CloudWatch Logs, S3, EFS, and any
  required endpoints has been proven from a real ECS task. Terraform endpoint
  ids, route tables, and security-group rules are creation evidence only; the
  scale-up evidence must include image pull, secret injection, log delivery, S3
  access, and EFS mount checks through the selected NAT or private-endpoint
  path;
- scheduler, public-probe, reporter, and migration remain at `0`.

Scale only the web task, then capture the ECS deployment id and task definition
ARN:

```bash
ECS_CLUSTER="$(terraform -chdir="$TF_DIR" output -raw ecs_cluster_name)"
WEB_SERVICE="$(terraform -chdir="$TF_DIR" output -json service_names | jq -r '.[] | select(endswith("-web"))')"
aws ecs describe-services \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$WEB_SERVICE" \
  --query 'services[0].{taskDefinition:taskDefinition,deployments:deployments[*].{id:id,status:status,desired:desiredCount,running:runningCount}}'
```

## Sanitized Origin Evidence

Capture origin-binding evidence before and after web scale-up without printing
the CloudFront custom origin header value or resource identifiers. Private
operators may read identifiers into shell variables, but shared evidence should
be booleans, counts, status codes, and non-secret protocol choices only:

```bash
CLOUDFRONT_DISTRIBUTION_ID="$(terraform -chdir="$TF_DIR" output -raw cloudfront_distribution_id)"
ALB_DNS_NAME="$(terraform -chdir="$TF_DIR" output -raw alb_dns_name)"
ALB_LISTENERS_JSON="$(terraform -chdir="$TF_DIR" output -json alb_listener_arns)"
ALB_SECURITY_GROUP_ID="$(terraform -chdir="$TF_DIR" output -raw alb_security_group_id)"
ORIGIN_POLICY="$(terraform -chdir="$TF_DIR" output -raw cloudfront_origin_protocol_policy)"
ORIGIN_HOST="$(terraform -chdir="$TF_DIR" output -raw cloudfront_origin_domain_name)"
ORIGIN_HEADER_ENABLED="$(terraform -chdir="$TF_DIR" output -raw cloudfront_origin_verify_header_enabled)"
ORIGIN_HEADER_NAME="$(terraform -chdir="$TF_DIR" output -raw cloudfront_origin_verify_header_name)"

printf '{"cloudfrontDistributionConfigured":%s,"albDnsConfigured":%s,"originPolicy":"%s","originHostConfigured":%s,"originHeaderEnabled":%s,"originHeaderNameConfigured":%s}\n' \
  "$([ -n "$CLOUDFRONT_DISTRIBUTION_ID" ] && echo true || echo false)" \
  "$([ -n "$ALB_DNS_NAME" ] && echo true || echo false)" \
  "$ORIGIN_POLICY" \
  "$([ -n "$ORIGIN_HOST" ] && echo true || echo false)" \
  "$ORIGIN_HEADER_ENABLED" \
  "$([ -n "$ORIGIN_HEADER_NAME" ] && echo true || echo false)"

aws resourcegroupstaggingapi get-resources \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --resource-type-filters cloudfront:distribution \
  --tag-filters Key=Service,Values=open-uptime Key=Environment,Values=prod \
  --query '{cloudfrontTaggedResourceCount:length(ResourceTagMappingList)}'

aws elbv2 describe-listeners \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --listener-arns "$(echo "$ALB_LISTENERS_JSON" | jq -r '.http_cloudfront // .https')" \
  --query 'Listeners[].{port:Port,protocol:Protocol,defaultActions:DefaultActions[].Type}'

aws ec2 describe-security-groups \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --group-ids "$ALB_SECURITY_GROUP_ID" \
  --query 'SecurityGroups[].{ingressRuleCount:length(IpPermissions),prefixListIngressRuleCount:length(IpPermissions[?length(PrefixListIds) > `0`])}'
```

Do not run `aws cloudfront list-distributions`,
`aws cloudfront get-distribution`, `aws cloudfront get-distribution-config`, or
unfiltered `aws elbv2 describe-rules` into shared logs or public evidence; those
APIs can return the private origin verification header value. Treat any private
CloudFront/ELB read that can reveal custom headers as secret-bearing. If a
reviewer must inspect the rule condition directly, do it in a private shell and
record only sanitized facts: header configured, listener protocol, rule count or
priority presence, and that requests without the header return `403`.
The shared evidence sanitizer redacts AWS-shaped custom-header fields such as
CloudFront `HeaderValue` and ALB `HttpHeaderConfig.Values`, but private
distribution/rule reads and Terraform plan JSON still remain secret-bearing
operator artifacts and must not be pasted into shared channels.

## Smoke Checks

Run these checks through the public edge URL and record the redacted JSON report.
Use scoped hosted tokens only from the operator secret store. The command reads
token values from environment variables and never prints them.

```bash
EDGE_URL="$(terraform -chdir="$TF_DIR" output -raw protected_access_url)"
DIRECT_ORIGIN_URL="http://$(terraform -chdir="$TF_DIR" output -raw alb_dns_name)"
: "${WORKSPACE_ID:?set to the hosted workspace id}"
: "${HASNA_UPTIME_EDGE_READ_TOKEN:?set from operator secret store}"
: "${HASNA_UPTIME_EDGE_WRITE_TOKEN:?set from operator secret store}"
: "${HASNA_UPTIME_EDGE_PROBE_TOKEN:?set from operator secret store}"
: "${HASNA_UPTIME_EDGE_REPORT_TOKEN:?set from operator secret store}"

uptimemon cloud edge-smoke \
  --url "$EDGE_URL" \
  --workspace-id "$WORKSPACE_ID" \
  --mutation \
  --direct-origin-url "$DIRECT_ORIGIN_URL" \
  --allow-direct-origin-unreachable \
  --require-promotion-ready \
  --json
```

The default JSON/text output is the shareable evidence form: it redacts the edge
and direct-origin URLs as well as token values. `--raw-evidence-urls` is only for
private operator terminals and must not be pasted into shared status, todos,
project events, or public docs.

Before copying any protected-web smoke, Terraform plan summary, image refresh
summary, report delivery summary, alarm evidence, or backup/restore evidence
into shared docs, todos, project metadata, or release notes, run the evidence
sanitizer:

```bash
uptimemon cloud evidence-sanitize --file rollout-evidence.json
```

The cloud alias fails on unsafe evidence by default. Use `--allow-unsafe` only
inside a private operator terminal to inspect the sanitized JSON. Passing this
sanitizer means the artifact is safer to share; it is not live-readiness proof.

Expected results:

- `/health` returns `200` and no monitor data.
- authenticated `/ready` returns `200` with `productionReady=true`. Hosted
  local SQLite fallback must return a non-ready result and is not promotion
  evidence.
- Dashboard and API reads without auth return `401` or the approved identity
  layer denial.
- Authenticated API reads return only the authorized workspace.
- A read token cannot mutate, a denied browser `Origin` cannot mutate, and a
  write token can create and delete only the disabled smoke monitor. The delete
  leg must carry an `Idempotency-Key` through the edge.
- Header-only readiness must pass with `X-Uptime-Workspace`; evidence that works
  only through `?workspaceId=` is not enough.
- Hosted report delivery, probe APIs, import apply, and inline checks remain
  fail-closed until their cloud job/channel/audit systems are implemented.
- Direct ALB origin access returns the fixed `403` origin-verification denial
  unless it is the approved CloudFront origin path. Other 4xx/5xx responses are
  not sufficient promotion evidence because they can hide downstream failure. For
  the current private-network ALB model, an HTTP timeout/refusal from outside
  CloudFront ranges is acceptable only when
  `--allow-direct-origin-unreachable` is explicitly present in the private
  evidence run; by default, unreachable direct-origin checks fail the smoke.

Manual curls are acceptable only as extra diagnostics; the deployment evidence
must include the `uptimemon cloud edge-smoke --json` report because it records the
full protected-access matrix without leaking token values.

The CloudFront origin request path must forward `Authorization`,
`X-Uptime-Hosted-Token`, `X-Uptime-Workspace`, `Idempotency-Key`,
`Content-Type`, and `Origin` to the ALB. Future promotion evidence should prove
the workspace header path through the edge; using only `?workspaceId=` query
parameters is not sufficient for the protected-web gate.

Hosted deployments should store scoped hosted-token JSON in Secrets Manager, not
a single broad raw token. The runtime accepts `HASNA_UPTIME_HOSTED_TOKENS` JSON
or JSON-compatible `HASNA_UPTIME_HOSTED_TOKEN` values shaped like:

```json
{
  "tokens": [
    { "token": "<read-token>", "scopes": ["uptime:read"], "workspaceId": "<workspace-id>" },
    { "token": "<write-token>", "scopes": ["uptime:write"], "workspaceId": "<workspace-id>" }
  ]
}
```

Raw hosted tokens are rejected by default. They are only a local compatibility
escape hatch when `HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN=1`, still expand to
broad read/write/probe/report scopes, and remain rejected in production auth
mode or when `NODE_ENV=production`.

Do not record token values in runbooks, logs, task overrides, or deployment
evidence.

## Logs And Alarms

Inspect recent web logs without printing secrets:

```bash
WEB_LOG_GROUP="$(terraform -chdir="$TF_DIR" output -json log_group_names | jq -r '.web')"
aws logs tail "$WEB_LOG_GROUP" \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --since 15m
```

Verify the initial web alarms exist and are not already alarming:

```bash
WEB_5XX_ALARM="$(terraform -chdir="$TF_DIR" output -json alarm_names | jq -r '.web_5xx')"
WEB_UNHEALTHY_ALARM="$(terraform -chdir="$TF_DIR" output -json alarm_names | jq -r '.web_unhealthy')"
OPS_ALERTS_TOPIC_ARN="$(terraform -chdir="$TF_DIR" output -raw ops_alerts_topic_arn 2>/dev/null || true)"
aws cloudwatch describe-alarms \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --alarm-names "$WEB_5XX_ALARM" "$WEB_UNHEALTHY_ALARM" \
  --query 'MetricAlarms[*].{name:AlarmName,state:StateValue,reason:StateReason,actionsEnabled:ActionsEnabled,alarmActions:AlarmActions,okActions:OKActions,insufficientDataActions:InsufficientDataActions,dimensions:Dimensions}'

if [ -n "$OPS_ALERTS_TOPIC_ARN" ]; then
  aws sns list-subscriptions-by-topic \
    --profile "$AWS_PROFILE_NAME" \
    --region "$AWS_REGION" \
    --topic-arn "$OPS_ALERTS_TOPIC_ARN" \
    --output json \
    | jq '[.Subscriptions[] | {protocol:.Protocol, owner:.Owner, status:(if .SubscriptionArn == "PendingConfirmation" then "pending" else "confirmed" end), endpointRedacted:"redacted"}]'
fi
```

Worker/report alarm definitions are available behind
`enable_worker_runtime_alarms`. Keep that flag `false` until scheduler,
public-probe, and reporter workers emit the documented runtime metrics and
approved human/on-call delivery is proven. The default-off contract covers
scheduler backlog/stale leases/heartbeat age, public-probe backlog/submission
failures/heartbeat age, and reporter lag/failed deliveries/retry exhaustion/
heartbeat age.
The bounded Postgres scheduler and public-probe review commands can emit
CloudWatch EMF with `--emit-cloudwatch-emf` after a review batch. Treat that as
producer-contract evidence only: it does not make ECS worker commands startable,
does not prove reporter metrics, and must not flip
`worker_runtime_metric_producers_ready` until reporter lag/delivery/retry and
heartbeat metrics are emitted by the hosted reporter path too.
Record a non-secret SNS delivery smoke id and redacted delivery destination
counts before live scale-out. Internal SQS audit delivery is useful evidence,
but it does not replace approved human/on-call subscriptions.

## Backups And Restore Evidence

Verify EFS backup coverage after the first apply:

```bash
BACKUP_VAULT="$(terraform -chdir="$TF_DIR" output -raw backup_vault_name)"
EFS_FILE_SYSTEM_ID="$(terraform -chdir="$TF_DIR" output -raw efs_file_system_id)"
EFS_FILE_SYSTEM_ARN="$(aws efs describe-file-systems \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --file-system-id "$EFS_FILE_SYSTEM_ID" \
  --query 'FileSystems[0].FileSystemArn' \
  --output text)"

aws backup list-protected-resources \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --query "Results[?ResourceArn=='$EFS_FILE_SYSTEM_ARN'].[ResourceArn,LastBackupTime]"
aws backup list-recovery-points-by-backup-vault \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --backup-vault-name "$BACKUP_VAULT" \
  --query "RecoveryPoints[?ResourceArn=='$EFS_FILE_SYSTEM_ARN'].[RecoveryPointArn,Status,CreationDate]"
```

Before live scale-out, approve and record the backup retention policy, then set
the Terraform lock variables in the private infra root. Do not enable the lock
from the AWS console; use Terraform so the retention window is reviewable:

```hcl
backup_retention_days = 35
backup_vault_lock_mode = "governance"
backup_vault_lock_min_retention_days = 35
backup_vault_lock_max_retention_days = 3650
backup_vault_lock_changeable_for_days = null
```

Governance mode is removable by privileged IAM users, so it is the conservative
first rollout. Compliance mode is the irreversible path: set
`backup_vault_lock_mode = "compliance"` and
`backup_vault_lock_changeable_for_days = 7` only after explicit account-owner
approval. After that grace period expires, the lock cannot be changed or deleted
by any user or by AWS. After apply, rerun the backup readiness audit and record
the sanitized output before setting `live_ops_backup_restore_ready = true`.
The mode mapping follows the
[AWS Backup Vault Lock documentation](https://docs.aws.amazon.com/aws-backup/latest/devguide/vault-lock.html)
and
[Terraform `aws_backup_vault_lock_configuration` documentation](https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/backup_vault_lock_configuration.html.markdown):
omitting `ChangeableForDays` creates governance mode; including it creates
compliance mode.

Before switching from governance to compliance mode, audit every existing
recovery point lifecycle in the vault. AWS Backup Vault Lock minimum and maximum
retention settings do not rewrite recovery points that already exist, and an
existing recovery point with indefinite retention can create permanent storage
cost after the compliance grace period expires.

```bash
aws backup list-recovery-points-by-backup-vault \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --backup-vault-name "$BACKUP_VAULT" \
  --query 'RecoveryPoints[*].{status:Status,deleteAfter:Lifecycle.DeleteAfterDays,created:CreationDate}' \
  --output json \
  | jq '{count:length, missingDeleteAfter:([.[] | select((.deleteAfter // null) == null)] | length), minDeleteAfter:([.[] | .deleteAfter // empty] | min), maxDeleteAfter:([.[] | .deleteAfter // empty] | max)}'
```

Do not enable compliance mode if any recovery point has missing or indefinite
retention, or if min/max lifecycle values contradict the approved retention
policy.

A restore drill must restore to a separate file system or staging target first.
Do not overwrite the production EFS file system during a drill. Record the
recovery point ARN, restore job id, target resource, validation result, and
cleanup action.

Run the restore drill with a dedicated restore role and a staging security group
and subnet. The metadata keys are AWS Backup EFS restore metadata; keep the
staging file system encrypted with the Open Uptime KMS key.

```bash
: "${RECOVERY_POINT_ARN:?set RECOVERY_POINT_ARN to the selected recovery point ARN}"
: "${RESTORE_ROLE_ARN:?set RESTORE_ROLE_ARN to the AWS Backup restore role ARN}"
: "${STAGING_SUBNET_ID:?set STAGING_SUBNET_ID to the staging private subnet id}"
: "${STAGING_SECURITY_GROUP_ID:?set STAGING_SECURITY_GROUP_ID to the staging EFS security group id}"
KMS_KEY_ARN="$(terraform -chdir="$TF_DIR" output -raw kms_key_arn)" # sensitive output; do not paste

RESTORE_JOB_ID="$(aws backup start-restore-job \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --recovery-point-arn "$RECOVERY_POINT_ARN" \
  --iam-role-arn "$RESTORE_ROLE_ARN" \
  --resource-type EFS \
  --metadata "file-system-id=$EFS_FILE_SYSTEM_ID,newFileSystem=true,encrypted=true,kmsKeyId=$KMS_KEY_ARN,performanceMode=generalPurpose,throughputMode=bursting" \
  --query 'RestoreJobId' \
  --output text)"

aws backup describe-restore-job \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --restore-job-id "$RESTORE_JOB_ID" \
  --query '{status:Status,createdResourceArn:CreatedResourceArn,statusMessage:StatusMessage}'
```

Poll `describe-restore-job` until `Status` is `COMPLETED`, then create a
temporary mount target for the restored file system in the staging subnet:

```bash
RESTORED_EFS_ID="$(aws backup describe-restore-job \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --restore-job-id "$RESTORE_JOB_ID" \
  --query 'CreatedResourceArn' \
  --output text | awk -F/ '{print $NF}')"

aws efs create-mount-target \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --file-system-id "$RESTORED_EFS_ID" \
  --subnet-id "$STAGING_SUBNET_ID" \
  --security-groups "$STAGING_SECURITY_GROUP_ID"
```

Validate the restored `/data/uptime/uptime.db` from a staging host or task with
read-only SQLite integrity checks. For a zero-count pre-production deployment
where `uptime.db` does not exist yet, create a representative restore-drill DB
with the same SQLite access path and record it separately. Capture only counts
and integrity status, not monitor targets or secrets:

```bash
sqlite3 /mnt/restore/uptime/uptime.db 'PRAGMA integrity_check;'
sqlite3 /mnt/restore/uptime/uptime.db 'SELECT COUNT(*) FROM monitors;'
```

Do not count a restore as complete if the task only proves that EFS mounted.
The evidence must include the restored DB path, `PRAGMA integrity_check = ok`,
schema version, sanitized table counts, and cleanup proof for the temporary
mount target and file system.

After evidence is recorded, delete the staging mount target and restored file
system. Never mount the restored file system over production during a drill.

## Reports And Reporter Gate

Report preview can be tested locally or through authenticated read APIs. Hosted
delivery attempts through Mailery, Telephony, or Open Logs must stay disabled
until the reporter has approved channel secret loading, redacted S3/object
artifact writer wiring and smoke evidence, approved Open Logs audit export
wiring and smoke evidence, delivery alarms, and reviewed live-worker rollback
evidence. The Postgres report-runtime helper can claim due report schedule
windows, begin and finish fenced report runs, write delivery-attempt state,
stable per-attempt idempotency keys, retry metadata, redacted artifact metadata
refs, and validated callback contracts for artifact object writes and Open Logs
audit payloads, but this is narrower than hosted reporter readiness.

The hosted report-control-plane adapter may be enabled only by passing an
explicit `hostedPostgresReportRuntime` to the API handler. It can create, list,
patch, and tombstone report schedule metadata; list report runs; and list audit
events from workspace-scoped Postgres storage. It must reject raw provider
destinations and boolean channel fan-out selectors in favor of explicit
approved `channelRefIds`, and it must continue returning 501 for
`run-due`/single-schedule execution routes until the reporter promotion gate
above is satisfied.

`0.1.42` adds a separate Postgres core runtime facade for monitor rows, probe
identities, deterministic `check_jobs`, check results, audit events, and
sync tombstones. Treat it as SDK/runtime groundwork only. Do not set
`HASNA_UPTIME_DATABASE_URL` on hosted ECS tasks or raise any worker desired count
until the service/API/worker loops are wired to the runtime, live RLS/schema
verification passes against the approved DB, and scheduler/probe/reporter
alarms plus deploy-drain evidence exist.

`0.1.44` adds `uptimemon cloud postgres-scheduler run` for bounded private review
of deterministic Postgres `check_jobs` creation. It requires an explicit
workspace id, uses producer-side hosted target-policy checks, supports only
public probe policy, and caps catch-up slots. `0.1.43` adds
`uptimemon cloud postgres-public-probe run` for bounded private review of existing
Postgres `check_jobs`. It requires an explicit workspace id and probe id, uses
the hosted target policy for HTTP/TCP execution, and fenced-cancels stale or
unsupported claimed jobs. Use both only against a disposable or approved
Postgres review database until live RLS, schema-version evidence, scheduler
lease ownership, deploy drain, backlog/stale-lease alarms, and sustained worker
rollback evidence exist. They are not the EFS SQLite `cloud public-checks`
bridge and do not permit changing the ECS scheduler or public-probe command or
desired count.

`uptimemon cloud workers preflight --role reporter --json` validates
`HASNA_UPTIME_REPORT_CHANNEL_REFS_JSON` as an operator-provided, server-owned
Mailery, Telephony, and Open Logs channel-ref catalog. This environment value is
runtime configuration, not a client request, MCP input, or schedule payload. A
valid catalog only proves the configured refs are shaped safely and contain no
raw URLs, recipients, tokens, keys, or secret values; clients must later submit
approved channel ids only, never `secretRef` values. It is not permission to
scale the reporter while the full Postgres service store, worker liveness,
report run state machine, approved S3/object artifact storage wiring and smoke
evidence, approved audit export wiring and smoke evidence, and delivery alarms
are still blocked.

`0.1.65` requires `HASNA_UPTIME_REPORTER_PROMOTION_EVIDENCE_JSON` to include a
safe `workspaceId` that matches the active reporter workspace whenever
promotion evidence is supplied. `0.1.64` added the variable as a redacted
operator evidence input for reporter preflight. Use it only after private
runbook evidence has already proven the exact object-store, Open Logs export,
alarm, and liveness checks. The JSON is intentionally boolean/count based and
must not contain bucket names, ARNs, URLs, account ids, recipients, token names,
object keys, or provider payloads.

`0.1.66` adds a bounded hosted Postgres monitor API adapter for
`/api/v1/summary` and `/api/v1/monitors*` when the API handler is supplied an
explicit `hostedPostgresRuntime`; `0.1.67` corrects it with monitor-list offset
paging, expected-revision PATCH guards, and audit-key PATCH replay conflict
checks. Treat it as control-plane wiring only. Do not set
`HASNA_UPTIME_DATABASE_URL` for `uptimemon serve`, do not scale ECS services, and
do not treat report, incident, result, import, probe, scheduler, browser, or
reporter routes as cloud-primary until their Postgres-backed contracts and live
evidence exist.

`0.1.69` adds a bounded hosted Postgres probe API adapter for explicit
`hostedPostgresProbeRuntime` wiring. It can enroll probe identities with an
admin-scoped hosted token, claim existing `check_jobs` with a token bound to the
same `probeId`, and accept signed probe result submissions after verifying the
probe public key from workspace-scoped Postgres storage. It does not enable
hosted probe listing, API job creation, heartbeat, revocation, rotation, worker
service startup, private target seeding, or private-probe scale-out. Keep those
gates blocked until the inventory-backed private target refs,
SSRF/private-routing evidence, worker alarms, deploy drain, and live probe
liveness evidence are recorded.

Example reporter evidence shape:

```json
{
  "version": "open-uptime.reporter-promotion-evidence.v1",
  "redacted": true,
  "workspaceId": "<workspace-id>",
  "checkedAt": "2026-06-30T01:00:00.000Z",
  "checks": {
    "artifactObjectStore": {
      "ok": true,
      "reviewed": true,
      "smokePassed": true,
      "encrypted": true,
      "redactedOnly": true,
      "workspaceScoped": true
    },
    "auditExport": {
      "ok": true,
      "reviewed": true,
      "smokePassed": true,
      "redactedOnly": true,
      "workspaceScoped": true,
      "service": "logs"
    },
    "deliveryAlarms": {
      "ok": true,
      "reviewed": true,
      "alarmCount": 4,
      "actionsConfigured": true,
      "reporterMetricsReviewed": true
    },
    "workerLiveness": {
      "ok": true,
      "reviewed": true,
      "sustainedRunSeconds": 300,
      "drainProven": true,
      "rollbackProven": true
    }
  }
}
```

The preflight rejects unsafe evidence and keeps `canStart=false` while shared
worker gates such as the service-store adapter, channel secret loading, worker
lease ownership, and deploy drain remain incomplete. Do not use promotion
evidence JSON to bypass those gates. Evidence without `workspaceId`, with an
unsafe workspace id, or with a workspace id that does not match the active
`HASNA_UPTIME_WORKSPACE_ID` is rejected fail-closed.

Hosted report delivery must use the server-side channel-ref resolver, not the
local direct `--mailery-url`, `--telephony-url`, recipient, or token flags. The
report schedule/run must select explicit approved channel ids; the resolver must
not fan out to every enabled ref in the catalog. The runtime secret loader
resolves each selected `secretRef` to a
`open-uptime.report-channel-secret.v1` payload, verifies the service and target
binding, and sends only through the approved Mailery `/api/v1/send`, Telephony
`/api/sms/send`, and Open Logs `/api/logs/structured` APIs. Delivery evidence
may record channel ids, provider ids, response ids, status codes, target-ref
hashes, and request hashes. It must not record raw recipients, phone numbers, tokens,
send keys, full secret payloads, provider-echoed targets, raw target refs, or Terraform
state/saved-plan bodies. Hosted delivery redacts monitor target URLs, hosts,
ports, and target-like incident text before creating email, SMS, Open Logs, or
request-hash payloads.

Do not set `desired_counts.reporter = 1` until a reviewed runbook section exists
for report retry, duplicate suppression, provider failure handling, and delivery
audit export.

## Private Probe Operator

The operator machine should be a private probe/operator machine, not the hosted
source of truth. The generated env file points the machine at hosted `/api/v1`
state and references a local private-key file path. It does not include private
key or token contents.

The private probe service should not be enabled until the hosted service wiring
injects the audited `hostedPostgresProbeRuntime`, probe tokens are bound to
their exact `probeId`, private targets come from approved inventory refs, and
heartbeat, revocation, rotation, alarms, deploy drain, and live liveness evidence
are all recorded.

`0.1.59` adds a read-only Postgres private-probe preflight for identity review:

```bash
uptimemon cloud postgres-private-probe preflight \
  --workspace-id "$HASNA_UPTIME_WORKSPACE_ID" \
  --probe-id "$HASNA_UPTIME_PRIVATE_PROBE_ID" \
  --machine-id "$HASNA_UPTIME_MACHINE_ID" \
  --probe-location "$HASNA_UPTIME_PROBE_LOCATION" \
  --public-key-fingerprint "<sha256-fingerprint>" \
  --json
```

This command reads the Postgres probe identity, expected machine/location/public
key fingerprint bindings, due private job count, and stale private lease count.
It can prove `canUseCloudIdentityForReview=true`, but it still returns
`canStartHostedProbe=false` and `canPromotePrivateProbe=false`. The bounded
`0.1.69` API adapter can claim and submit through an injected audited Postgres
probe runtime, but hosted service startup, heartbeat/revoke/rotation routes,
approved private inventory refs, worker alarms, deploy drain, and live
operational evidence remain required before promotion. Do not include private
keys, raw targets, tokens, database URLs, or saved Terraform state/plan contents
in this output.

## Safety Rules

- Do not deploy hosted mode with `HASNA_UPTIME_ALLOW_HOSTED_LOCAL_STORE=1`.
- Do deploy hosted mode with `HASNA_UPTIME_HOSTED_SQLITE_DB` pointing at the EFS
  mount path `/data/uptime/uptime.db`. Do not set `HASNA_UPTIME_DATABASE_URL`
  until the full hosted Postgres runtime adapter is wired through
  `UptimeService`, the API, and worker loops.
- Use `uptimemon cloud postgres-migrate` only from the reviewed migration path.
  Dry-run output is safe for redacted review. Actual DDL requires
  `--apply --confirm-schema <schema>`, a TLS database URL, current backup and
  rollback evidence, and a migration task/operator context. A successful
  migration does not make hosted web, scheduler, public-probe, reporter, or
  private-probe runtime promotion-ready by itself.
- Do set `HASNA_UPTIME_ALLOWED_ORIGINS` on the hosted web task to the public
  HTTPS edge origin, such as the CloudFront default domain or approved custom
  hostname.
- Do not inline AWS keys, hosted tokens, Mailery keys, Open Logs tokens, database
  URLs, or probe private keys in task definitions. Use ECS `secrets.valueFrom`
  refs such as `HASNA_UPTIME_HOSTED_TOKEN`.
- Do not run public probe workers against private targets.
- Do not enable public probe workers until their cloud check-job path is wired
  through the hosted service/API contracts, records target-policy decision
  evidence, and passes AWS smokes for denied DNS answers, redirect-to-denied
  targets, address pinning, deploy drain, backlog metrics, stale leases, and
  rollback. The SDK and `uptimemon cloud public-checks run-due` path handle
  execution-time DNS and redirect enforcement for bounded EFS SQLite smokes. The
  `uptimemon cloud public-checks run-due` and `worker` commands are blocked unless
  `--allow-public-checks-bridge` or
  `HASNA_UPTIME_ALLOW_PUBLIC_CHECKS_BRIDGE=1` is set for a reviewed EFS SQLite
  bridge smoke. They are not the final cloud `check_jobs`/lease/fencing
  protocol. The separate `uptimemon cloud postgres-scheduler run` and
  `uptimemon cloud postgres-public-probe run` commands can review bounded Postgres
  job production and consumption, but they do not make the generic ECS
  scheduler or public-probe workers startable.
- Do not enable scheduler, public-probe, reporter, or migration workers against
  the EFS SQLite bridge; those services need Postgres/cloud leases first.
- Do not expose dashboard/API routes without hosted auth and workspace checks.
- Do not expose the ALB directly in CloudFront mode; ALB ingress must be limited
  to CloudFront origin-facing ranges.
- Do not treat CloudFront prefix-list ingress as distribution-bound origin
  protection. In `cloudfront_default_domain` mode, enable the module's
  CloudFront-only origin verification header and keep its generated value out of
  the public repo and shared logs. Terraform redacts the sensitive input in CLI
  output, but the value is still stored in encrypted Terraform state, saved plan
  files, and AWS CloudFront/ALB configuration; restrict access accordingly.
- Keep private Terraform plan artifacts owner-only. Before creating saved plans,
  set `umask 077`; after historical plan creation, run `chmod 600 *.tfplan` in
  the private evidence plan directory. Terraform plan files can contain
  sensitive values even when CLI output is redacted.
- Do not treat `cloudfront_origin_protocol_policy = "http-only"` as final for
  token-bearing traffic. The module supports `https-only`, but that mode needs a
  real origin DNS name and matching ACM certificate because CloudFront verifies
  the custom-origin TLS certificate against the origin host.
- Do not treat local SQLite, local project DBs, or private-probe local state as cloud
  authority after cutover.
- Do configure owner/project/environment/service/cost-center tags, AWS Budgets
  notifications, approved human/on-call SNS subscriptions, and a non-secret
  human delivery smoke in the approved infra root before live scale-out.

## Rollback

Before each service update, record the current source/package/image pins, task
definition ARN, and desired counts:

```bash
terraform -chdir="$TF_DIR" output -raw source_commit
terraform -chdir="$TF_DIR" show -json \
  | jq -r '
      .values.root_module.child_modules[]?
      | select(.address == "module.open_uptime")
      | .resources[]?
      | select(.address | endswith("aws_ecs_task_definition.service[\"web\"]"))
      | .values.container_definitions
    '
ECS_CLUSTER="$(terraform -chdir="$TF_DIR" output -raw ecs_cluster_name)"
WEB_SERVICE="$(terraform -chdir="$TF_DIR" output -json service_names | jq -r '.[] | select(endswith("-web"))')"
aws ecs describe-services \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$WEB_SERVICE" \
  --query 'services[0].{taskDefinition:taskDefinition,desired:desiredCount,running:runningCount}'
```

If web health fails after scale-up, first scale web back to `0`:

```bash
aws ecs update-service \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --service "$WEB_SERVICE" \
  --desired-count 0
```

If a later task definition is bad during a zero-count image refresh, do not
assume the previous ECS task definition revision is still active. Terraform may
deregister replaced task definitions. Prefer rolling back by re-pinning the
private root to the previous reviewed source/package/image values, planning with
all desired counts still `0`, machine-checking that only dormant task
definitions/service pointers change, applying the saved plan, and rerunning the
literal version smoke plus no-drift checks.

```bash
: "${PREVIOUS_SOURCE_REF:?set PREVIOUS_SOURCE_REF from the pre-update evidence}"
: "${PREVIOUS_PACKAGE_VERSION:?set PREVIOUS_PACKAGE_VERSION from the pre-update evidence}"
: "${PREVIOUS_PACKAGE_INTEGRITY:?set PREVIOUS_PACKAGE_INTEGRITY from the pre-update evidence}"
: "${PREVIOUS_IMAGE_DIGEST:?set PREVIOUS_IMAGE_DIGEST from the pre-update evidence}"

# Edit the private root to restore source_ref, module source ref,
# runtime_package_version, runtime_package_integrity, and container_image.
terraform -chdir="$TF_DIR" plan \
  -var-file="$HASNA_UPTIME_TF_VARS" \
  -out=/tmp/open-uptime-prod-rollback.tfplan \
  -detailed-exitcode \
  -no-color
terraform -chdir="$TF_DIR" show -json /tmp/open-uptime-prod-rollback.tfplan \
  | jq '{changes:[.resource_changes[]? | select(.change.actions != ["no-op"]) | {type, actions:.change.actions}]}'
terraform -chdir="$TF_DIR" apply -no-color /tmp/open-uptime-prod-rollback.tfplan
```

An emergency `aws ecs update-service --task-definition "$PREVIOUS_TASK_DEFINITION_ARN"
--desired-count 0` is acceptable only after `aws ecs describe-task-definition`
confirms that ARN is still `ACTIVE`; follow it with a Terraform re-pin so state
converges. Record whether rollback was rehearsed or only procedural evidence.

Only use a nonzero desired count after the live web scale-up gates are met and
the pre-update evidence shows the service was already live.

Disable scheduler/reporter/probe work before data rollback. EFS backup restore
requires separate operator approval, a selected recovery point, a replacement
mount target/access point cutover, validation in staging, and an audit event.

## Evidence Checklist

A deployment record is not complete until it contains:

- source commit, package version, published package integrity, and image digest;
- Terraform plan summary and zero-count desired-count proof;
- secret metadata proof showing `AWSCURRENT` without secret values;
- redacted `uptimemon cloud edge-smoke --json` results with `promotionReady=true`,
  plus fixed-403 or explicitly unreachable direct-origin denial evidence;
- ECS service/task definition evidence;
- CloudWatch log tail and alarm-state readback;
- backup vault, protected-resource, recovery-point, and restore-drill evidence;
- rollback command transcript or dry-run notes;
- explicit list of remaining disabled workers and why they remain disabled.
