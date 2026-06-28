# AWS Deployment Runbook

This runbook is for a reviewed AWS account target. It is intentionally dry-run
first: the local generator produces a plan and command list, but it does not
call AWS or mutate infrastructure.

## Generate The Plan

```bash
uptime cloud plan --json > open-uptime-aws-plan.json
uptime cloud spark01-config --probe-id prb_spark01 --env > spark01-uptime.env
```

Public package defaults are placeholders:

- account/profile label: `aws-profile`
- region: `us-east-1`
- VPC: `vpc-xxxxxxxx`
- hosted data path: EFS-mounted SQLite at `/data/uptime/uptime.db`
- hostname: `uptime.example.com`
- workspace id: `workspace-id`

Override these with CLI flags or private deployment evidence for the real
account, hostname, workspace id, VPC id, secret refs, and repository names.

The generated AWS plan currently returns `status: "blocked"` and
`canApply: false`. The generated Spark01 config returns `status: "blocked"` and
`canStart: false`. Treat both as review/preflight artifacts until the blockers
and required evidence in the JSON output are resolved.

The app repo includes a hosted runtime `Dockerfile` and Terraform/OpenTofu
starter files in `infra/aws`. The plan output points to these files and keeps
`applyAllowed: false`.

`uptime cloud spark01-config --env` requires a real `--probe-id`; it will not
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
4. Confirm Route53/edge ownership for the chosen hostname.
5. Confirm the deployment role uses short-lived credentials or OIDC, not copied
   access keys.

## Required Resources

The plan expects:

- ECR repository for the Open Uptime image.
- ECS/Fargate cluster with separate services for web, scheduler, public probe,
  reporter, and one-off migrations. In the current EFS SQLite bridge, only web
  may be enabled and it must run at desired count `0` or `1`.
- ALB, TLS certificate, target group, and security groups.
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

## Spark01

Spark01 should be a private probe/operator machine, not the hosted source of
truth. The generated env file points Spark01 at hosted `/api/v1` state and
references a local private-key file path. It does not include private key or
token contents.

The private probe service should not be enabled until hosted probe claim/submit
routes are backed by cloud check jobs and cloud audit rows.

## Safety Rules

- Do not deploy hosted mode with `HASNA_UPTIME_ALLOW_HOSTED_LOCAL_STORE=1`.
- Do deploy hosted mode with `HASNA_UPTIME_HOSTED_SQLITE_DB` pointing at the EFS
  mount path `/data/uptime/uptime.db`. Do not set `HASNA_UPTIME_DATABASE_URL`
  until the async Postgres adapter exists.
- Do not inline AWS keys, hosted tokens, Mailery keys, Open Logs tokens, database
  URLs, or probe private keys in task definitions. Use ECS `secrets.valueFrom`
  refs such as `HASNA_UPTIME_HOSTED_TOKEN`.
- Do not run public probe workers against private targets.
- Do not enable scheduler, public-probe, reporter, or migration workers against
  the EFS SQLite bridge; those services need Postgres/cloud leases first.
- Do not expose dashboard/API routes without hosted auth and workspace checks.
- Do not treat local SQLite, local project DBs, or Spark01 local state as cloud
  authority after cutover.

## Rollback

Before each service update, record the previous task definition ARN. Roll back
by disabling scheduler/reporter work first, then restoring the previous web or
worker task definition. EFS backup restore requires separate operator approval,
a selected recovery point, a replacement mount target/access point cutover, and
an audit event.
