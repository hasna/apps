# Open Uptime AWS Infra

This directory is a reviewable Terraform/OpenTofu starting point for deploying
Open Uptime in a reviewed AWS account. It is intentionally plan-first. Do not
apply it directly from this app repo unless the infrastructure owner has
approved this directory as the source of truth or has copied it into the
approved infra repository.

## Expected Flow

```bash
terraform -chdir=infra/aws fmt -check
terraform -chdir=infra/aws init -backend=false
terraform -chdir=infra/aws validate
terraform -chdir=infra/aws plan -out open-uptime.tfplan
```

Terraform 1.9 or newer is required by the variable validation in this starter.

Required inputs are declared in `variables.tf` and illustrated in
`terraform.tfvars.example`. Secrets are passed as Secrets Manager/SSM ARNs only;
never place plaintext tokens, database URLs, private keys, or channel
credentials in `.tfvars` files.

The current deployable hosted state path is EFS-backed SQLite mounted at
`/data/uptime/uptime.db` and wired through `HASNA_UPTIME_HOSTED_SQLITE_DB` for
one protected web task maximum. Scheduler, public-probe, reporter, and migration
must remain at desired count `0` and receive no EFS mount until the Postgres
adapter and cloud leases are implemented. Do not set
`HASNA_UPTIME_DATABASE_URL` for hosted ECS tasks until then.

The included CodeBuild project builds `@hasna/uptime` from npm with
`Dockerfile.package` and pushes the resulting image to ECR. This avoids
depending on a local Docker daemon for image publication.
`runtime_package_integrity` must be set in the private root after publish so
CodeBuild can verify the npm tarball `dist.integrity` before extracting it.
The image builder refuses unpinned packages unless
`allow_unpinned_runtime_package_integrity=true` is deliberately set for a
zero-count review build. The package image also installs production dependencies
from the published `bun.lock` with `--frozen-lockfile`.

The default protected access mode is `cloudfront_default_domain`: CloudFront
serves HTTPS on its default domain while the ALB origin is limited to AWS's
CloudFront origin-facing managed prefix list. The default origin protocol is the
temporary `http-only` bridge. Before token-bearing live traffic, prefer setting
`cloudfront_origin_protocol_policy = "https-only"` with a dedicated
`cloudfront_origin_domain_name` that resolves to the ALB and a matching ACM
`certificate_arn`. Use `alb_https_cert` only when bypassing CloudFront after
custom DNS and an ACM certificate are approved.
The web task receives `HASNA_UPTIME_ALLOWED_ORIGINS` for the selected public
HTTPS origin so hosted mutation CSRF checks still work through the selected
edge/origin path.

CloudFront prefix-list ingress is only a network narrowing control; it is not
bound to one distribution. Before enabling the web task, set
`enable_cloudfront_origin_verify_header = true` and provide a high-entropy
`cloudfront_origin_verify_header_value` from a private operator workflow. The
module then configures CloudFront to send that header, makes the ALB default
action return `403`, and forwards only requests with the matching header on the
selected HTTP or HTTPS origin listener.
Because the value is stored in Terraform state and AWS edge/origin
configuration, enabling or rotating it requires `live_ops_backend_state_hardened
= true` or an explicit zero-count exception via
`allow_origin_verify_header_before_backend_state_hardened = true`. That
exception is only for reviewed setup or rotation while web desired count remains
`0`; it is not live-traffic readiness.
Terraform marks the value sensitive, but it still lives in encrypted Terraform
state and in CloudFront/ALB configuration; restrict state, saved plan,
CloudFront distribution-read, and ELB listener-rule-read access accordingly.
For shared deployment evidence, prefer the non-secret outputs
`cloudfront_distribution_id`, `cloudfront_origin_protocol_policy`,
`cloudfront_origin_domain_name`, `cloudfront_origin_verify_header_enabled`,
`cloudfront_origin_verify_header_name`, `alb_listener_arns`,
`alb_security_group_id`, and `web_target_group_arn`. Do not paste CloudFront
distribution list/config responses or unfiltered listener-rule conditions into
shared logs because those APIs can include the origin verification header value.
Outputs such as `secret_refs` and `kms_key_arn` are marked sensitive; use them
only in private operator terminals and do not paste their values into shared
evidence.

