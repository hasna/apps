# AWS Deployment Runbook

This runbook is for a reviewed AWS account target. It is intentionally dry-run
first: the local generator produces a plan and command list, but it does not
call AWS or mutate infrastructure.

## Generate The Plan

```bash
uptime cloud plan --json > open-uptime-aws-plan.json
uptime cloud private-probe-config --probe-id prb_private_01 --machine-id private-probe-01 --env > private-probe-01-uptime.env
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

`uptime cloud private-probe-config --env` requires a real `--probe-id`; it will not
write a sourceable env file with a placeholder probe identity.

## Preflight

1. Locate the real infrastructure repository or create the change in the
   approved owner repository.
2. Confirm the AWS caller identity:

   ```bash
   aws sts get-caller-identity --profile <aws-profile>
   ```

3. Confirm the target VPC, private subnets, KMS key, and EFS/Backup plan inputs
   still match the plan.
4. Confirm the protected access mode. The first deploy can use the CloudFront
   default HTTPS domain without custom DNS or ACM. Custom hostname deploys still
   require Route53/edge ownership and an ACM certificate.
5. Confirm the deployment role uses short-lived credentials or OIDC, not copied
   access keys.
6. Create a private evidence directory outside the public repository. Store
   command output, plan summaries, screenshots, and incident notes there. Do
   not store tokens, database URLs, probe private keys, or secret values.

## Required Resources

The plan expects:

- ECR repository for the Open Uptime image.
- ECS/Fargate cluster with separate services for web, scheduler, public probe,
  reporter, and one-off migrations. In the current EFS SQLite bridge, only web
  may be enabled and it must run at desired count `0` or `1`.
- CloudFront default-domain HTTPS edge plus ALB HTTP origin restricted to
  CloudFront origin-facing ranges, or an ALB HTTPS listener with ACM certificate
  when custom DNS is approved.
- Encrypted EFS file system, access point, mount targets, and AWS Backup plan
  for `HASNA_UPTIME_HOSTED_SQLITE_DB=/data/uptime/uptime.db`.
- S3 bucket for redacted browser evidence and generated report artifacts.
- Secrets Manager or SSM refs for app env, hosted token, probe config, and
  reporting channel refs.
- CloudWatch log groups for every component plus initial web 5xx/unhealthy
  alarms. Scheduler-stall, stale-probe, and report-delivery alarms remain
  blocked until those workers emit cloud metrics.

Provision these through the approved infrastructure repository and reviewed
plan/apply flow. The local `uptime cloud plan` output intentionally avoids
copy-pastable AWS mutation commands.

Plan the included Terraform/OpenTofu starter without a backend:

```bash
terraform -chdir=infra/aws fmt -check
terraform -chdir=infra/aws init -backend=false
terraform -chdir=infra/aws validate
terraform -chdir=infra/aws plan -out open-uptime.tfplan
```

Use Terraform/OpenTofu 1.9 or newer for this starter.

## Zero-Count Apply

The first reviewed apply must create infrastructure with every ECS service at
desired count `0`.

1. Confirm the plan has no deletes or replacements and that all ECS services are
   dormant:

   ```bash
   terraform show -json open-uptime.tfplan \
     | jq -r '.resource_changes[] | select(.type=="aws_ecs_service") | [.address, .change.after.desired_count] | @tsv'
   ```

2. Confirm Terraform is not managing secret values:

   ```bash
   terraform show -json open-uptime.tfplan \
     | jq -r '.resource_changes[] | select(.type | test("secret_version|random_password|random_string")) | .address'
   ```

   This command must print nothing.

3. Apply only the reviewed zero-count plan:

   ```bash
   terraform apply open-uptime.tfplan
   ```

4. Capture outputs, the source commit, the package version, the plan summary,
   and the caller identity in private deployment evidence.

## Image And Secrets

After the zero-count apply, build the image through the approved deploy pipeline
or the declared image builder. Record only the immutable digest, not build logs
that contain environment values:

```bash
aws codebuild start-build \
  --profile <aws-profile> \
  --region <region> \
  --project-name <image-builder-project>
