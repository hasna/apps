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
bucket.

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
run `uptime cloud workers preflight --role <role> --healthcheck`, which verifies
hosted mode, component identity, and workspace env before reporting blocked
cloud prerequisites. Their main container commands call fail-closed
`uptime cloud workers run --role <role>` entrypoints so scheduler,
public-probe, reporter, and migration tasks no longer use `cloud plan` as a
placeholder.

Interface endpoint private DNS is VPC-wide. In shared VPCs, either keep endpoint
creation in the approved networking root, or pass
`additional_vpc_endpoint_source_security_group_ids` for every workload that must
keep using those private DNS names. If any ECS secret ref uses SSM Parameter
Store instead of Secrets Manager, add `ssm` to
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
  `uptime cloud public-checks worker` command is an EFS SQLite bridge smoke loop,
  not the final cloud worker protocol.
- Hosted private-probe enrollment/heartbeat/revocation is still
  fail-closed.

Keep `desired_count` at `0`, or at `1` for the protected web bridge only after
review evidence exists, until those blockers are closed.