All module resources carry owner, project, environment, service, account, app
type, and cost-center tags. ECS services enable AWS-managed tags and propagate
service tags to launched tasks. Any one-off `run-task` smoke must pass the same
tag set explicitly because it is outside service propagation. Set
`monthly_budget_limit_usd` plus `budget_alert_email_addresses` in the approved
infra root to create AWS Budgets forecasted and actual spend alerts. Leaving the
email list empty skips budget creation and is not sufficient for live scale-out
approval.

Private AWS API egress can be pinned through opt-in VPC endpoints by setting
`enable_private_vpc_endpoints = true` and passing `private_route_table_ids`.
This creates interface endpoints for ECR API, ECR Docker, CloudWatch Logs, and
Secrets Manager, plus an S3 gateway endpoint when route tables are supplied. The
default is `false` so package consumers do not create endpoint hourly cost
without explicit infra-owner approval. The S3 gateway endpoint is required for
private ECR image layer pulls; the module adds S3 managed-prefix-list egress for
web and non-public worker security groups when the gateway endpoint is enabled.
Endpoint policies are scoped to the Open Uptime repository, log groups,
configured secret refs, KMS key, evidence bucket, and the regional ECR layer
bucket. By default those endpoint policies also restrict callers to the module
created Open Uptime roles: ECR, logs, Secrets Manager, and SSM use the ECS
execution role; STS and KMS use the execution role plus task roles; S3 evidence
uses task roles; and the S3 gateway endpoint uses `aws:PrincipalArn` conditions
because S3 gateway endpoint principal restriction cannot be expressed by
replacing `Principal = "*"`.

In a shared VPC, `additional_vpc_endpoint_source_security_group_ids` only opens
the network path. Use the service-keyed
`additional_vpc_endpoint_principal_arns` object only for reviewed non-Open
Uptime IAM principals that must use an exact endpoint policy path, such as
`ecr`, `logs`, `secret_read`, `sts`, `kms`, or `s3_evidence`. Adding a principal
to `secret_read`, `kms`, or `s3_evidence` expands access to secret-bearing or
runtime-evidence paths at the endpoint-policy layer and must have separate
operator approval plus identity/resource-policy evidence.

If private endpoints are not approved yet, infra owners can instead set
`enable_nat_task_egress = true` to allow web and non-public worker task security
groups to reach AWS public APIs through the private subnet NAT route on TCP/443.
Keep this disabled when private endpoints are the approved egress path. Runtime
scale-up still requires ECS task evidence for image pull, secret injection, log
delivery, S3 access, and EFS mount behavior.

The AWS Backup vault lock is intentionally opt-in. Leave
`backup_vault_lock_mode = "disabled"` until the infra owner approves the
retention policy and records review evidence. Use
`backup_vault_lock_mode = "governance"` for a removable privileged-operator
rollout; it omits `backup_vault_lock_changeable_for_days`. Use
`backup_vault_lock_mode = "compliance"` only after explicit approval; it
requires `backup_vault_lock_changeable_for_days` and becomes immutable after the
grace period expires. The module validates that `backup_retention_days` fits
inside the configured minimum and maximum lock retention window before enabling
the lock.

Every ECS task definition includes an explicit container health check. The web
task checks `GET /health` through Bun's built-in `fetch`; disabled non-web roles
run `uptimemon cloud workers preflight --role <role> --healthcheck`, which verifies
hosted mode, component identity, and workspace env before reporting blocked
cloud prerequisites. Their main container commands call fail-closed
`uptimemon cloud workers run --role <role>` entrypoints so scheduler,
public-probe, reporter, and migration tasks no longer use `cloud plan` as a
placeholder.

