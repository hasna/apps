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
private deployment metadata records that result. Version `0.1.67` is prepared
with shared-evidence sanitizer support, hosted reporter artifact/audit callback
contracts, AWS-shaped origin-header value sanitization, and an explicit
zero-count exception gate for pre-hardening origin-header setup or rotation.
It also packages the public operational docs and adds a redacted reporter
promotion-evidence contract for object-store, Open Logs audit-export, delivery
alarm, and liveness evidence. Promotion evidence must include a safe workspace
id that matches the active workspace before any individual reporter promotion
check can pass. `0.1.67` also includes the bounded hosted Postgres monitor API
adapter for `/api/v1/summary` and `/api/v1/monitors*`, including monitor-list
offset paging, expected-revision PATCH guards, and audit-key PATCH replay;
non-migrated hosted reads stay blocked rather than falling back to SQLite.
Version `0.1.68` adds the bounded hosted Postgres report-control-plane adapter
for report schedule metadata, report-run reads, and report audit reads. It
requires explicit approved `channelRefIds`, stores schedule mutation audit
provenance atomically, redacts artifact/audit API output, and keeps hosted
report execution routes fail-closed. The prior zero-count deployment path
remains not live runtime evidence until private deployment metadata records the
matching image refresh.
Version `0.1.69` adds a bounded hosted Postgres probe API adapter for
admin-scoped probe enrollment, probe-id-bound check-job claims, and signed
result submission with mutation/audit helpers. It keeps probe listing, API job
creation, heartbeat, revocation, rotation, worker startup, private target seed
policy, and live private-probe promotion blocked.
Hosted reporter,
protected web/API scale-out, private probes, and cloud-primary promotion remain
blocked until the hard hosted gate below is satisfied.

## 0.1.69 Runtime Readiness Snapshot

| Area | Current evidence | Status |
| --- | --- | --- |
| Shared evidence | SDK/CLI sanitizer can redact raw AWS identifiers, CloudFront/ALB hosts, private URLs, Terraform artifacts, image digests, local paths, recipients, database URLs, tokens, and unsafe object keys before evidence is copied into shared docs or project metadata. | Sanitized evidence is not live readiness; protected web, workers, reports, private probes, and cloud-primary gates still need runtime proof. |
| Protected access | Origin-header setup or rotation now requires `live_ops_backend_state_hardened=true` or an explicit zero-count exception, and AWS-shaped CloudFront/ALB header-value evidence fields are treated as secret-bearing. | This does not solve HTTPS-origin DNS/ACM, auth/RBAC, public edge promotion smoke, direct-origin proof, human alert delivery, or live scale-out. |
| Target policy | Hosted API/import paths, worker review paths, and direct Postgres monitor upserts reject unsafe public-hosted targets before execution or storage; enabled browser-page rows remain blocked. | Still blocked on approved private inventory refs, live denied-target AWS smokes, browser evidence isolation, and full hosted service adapter wiring. |
| Hosted monitor API | An explicit API adapter can route `/api/v1/summary` and `/api/v1/monitors*` to Postgres monitor rows with workspace scoping, actor/origin/idempotency metadata, offset paging, audit-key PATCH replay, expected-revision update guards, audit rows, and tombstones, while ignoring raw status/last-check body fields. | Bounded control-plane plumbing only; `uptimemon serve`, reports, incidents, results, imports, probes, scheduler loops, reporter delivery, and worker promotion are still blocked until each has authoritative Postgres storage and live evidence. |
| Reporter | Channel-ref shape validation, a bounded hosted report-control-plane adapter, Postgres report metadata helpers, callback contracts for redacted artifact object writes plus Open Logs audit export payloads, and workspace-bound `HASNA_UPTIME_REPORTER_PROMOTION_EVIDENCE_JSON` for redacted operator evidence exist. | Evidence JSON can prove individual report promotion checks only after private smoke/review evidence exists and names the active workspace. Startup still blocks on server-side secret loading, service-store integration, worker lease ownership, deploy drain, and cloud-worker readiness. |
| Scheduler | Bounded Postgres scheduler review batches can create public-safe deterministic `check_jobs`. | Blocked on hosted service/API integration, lease ownership, deploy drain, metrics, alarms, and live RLS evidence. |
| Public probe | Bounded Postgres public-probe review batches can claim, execute, and submit existing public-safe jobs. | Blocked on hosted worker promotion gates, denied-target AWS smokes, backlog metrics, and rollback evidence. |
| Private probe | Bounded hosted Postgres probe API wiring can enroll identities with admin scope, claim existing jobs only with a token bound to the same `probeId`, verify signed submissions, write mutation audit through runtime helpers, and avoid returning raw public keys. Read-only private probe preflight can still inspect identity bindings and private-job counters. | Blocked on hosted probe listing, API job creation, heartbeat, revocation, rotation, approved inventory refs, target seed policy, alarms, deploy drain, and live evidence. |
| Worker alarms | Terraform alarm contracts exist and are default-off. | Blocked until metric producers, approved alarm actions, and human/on-call delivery smoke are proven. |
| Human alert delivery | Internal audit queue and budget notification wiring may be private evidence. | Blocked until approved human/on-call subscriptions and a non-secret delivery smoke are recorded. |
| Logs and audit | CloudWatch log groups, one-off version smoke evidence, and a sanitizer-safe Open Logs audit export callback contract exist. | Zero-count evidence only; no live scheduler/public-probe/reporter log streams or approved Open Logs audit export wiring/smoke evidence. |
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
uptimemon --version
```

AWS plan, apply, and smoke tests should run only from an approved private
deployment root or infrastructure repository with remote state, locking, reviewed
KMS/secrets, approved human/on-call alert subscriptions, rollback instructions,
and no plaintext secret values in Terraform state.
