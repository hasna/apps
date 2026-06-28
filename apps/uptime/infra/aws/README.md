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

The default protected access mode is `cloudfront_default_domain`: CloudFront
serves HTTPS on its default domain while the ALB origin accepts HTTP only from
AWS's CloudFront origin-facing managed prefix list. Use `alb_https_cert` only
after custom DNS and an ACM certificate are approved.
The web task receives `HASNA_UPTIME_ALLOWED_ORIGINS` for the selected public
HTTPS origin so hosted mutation CSRF checks still work through the private HTTP
origin hop.

CloudFront prefix-list ingress is only a network narrowing control; it is not
bound to one distribution. Add CloudFront VPC origin/private ALB routing or an
ALB origin-header rule with the secret value managed outside Terraform state
before enabling the web task.

All module resources carry owner, project, environment, service, account, app
type, and cost-center tags. Set `monthly_budget_limit_usd` plus
`budget_alert_email_addresses` in the approved infra root to create AWS Budgets
forecasted and actual spend alerts. Leaving the email list empty skips budget
creation and is not sufficient for live scale-out approval.

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

Interface endpoint private DNS is VPC-wide. In shared VPCs, either keep endpoint
creation in the approved networking root, or pass
`additional_vpc_endpoint_source_security_group_ids` for every workload that must
keep using those private DNS names. If any ECS secret ref uses SSM Parameter
Store instead of Secrets Manager, add `ssm` to
`interface_vpc_endpoint_services` or keep an approved non-endpoint egress path.

## Current Blockers

- Hosted production auth/RBAC still needs scoped, revocable credentials.
- Public probe runtime has SDK-level hosted HTTP target-policy enforcement, but
  the public-probe worker and cloud check-job lease path are still disabled until
  they are wired to that runner and validated in AWS.
- Hosted private-probe enrollment/heartbeat/revocation is still
  fail-closed.

Keep `desired_count` at `0`, or at `1` for the protected web bridge only after
review evidence exists, until those blockers are closed.
