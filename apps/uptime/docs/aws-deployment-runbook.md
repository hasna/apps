# AWS Deployment Runbook

This runbook is for the `hasna-xyz-infra` AWS account target. It is intentionally
dry-run first: the local generator produces a plan and command list, but it does
not call AWS or mutate infrastructure.

## Generate The Plan

```bash
uptime cloud plan --json > open-uptime-aws-plan.json
uptime cloud spark01-config --probe-id prb_spark01 --env > spark01-uptime.env
```

Defaults come from the current design inventory:

- account/profile label: `hasna-xyz-infra`
- region: `us-east-1`
- VPC: `vpc-04c7f7abc1d3c3f56`
- RDS instance: `hasna-xyz-infra-apps-prod-postgres`
- hostname: `uptime.hasna.xyz`
- workspace id: `wks_2tyysw05cwap`

Override these with CLI flags if the infra owner chooses a different value.

The generated AWS plan currently returns `status: "blocked"` and
`canApply: false`. The generated Spark01 config returns `status: "blocked"` and
`canStart: false`. Treat both as review/preflight artifacts until the blockers
and required evidence in the JSON output are resolved.

`uptime cloud spark01-config --env` requires a real `--probe-id`; it will not
write a sourceable env file with a placeholder probe identity.

## Preflight

1. Locate the real `hasna-xyz-infra` infrastructure repository or create the
   change in the approved owner repository.
2. Confirm the AWS caller identity:

   ```bash
   aws sts get-caller-identity --profile hasna-xyz-infra
   ```

3. Confirm the target VPC and RDS instance still match the plan.
4. Confirm Route53/edge ownership for the chosen hostname.
5. Confirm the deployment role uses short-lived credentials or OIDC, not copied
   access keys.

## Required Resources

The plan expects:

- ECR repository for the Open Uptime image.
- ECS/Fargate cluster with separate services for web, scheduler, public probe,
  reporter, and one-off migrations.
- ALB, TLS certificate, target group, and security groups.
- Existing private Postgres instance with dedicated Uptime roles or database.
- S3 bucket for redacted browser evidence and generated report artifacts.
- Secrets Manager or SSM refs for database, app env, probe config, and
  reporting channel refs.
- CloudWatch log groups and alarms for web 5xx, scheduler stalls, stale probes,
  and report delivery failures.

Provision these through the approved infrastructure repository and reviewed
plan/apply flow. The local `uptime cloud plan` output intentionally avoids
copy-pastable AWS mutation commands.

## Spark01

Spark01 should be a private probe/operator machine, not the hosted source of
truth. The generated env file points Spark01 at hosted `/api/v1` state and
references a local private-key file path. It does not include private key or
token contents.

The private probe service should not be enabled until hosted probe claim/submit
routes are backed by cloud check jobs and cloud audit rows.

## Safety Rules

- Do not deploy hosted mode with `HASNA_UPTIME_ALLOW_HOSTED_LOCAL_STORE=1`.
- Do not inline AWS keys, hosted tokens, Mailery keys, Open Logs tokens, or
  probe private keys in task definitions.
- Do not run public probe workers against private targets.
- Do not expose dashboard/API routes without hosted auth and workspace checks.
- Do not treat local SQLite, local project DBs, or Spark01 local state as cloud
  authority after cutover.

## Rollback

Before each service update, record the previous task definition ARN. Roll back
by disabling scheduler/reporter work first, then restoring the previous web or
worker task definition. RDS snapshot restore requires separate operator approval
and an audit event.
