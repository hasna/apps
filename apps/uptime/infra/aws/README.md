# Open Uptime AWS Infra

This directory is a reviewable Terraform/OpenTofu starting point for deploying
Open Uptime in the `hasna-xyz-infra` AWS account. It is intentionally
plan-first. Do not apply it directly from this app repo unless the infrastructure
owner has approved this directory as the source of truth or has copied it into
the approved infra repository.

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

## Current Blockers

- Hosted Postgres adapter and migrations are not implemented in the app yet.
- Hosted production auth/RBAC still needs scoped, revocable credentials.
- Public probe runtime still needs execution-time DNS/redirect/rebinding SSRF
  enforcement.
- Spark01 hosted private-probe enrollment/heartbeat/revocation is still
  fail-closed.

Keep `desired_count` at `0` or plan-only until those blockers are closed.
