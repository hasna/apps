# Open Uptime Operational Tracking

This document describes the public operational-tracking contract for hosted Open
Uptime work. Deployment-specific goal ids, task ids, local machine names, local
workspace paths, and private cloud-account details belong in private deployment
metadata, not in this repository.

## Public Ledger

Use these repository documents as the public source for hosted design and
acceptance criteria:

- `docs/cloud-source-of-truth.md`
- `docs/aws-runtime-security.md`
- `docs/monitoring-product-contract.md`
- `docs/aws-deployment-runbook.md`

Private deployment metadata may record exact task ids, reviewer ids, AWS account
ids, backend state keys, and machine-local paths. Keep that metadata outside the
package and outside public docs.

## Cloud-Primary Status

Local CLI records and local project databases are not cloud authority. Hosted
Open Uptime must treat cloud-backed state as authoritative only after the cloud
store, auth, leases, and probe enrollment gates pass.

Known public blockers:

- Projects, knowledge, notes, mementos, and todos may still be local-first in a
  development environment.
- The first AWS bridge uses explicit EFS-backed SQLite for a single protected web
  task. The target cloud-primary store is still Postgres plus object storage.
- Private probe operator machines are not cloud-primary by local filesystem
  status. Any primary/operator status must be represented as a time-limited
  cloud lease.

## Hard Hosted Gate

Do not expose hosted dashboard, API, MCP, report delivery, JSON Render/canvas
specs, artifacts, browser evidence, or check execution until these are tested:

- hosted auth/RBAC and workspace scoping
- explicit EFS-backed hosted SQLite for the first deploy, followed by Postgres
  persistence with migrations, tombstones, audit, and no hidden local fallback
- shared target policy with SSRF protections
- scheduler `check_jobs` and probe lease fencing: local deterministic job
  identity and lease fencing exist in `0.1.33`; hosted cloud workers still need
  the async cloud store, deploy drain, backlog/stale-lease metrics, and RLS/audit
  runtime before scale-up
- report delivery through open-mailery/open-telephony/open-logs channel refs:
  reporter preflight validates the service-owned channel-ref catalog shape, but
  hosted delivery remains disabled until Postgres, idempotent report runs,
  retry/backoff, artifacts, audit export, and delivery alarms exist
- JSON Render and canvas redaction
- browser evidence isolation
- private probe identity, revocation, and isolation
- AWS IAM/RDS/S3/ALB/ECS runtime boundaries
- Apache-2.0 OSS release readiness
- independent adversarial review lanes

## Idempotency Keys

Use stable idempotency keys for delegated or replayable work:

- `open-uptime:hosted-exposure-guard:v1`
- `open-uptime:hosted-auth-rbac:v1`
- `open-uptime:target-policy:v1`
- `open-uptime:postgres-cloud-store:v1`
- `open-uptime:check-jobs-probe-lease:v1`
- `open-uptime:monitor-schemas:v1`
- `open-uptime:inventory-import:v1`
- `open-uptime:incident-workflow:v1`
- `open-uptime:report-delivery:v1`
- `open-uptime:json-render-canvases:v1`
- `open-uptime:aws-runtime:v1`
- `open-uptime:private-probe:v1`
- `open-uptime:release-validation:v1`

## Validation Commands

Use these baseline checks before resuming implementation:

```bash
git status --short
bun run build
bun run typecheck
bun test
terraform -chdir=infra/aws fmt -check -recursive
terraform -chdir=infra/aws validate
uptime --version
```

AWS plan, apply, and smoke tests should run only from an approved private
deployment root or infrastructure repository with remote state, locking, reviewed
KMS/secrets, approved human/on-call alert subscriptions, rollback instructions,
and no plaintext secret values in Terraform state.
