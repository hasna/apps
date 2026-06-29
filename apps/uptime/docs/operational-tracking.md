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

## Status Vocabulary

Use these terms in public docs, project summaries, and sanitized deployment
evidence:

- **Public package released** means an npm package, git tag, and GitHub release
  exist for the version. It does not mean cloud runtime is live.
- **Private image refresh** means an approved private infra root built and
  pinned an immutable image for the package version. It is private evidence and
  must not expose account ids, image digests, hostnames, secret refs, or URLs in
  public docs.
- **Zero-count deployed** means Terraform has applied metadata, task
  definitions, or image references while every ECS desired count remains `0`.
  It is not user-visible service availability.
- **Live scale-out ready** means the protected web/API service may scale above
  `0` only after auth, edge/origin, alarms, rollback, human alert, backup, and
  evidence-retention gates pass.
- **Cloud-primary** means cloud-backed state is authoritative for the listed
  workflow. Local SQLite, project databases, notes, todos, conversations, and
  probe files are still caches or development inputs until each service passes
  its own cloud-primary migration and lease checks.

For the 2026-06-29 hosted deployment track, published public package versions
remain release and zero-count deployment evidence only after the matching
private deployment metadata records that result. Version `0.1.58` is published
and zero-count refreshed with shared edge-smoke evidence redacted by default,
but it is still not live runtime evidence. Hosted reporter, protected web/API
scale-out, and cloud-primary promotion remain blocked until the hard hosted gate
below is satisfied.

## 0.1.58 Runtime Readiness Snapshot

| Area | Current evidence | Status |
| --- | --- | --- |
| Reporter | Channel-ref shape validation and Postgres report metadata helpers exist. | Blocked on server-side secret loading, S3 artifact writes/signing, Open Logs audit export, delivery alarms, and live liveness/drain evidence. |
| Scheduler | Bounded Postgres scheduler review batches can create public-safe deterministic `check_jobs`. | Blocked on hosted service/API integration, lease ownership, deploy drain, metrics, alarms, and live RLS evidence. |
| Public probe | Bounded Postgres public-probe review batches can claim, execute, and submit existing public-safe jobs. | Blocked on hosted worker promotion gates, denied-target AWS smokes, backlog metrics, and rollback evidence. |
| Worker alarms | Terraform alarm contracts exist and are default-off. | Blocked until metric producers, approved alarm actions, and human/on-call delivery smoke are proven. |
| Human alert delivery | Internal audit queue and budget notification wiring may be private evidence. | Blocked until approved human/on-call subscriptions and a non-secret delivery smoke are recorded. |
| Logs and audit | CloudWatch log groups and one-off version smoke evidence exist. | Zero-count evidence only; no live scheduler/public-probe/reporter log streams or Open Logs audit export. |
| Backup | EFS SQLite bridge backup and restore drill evidence exists. | Zero-count evidence only; repeat after sustained live writes and treat Postgres/RDS PITR separately. |

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
  identity and lease fencing exist in `0.1.33`, and `0.1.42` adds a bounded
  Postgres runtime facade for deterministic job creation, due discovery,
  claim/fencing/completion, probe submission replay protection, audit rows, and
  tombstones. `0.1.43` adds a bounded Postgres public-probe review batch runner
  over existing `check_jobs` with immutable monitor snapshots and fenced
  cancellation of stale or unsupported jobs. `0.1.44` adds a bounded Postgres
  scheduler review runner that creates deterministic public-safe check jobs.
  Hosted cloud workers still need `UptimeService`/API integration, scheduler
  lease ownership, deploy drain,
  backlog/stale-lease metrics, live RLS verification, and alarms before scale-up
- Postgres migration/runtime readiness: the migration runner can dry-run and
  apply the reviewed schema with TLS enforcement, explicit schema confirmation,
  transactional DDL, idempotent/forced RLS, and table/policy/index verification.
  `0.1.42` exposes `@hasna/uptime/postgres-runtime` for workspace-scoped core
  writes, `0.1.43` exposes `runPostgresPublicProbeWorker`, and `0.1.44`
  exposes `runPostgresSchedulerWorker` for bounded review batches. These are
  still not runtime promotion evidence because
  service contracts, hosted worker loops, live DB schema verification, and
  operations alarms remain blockers.
- report delivery through open-mailery/open-telephony/open-logs channel refs:
  reporter preflight validates the service-owned channel-ref catalog shape.
  Postgres report metadata helpers now cover finished report-run rows,
  delivery-attempt claim/complete state, per-attempt idempotency, retry/backoff
  metadata, and redacted artifact metadata refs under transaction-scoped
  workspace settings. Hosted delivery remains disabled until authoritative
  report run state transitions, full service-store promotion, S3 artifact writes
  and signing, audit export, alarms, and live-worker rollback evidence exist
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