```

Update the approved infra root so `container_image` is the immutable ECR digest,
then re-plan with all services still at `0`.

Populate Secrets Manager values out of band. Verify metadata only:

```bash
aws secretsmanager describe-secret --profile <aws-profile> --region <region> --secret-id <secret-name>
aws secretsmanager list-secret-version-ids --profile <aws-profile> --region <region> --secret-id <secret-name>
```

Each required secret must have an `AWSCURRENT` version before any task is
started. Never run `get-secret-value` in shared logs or public evidence.

## Protected Web Scale-Up

Before setting `desired_counts.web = 1`, verify:

- the image is an immutable digest, not a mutable tag or placeholder;
- required secrets have `AWSCURRENT` versions;
- `HASNA_UPTIME_ALLOWED_ORIGINS` matches the public HTTPS edge origin;
- CloudFront origin access is distribution-bound, not just narrowed to
  CloudFront origin-facing ranges;
- web egress to ECR, Secrets Manager, CloudWatch Logs, S3, EFS, and any required
  endpoints has been proven through NAT or VPC endpoints;
- scheduler, public-probe, reporter, and migration remain at `0`.

Scale only the web task, then capture the ECS deployment id and task definition
ARN:

```bash
ECS_CLUSTER="$(terraform output -raw ecs_cluster_name)"
WEB_SERVICE="$(terraform output -json service_names | jq -r '.[] | select(endswith("-web"))')"
aws ecs describe-services \
  --profile <aws-profile> \
  --region <region> \
  --cluster "$ECS_CLUSTER" \
  --services "$WEB_SERVICE" \
  --query 'services[0].{taskDefinition:taskDefinition,deployments:deployments[*].{id:id,status:status,desired:desiredCount,running:runningCount}}'
```

## Smoke Checks

Run these checks through the public edge URL and record status codes and request
ids. Use a scoped hosted token only from the operator secret store.

```bash
curl -fsS https://<edge-host>/health
curl -i https://<edge-host>/
curl -i https://<edge-host>/api/v1/summary
curl -i -H "Authorization: Bearer <token-from-secret-store>" https://<edge-host>/api/v1/summary
```

Expected results:

- `/health` returns `200` and no monitor data.
- Dashboard and API reads without auth return `401` or the approved identity
  layer denial.
- Authenticated API reads return only the authorized workspace.
- Direct ALB origin access is denied unless it is the approved CloudFront origin
  path.

## Logs And Alarms

Inspect recent web logs without printing secrets:

```bash
WEB_LOG_GROUP="$(terraform output -json log_group_names | jq -r '.web')"
aws logs tail "$WEB_LOG_GROUP" \
  --profile <aws-profile> \
  --region <region> \
  --since 15m
```

Verify the initial web alarms exist and are not already alarming:

```bash
WEB_5XX_ALARM="$(terraform output -json alarm_names | jq -r '.web_5xx')"
WEB_UNHEALTHY_ALARM="$(terraform output -json alarm_names | jq -r '.web_unhealthy')"
aws cloudwatch describe-alarms \
  --profile <aws-profile> \
  --region <region> \
  --alarm-names "$WEB_5XX_ALARM" "$WEB_UNHEALTHY_ALARM" \
  --query 'MetricAlarms[*].{name:AlarmName,state:StateValue,reason:StateReason}'
```

Scheduler-stall, stale-probe, and report-delivery alarms stay blocked until
those workers are implemented, emit metrics, and are enabled.

## Backups And Restore Evidence

Verify EFS backup coverage after the first apply:

```bash
BACKUP_VAULT="$(terraform output -raw backup_vault_name)"
EFS_FILE_SYSTEM_ID="$(terraform output -raw efs_file_system_id)"
EFS_FILE_SYSTEM_ARN="$(aws efs describe-file-systems \
  --profile <aws-profile> \
  --region <region> \
  --file-system-id "$EFS_FILE_SYSTEM_ID" \
  --query 'FileSystems[0].FileSystemArn' \
  --output text)"

