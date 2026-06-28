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

## Current Blockers

- Hosted production auth/RBAC still needs scoped, revocable credentials.
- Public probe runtime has SDK-level hosted HTTP target-policy enforcement, but
  the public-probe worker and cloud check-job lease path are still disabled until
  they are wired to that runner and validated in AWS.
- Hosted private-probe enrollment/heartbeat/revocation is still
  fail-closed.

Keep `desired_count` at `0`, or at `1` for the protected web bridge only after
review evidence exists, until those blockers are closed.