Worker runtime alarms are defined as a default-off contract. Keep
`enable_worker_runtime_alarms = false` until every worker emits the matching
custom metrics, `worker_runtime_metric_producers_ready = true`,
`live_ops_human_alert_delivery_ready = true`, and `alarm_actions` contains an
approved human/on-call destination. Alarm dimensions intentionally avoid raw
workspace ids and use only `Service`, `Stage`, and `Role`.
The public package includes SDK helpers and opt-in EMF review telemetry for the
bounded Postgres scheduler and public-probe commands, but this is not enough to
enable the alarms. Reporter metrics, human/on-call delivery, and alarm-state
readback must also be proven first.

| Alarm key | Metric | Role | Statistic | Period | Missing data |
| --- | --- | --- | --- | --- | --- |
| `scheduler_backlog` | `SchedulerBacklog` | scheduler | Maximum | 300s | notBreaching |
| `scheduler_stale_leases` | `SchedulerStaleLeases` | scheduler | Maximum | 300s | notBreaching |
| `scheduler_heartbeat_age` | `WorkerHeartbeatAgeSeconds` | scheduler | Maximum | 60s | breaching |
| `public_probe_backlog` | `ProbeJobBacklog` | public-probe | Maximum | 300s | notBreaching |
| `public_probe_submission_failures` | `ProbeSubmissionFailures` | public-probe | Sum | 300s | notBreaching |
| `public_probe_heartbeat_age` | `WorkerHeartbeatAgeSeconds` | public-probe | Maximum | 60s | breaching |
| `reporter_lag` | `ReporterLagSeconds` | reporter | Maximum | 300s | notBreaching |
| `reporter_failed_deliveries` | `ReportDeliveryFailures` | reporter | Sum | 300s | notBreaching |
| `reporter_retry_exhausted` | `ReportDeliveryRetryExhausted` | reporter | Sum | 300s | notBreaching |
| `reporter_heartbeat_age` | `WorkerHeartbeatAgeSeconds` | reporter | Maximum | 60s | breaching |

Interface endpoint private DNS is VPC-wide. In shared VPCs, either keep endpoint
creation in the approved networking root, or pass
`additional_vpc_endpoint_source_security_group_ids` for every workload that must
keep using those private DNS names and
the matching service key in `additional_vpc_endpoint_principal_arns` for every
reviewed IAM principal that must pass endpoint policy evaluation. Do not use
wildcard principals for Secrets Manager, SSM, or KMS endpoints that can reach
hosted token or reporting channel material. If any ECS secret ref uses SSM
Parameter Store instead of Secrets Manager, add `ssm` to
`interface_vpc_endpoint_services` or keep an approved non-endpoint egress path.

## Current Blockers

- Hosted production auth/RBAC still needs scoped, revocable credentials.
- Backup Vault Lock remains disabled until an approved retention window and lock
  mode are recorded and applied through `backup_vault_lock_mode`.
- The default `http-only` CloudFront origin bridge must be replaced with the
  explicit HTTPS-origin mode or consciously accepted with documented risk before
  token-bearing live traffic. The module blocks `desired_counts.web > 0` in
  CloudFront mode unless origin verification is enabled, and it also requires
  either `cloudfront_origin_protocol_policy = "https-only"` or explicit
  `allow_cloudfront_http_origin_live_traffic = true` risk acceptance for bounded
  smokes.
- Public probe runtime has SDK-level hosted HTTP target-policy enforcement, but
  the public-probe cloud check-job lease path is still disabled until it is
  wired to that runner and validated in AWS. The
  `uptimemon cloud public-checks worker` command is an EFS SQLite bridge smoke loop,
  not the final cloud worker protocol.
- Hosted private-probe enrollment/heartbeat/revocation is still
  fail-closed.

Keep `desired_count` at `0`, or at `1` for the protected web bridge only after
review evidence exists, until those blockers are closed.