aws backup list-protected-resources \
  --profile <aws-profile> \
  --region <region> \
  --query "Results[?ResourceArn=='$EFS_FILE_SYSTEM_ARN'].[ResourceArn,LastBackupTime]"
aws backup list-recovery-points-by-backup-vault \
  --profile <aws-profile> \
  --region <region> \
  --backup-vault-name "$BACKUP_VAULT" \
  --query "RecoveryPoints[?ResourceArn=='$EFS_FILE_SYSTEM_ARN'].[RecoveryPointArn,Status,CreationDate]"
```

A restore drill must restore to a separate file system or staging target first.
Do not overwrite the production EFS file system during a drill. Record the
recovery point ARN, restore job id, target resource, validation result, and
cleanup action.

Run the restore drill with a dedicated restore role and a staging security group
and subnet. The metadata keys are AWS Backup EFS restore metadata; keep the
staging file system encrypted with the Open Uptime KMS key.

```bash
RECOVERY_POINT_ARN="<selected-recovery-point-arn>"
RESTORE_ROLE_ARN="<aws-backup-restore-role-arn>"
STAGING_SUBNET_ID="<staging-private-subnet-id>"
STAGING_SECURITY_GROUP_ID="<staging-efs-security-group-id>"
KMS_KEY_ARN="$(terraform output -raw kms_key_arn)"

RESTORE_JOB_ID="$(aws backup start-restore-job \
  --profile <aws-profile> \
  --region <region> \
  --recovery-point-arn "$RECOVERY_POINT_ARN" \
  --iam-role-arn "$RESTORE_ROLE_ARN" \
  --resource-type EFS \
  --metadata "file-system-id=$EFS_FILE_SYSTEM_ID,newFileSystem=true,encrypted=true,kmsKeyId=$KMS_KEY_ARN,performanceMode=generalPurpose,throughputMode=bursting" \
  --query 'RestoreJobId' \
  --output text)"

aws backup describe-restore-job \
  --profile <aws-profile> \
  --region <region> \
  --restore-job-id "$RESTORE_JOB_ID" \
  --query '{status:Status,createdResourceArn:CreatedResourceArn,statusMessage:StatusMessage}'
```

Poll `describe-restore-job` until `Status` is `COMPLETED`, then create a
temporary mount target for the restored file system in the staging subnet:

```bash
RESTORED_EFS_ID="$(aws backup describe-restore-job \
  --profile <aws-profile> \
  --region <region> \
  --restore-job-id "$RESTORE_JOB_ID" \
  --query 'CreatedResourceArn' \
  --output text | awk -F/ '{print $NF}')"

aws efs create-mount-target \
  --profile <aws-profile> \
  --region <region> \
  --file-system-id "$RESTORED_EFS_ID" \
  --subnet-id "$STAGING_SUBNET_ID" \
  --security-groups "$STAGING_SECURITY_GROUP_ID"
