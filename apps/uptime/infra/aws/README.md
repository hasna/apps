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

## Current Blockers

- Hosted production auth/RBAC still needs scoped, revocable credentials.
- Public probe runtime still needs execution-time DNS/redirect/rebinding SSRF
  enforcement.
- Spark01 hosted private-probe enrollment/heartbeat/revocation is still
  fail-closed.

Keep `desired_count` at `0`, or at `1` for the protected web bridge only after
review evidence exists, until those blockers are closed.