```

Validate the restored `/data/uptime/uptime.db` from a staging host or task with
read-only SQLite integrity checks. Capture only counts and integrity status, not
monitor targets or secrets:

```bash
sqlite3 /mnt/restore/uptime/uptime.db 'PRAGMA integrity_check;'
sqlite3 /mnt/restore/uptime/uptime.db 'SELECT COUNT(*) FROM monitors;'
```

After evidence is recorded, delete the staging mount target and restored file
system. Never mount the restored file system over production during a drill.

## Reports And Reporter Gate

Report preview can be tested locally or through authenticated read APIs. Hosted
delivery attempts through Mailery, Telephony, or Open Logs must stay disabled
until the reporter has cloud channel refs, idempotency storage, retry/backoff
state, audit rows, and delivery alarms.

Do not set `desired_counts.reporter = 1` until a reviewed runbook section exists
for report retry, duplicate suppression, provider failure handling, and delivery
audit export.

## Private Probe Operator

The operator machine should be a private probe/operator machine, not the hosted
source of truth. The generated env file points the machine at hosted `/api/v1`
state and references a local private-key file path. It does not include private
key or token contents.

The private probe service should not be enabled until hosted probe claim/submit
routes are backed by cloud check jobs and cloud audit rows.

## Safety Rules

- Do not deploy hosted mode with `HASNA_UPTIME_ALLOW_HOSTED_LOCAL_STORE=1`.
- Do deploy hosted mode with `HASNA_UPTIME_HOSTED_SQLITE_DB` pointing at the EFS
  mount path `/data/uptime/uptime.db`. Do not set `HASNA_UPTIME_DATABASE_URL`
  until the async Postgres adapter exists.
- Do set `HASNA_UPTIME_ALLOWED_ORIGINS` on the hosted web task to the public
  HTTPS edge origin, such as the CloudFront default domain or approved custom
  hostname.
- Do not inline AWS keys, hosted tokens, Mailery keys, Open Logs tokens, database
  URLs, or probe private keys in task definitions. Use ECS `secrets.valueFrom`
  refs such as `HASNA_UPTIME_HOSTED_TOKEN`.
- Do not run public probe workers against private targets.
- Do not enable public probe workers until runtime target policy resolves and
  pins DNS answers, rejects redirects and DNS rebinding into denied ranges, and
  emits target-policy decision records. The current configuration-time policy
  blocks direct denied hosts, including IPv4-mapped IPv6 forms, but it is not a
  substitute for execution-time DNS and redirect enforcement.
- Do not enable scheduler, public-probe, reporter, or migration workers against
  the EFS SQLite bridge; those services need Postgres/cloud leases first.
- Do not expose dashboard/API routes without hosted auth and workspace checks.
- Do not expose the ALB directly in CloudFront mode; ALB ingress must be limited
  to CloudFront origin-facing ranges.
- Do not treat CloudFront prefix-list ingress as distribution-bound origin
  protection. Before enabling the web task, add CloudFront VPC origin/private
  ALB routing or require a CloudFront-only origin header whose secret value is
  not stored in Terraform state.
- Do not treat local SQLite, local project DBs, or private-probe local state as cloud
  authority after cutover.
- Do configure owner/project/environment/service/cost-center tags and AWS
  Budgets alert recipients in the approved infra root before live scale-out.

## Rollback

Before each service update, record the previous task definition ARN and current
desired counts:

```bash
ECS_CLUSTER="$(terraform output -raw ecs_cluster_name)"
WEB_SERVICE="$(terraform output -json service_names | jq -r '.[] | select(endswith("-web"))')"
aws ecs describe-services \
  --profile <aws-profile> \
  --region <region> \
  --cluster "$ECS_CLUSTER" \
  --services "$WEB_SERVICE" \
  --query 'services[0].{taskDefinition:taskDefinition,desired:desiredCount,running:runningCount}'
```

If web health fails after scale-up, first scale web back to `0`:

```bash
aws ecs update-service \
  --profile <aws-profile> \
  --region <region> \
  --cluster "$ECS_CLUSTER" \
  --service "$WEB_SERVICE" \
  --desired-count 0
```

If a later task definition is bad, restore the previous task definition and keep
workers disabled:

```bash
aws ecs update-service \
  --profile <aws-profile> \
  --region <region> \
  --cluster "$ECS_CLUSTER" \
  --service "$WEB_SERVICE" \
  --task-definition <previous-task-definition-arn> \
  --desired-count 1
```

Disable scheduler/reporter/probe work before data rollback. EFS backup restore
requires separate operator approval, a selected recovery point, a replacement
mount target/access point cutover, validation in staging, and an audit event.

## Evidence Checklist

A deployment record is not complete until it contains:

- source commit, package version, published package integrity, and image digest;
- Terraform plan summary and zero-count desired-count proof;
- secret metadata proof showing `AWSCURRENT` without secret values;
- protected edge smoke results and direct-origin denial evidence;
- ECS service/task definition evidence;
- CloudWatch log tail and alarm-state readback;
- backup vault, protected-resource, recovery-point, and restore-drill evidence;
- rollback command transcript or dry-run notes;
- explicit list of remaining disabled workers and why they remain disabled.
