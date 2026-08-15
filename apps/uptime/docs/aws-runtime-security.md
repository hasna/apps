# AWS Runtime And Security

This document defines the target AWS architecture for running Open Uptime as an
internal cloud service in a reviewed AWS account. It is a design contract for
later infrastructure and deployment implementation work; it does not mean Open
Uptime is safe to expose today.

Current deployment bridge as of 2026-06-28: the repo Terraform includes an
EFS-backed SQLite runtime path (`HASNA_UPTIME_HOSTED_SQLITE_DB`) with an EFS
access point and AWS Backup so exactly one protected web task can start without
the future async Postgres adapter. Scheduler, public-probe, reporter, and
migration workers must stay at desired count `0` and do not receive EFS mounts
or EFS write IAM in this bridge. The Postgres/RDS sections below remain
target-state security requirements for the eventual cloud source of truth.

## Current Account State

Private target-account inventory belongs in private deployment evidence, not in
the OSS repository. Before live deployment, record:

- selected AWS account/profile and region;
- target VPC, public ALB subnets, private task subnets, KMS key, protected edge
  mode, and, when using a custom hostname, Route53/edge ownership plus ACM
  certificate;
- whether an approved application Postgres exists for the future target state;
- whether Open Uptime already has service-specific ECR, ECS, ALB, DNS, secrets,
  alarms, backup policy, and evidence bucket resources.

The implementation phase must locate/check out the approved infrastructure
repository or create the infra change in the correct owner repository before
touching live AWS resources.

## Architecture Decision

Use ECS Fargate with ALB and S3. The first deployable runtime may use
EFS-backed SQLite with AWS Backup for a single web writer while scheduler,
public probe, reporter, and migration workers remain disabled. The target cloud
source of truth is Postgres; browser evidence and generated report artifacts
live in hardened S3.

App Runner is not the first choice because Open Uptime needs explicit VPC
placement, private RDS access, separated worker roles, private probe ingestion,
egress controls, and future VPC endpoints. Lambda is not the first choice
because the scheduler/probe model is stateful enough to benefit from long-lived
workers and cloud leases.

## Runtime Components

Deploy separate ECS/Fargate services or task roles:

- `open-uptime-web`: dashboard, API, JSON Render endpoints, canvas endpoints,
  report preview, import preview/apply, and health endpoint.
- `open-uptime-scheduler`: creates deterministic `check_jobs`, reconciles
  incidents, schedules reports, and holds the scheduler lease.
- `open-uptime-public-probe`: claims public check jobs, runs HTTP/DNS/TLS/domain
  and browser checks, writes results, and uploads redacted evidence.
- `open-uptime-reporter`: generates scheduled report artifacts, performs
  idempotent delivery attempts through authorized channel refs, and owns report
  retry/backoff state. This can share code with the scheduler, but it needs its
  own IAM scope and alarms.
- `open-uptime-migration`: one-off task for schema migrations and controlled
  backfills.
- `open-uptime-private-probe`: not an AWS public service by default. Approved
  private machines run signed probe agents that submit results to
  the hosted API.

Each role gets a separate task role and least-privilege policy. The web task
must not be the component that performs arbitrary target checks.

Hosted web can enqueue, preview, or approve authorized work, but it cannot run
checks inline. The existing local `/api/check-all`, `/api/monitors/:id/check`,
and `serve --check` behavior must either remain local-only or become cloud
enqueue operations. Scheduler creates jobs; probes claim jobs with TTL/fencing
tokens; result ingest requires the active fencing token and idempotency key.

## Probe Locations And Down Semantics

Initial public probe location is `us-east-1`. The data model and APIs must still
support multiple locations so later probes can be added without rewriting
monitor semantics.

Each monitor defines:

- allowed probe classes: public, private, or both;
- allowed probe locations or inventory-linked private probes;
- interval and retry limits;
- quorum policy for multi-probe checks;
- down policy: for example one location after final retry, N-of-M locations, or
  private-probe authoritative;
- stale-result policy so old probe output cannot reopen or close incidents.

The first implementation can run one public location, but it must record
`probe_id`, `probe_location`, `probe_class`, `monitor_version`, and
`schedule_slot` on every result. Future regional probes must not change result
identity or SLA calculations.

## Network Layout

Target shape inside the approved VPC:

- public subnets: ALB and NAT gateways only;
- new private application subnets: web, scheduler, migration tasks;
- controlled egress subnets: public probe workers, routed through NAT or another
  explicitly inspected egress path;
- RDS access stays private and restricted by security groups;
- VPC endpoints should be used for S3, Secrets Manager, CloudWatch Logs, ECR,
  and SSM where practical. Interface endpoint private DNS is VPC-wide, so shared
  VPC deployments must either use the approved networking root or explicitly
  allow every affected source security group and IAM principal. Endpoint
  policies for Secrets Manager, SSM, and KMS must not use wildcard principals
  when they can reach hosted-token, reporting-channel, or other secret-bearing
  material. Any extra shared-VPC IAM principal must be granted per endpoint
  purpose, not through a single catch-all list, and S3 gateway endpoint principal
  restrictions must use `aws:PrincipalArn` conditions.

Security groups:

- `open-uptime-alb-sg`: in `cloudfront_default_domain` mode, inbound origin
  traffic is limited to AWS's CloudFront origin-facing managed prefix list on
  `80` for the temporary HTTP bridge or `443` when
  `cloudfront_origin_protocol_policy = "https-only"`; in `alb_https_cert` mode,
  inbound `443` is limited to the approved edge/source CIDR policy. Outbound is
  only to the web target group.
- `open-uptime-web-sg`: inbound only from ALB, outbound to RDS, S3 endpoint,
  Secrets Manager, Logs, and internal service endpoints.
- `open-uptime-scheduler-sg`: no inbound, outbound to RDS, Logs, Secrets
  Manager, and notification services through approved endpoints.
- `open-uptime-public-probe-sg`: no inbound, outbound through the public target
  policy path once public probe execution is enabled. Keep desired count `0`
  until the public-probe worker claims cloud jobs through the hosted HTTP runner,
  emits target-policy evidence, and has AWS smoke evidence.
- `open-uptime-rds-client-sg`: allowed by the canonical RDS security group for
  the dedicated Uptime DB user.

Private monitors must not run from public probe workers. They run from approved
private probes and are created only from approved inventory refs.

## Web Exposure And Auth

The expected hostname is an approved internal hostname such as
`uptime.example.com`; the final hosted zone and record must be selected in the
infra PR.

Public web exposure requires defense in depth:

- first zero-count deployment may terminate viewer TLS at CloudFront's default
  HTTPS domain, restrict ALB origin ingress to CloudFront origin-facing ranges,
  and require the module's CloudFront-only origin verification header at the ALB
  listener;
- token-bearing live traffic should use CloudFront HTTPS-origin mode by setting
  `cloudfront_origin_protocol_policy = "https-only"`, a dedicated
  `cloudfront_origin_domain_name` that resolves to the ALB, and a matching ACM
  `certificate_arn`. CloudFront validates the custom-origin certificate against
  the origin hostname, so the ALB DNS name is not enough for this mode;
- CloudFront prefix-list ingress is not distribution-bound by itself. In
  `cloudfront_default_domain` mode, set
  `enable_cloudfront_origin_verify_header = true` and provide a high-entropy
  `cloudfront_origin_verify_header_value` from an approved private operator
  workflow before setting web desired count above `0`. Terraform treats the
  value as sensitive, but the value is still persisted in encrypted Terraform
  state and in AWS CloudFront/ALB configuration readable by principals with
  distribution or listener-rule read access;
- custom hostname deployment terminates TLS with ACM on ALB or CloudFront after
  Route53/edge ownership is approved;
- edge access can be Cloudflare Access, OIDC, Cognito, or another
  organization-approved identity layer;
- hosted web tasks must set `HASNA_UPTIME_ALLOWED_ORIGINS` to the public HTTPS
  edge origin so browser mutation checks do not compare CloudFront HTTPS origins
  against the ALB origin hostname;
- Open Uptime still enforces scoped hosted static-token auth and workspace
  checks on hosted API routes except `/health`; this is an operator-smoke bridge
  and not final production identity/RBAC;
- `/health` returns only service liveness and no monitor data;
- `/ready` is authenticated in hosted mode and must return `productionReady=true`
  before protected web promotion evidence is accepted;
- all dashboard, API, MCP-over-HTTP, JSON Render, canvas, import, report, and
  artifact endpoints require actor, workspace, and scope.

Do not rely on a single shared `HASNA_UPTIME_API_TOKEN` for hosted mode. That
token style can remain a local/trusted automation compatibility mode only.

Minimum route-to-scope matrix:

| Surface | Routes | Required scope |
| --- | --- | --- |
| Health | `GET /health` | none |
| Dashboard | `GET /`, static assets | `uptime:read` |
| Summary/read API | `GET /api/summary`, `/api/monitors`, `/api/incidents`, `/api/results`, `/api/report` | `uptime:read` |
| Monitor writes | monitor create/update/delete/pause/resume, import apply | `uptime:write` |
| Check enqueue | check all, check one, schedule preview | `uptime:write` or `uptime:probe:enqueue` |
| Probe ingest | claim job, heartbeat, submit result, upload evidence ref | `uptime:probe` |
| Reports | preview, schedule, run, delivery retry | `uptime:report` |
| Admin | migrations, rollback, token rotation, probe revocation | `uptime:admin` |
| JSON Render/canvas | render specs, canvases, nodes, edges | `uptime:read` plus project/canvas authorization |
| Artifacts | signed URL creation and metadata | `uptime:read` plus artifact policy |

Hosted tests must prove unauthenticated dashboard/API reads return 401, wrong
scope returns 403, and cross-workspace requests cannot read, mutate, enqueue,
ingest, report, render, or access artifacts.

## Persistence

Postgres:

- choose one exact shape in the infra PR: preferably a dedicated `uptime`
  database on the approved application Postgres instance; a dedicated schema in
  an approved database is acceptable only if ownership, backups, and role grants
  are explicit;
- use separate least-privileged roles/users: `uptime_migrator`, `uptime_web`,
  `uptime_scheduler`, `uptime_probe`, and `uptime_reporter` or read/report role;
- runtime roles must not have DDL privileges;
- migration role is manually invoked, time-limited, and not attached to the
  normal web/scheduler/probe services;
- require TLS;
- run migrations before web/scheduler/probe rollout;
- include `workspace_id`, `version`, `deleted_at`, audit/idempotency fields, and
  optimistic concurrency on mutable tables;
- include `report_delivery_attempts` for channel-ref delivery retries and
  provider idempotency keys, and `report_artifacts` for redacted artifact
  metadata pointing at S3/object storage rather than raw report bytes;
- enable automated backups and PITR on the RDS instance;
- take pre-cutover snapshots before migration or destructive schema changes;
- block destructive migrations unless backup and rollback checks pass.

S3:

- create a dedicated evidence/artifact bucket or scoped prefix;
- enable KMS encryption, versioning, lifecycle/retention, and public access
  block;
- deny explicit non-KMS object uploads and object uploads that specify a KMS key
  other than the configured Open Uptime key; clients that omit SSE headers still
  use the bucket default KMS encryption;
- store browser screenshots, traces, network evidence, generated report HTML,
  generated report JSON, and import/export artifacts only after redaction;
- access artifacts through short-lived signed URLs with workspace authorization
  and audit logging.

AWS Backup:

- keep the EFS backup plan retention aligned with the approved retention policy;
- enable AWS Backup Vault Lock only through Terraform after account-owner
  approval;
- use `backup_vault_lock_mode = "governance"` for the first removable rollout;
- use `backup_vault_lock_mode = "compliance"` with a non-null
  `backup_vault_lock_changeable_for_days` grace period only after irreversible
  compliance-mode behavior is explicitly approved;
- rerun the backup readiness audit and record sanitized evidence before
  considering `live_ops_backup_restore_ready` true.

Target state: no hosted runtime writes authoritative state to EFS or local task
storage. Current bridge exception: one web task may write the explicit
`/data/uptime/uptime.db` EFS-backed SQLite file until the async Postgres adapter
and cloud leases exist. Ephemeral task storage is for temporary files only.
The Terraform module blocks `web` scale-up unless protected-access gates and
explicit live-ops readiness booleans for backend state, human alert delivery,
backup/restore, and evidence retention are all set for the reviewed deployment.

Project stores:

- project canvases, JSON Render specs, loop refs, handoffs, and linked service
  refs must be in cloud-backed project stores before hosted canvases are
  declared cloud-primary;
- local `$HASNA_PROJECTS_HOME/data/<workspace_id>/project.db` and older `by-id`
  paths are cache/import sources only;
- hosted render payloads must not include raw local paths or secrets.

## Secrets And IAM

Secrets are referenced, not copied.

Expected secret-ref classes:

- app environment descriptor;
- hosted token descriptor;
- public probe descriptor;
- private probe descriptor;
- reporting channel catalog;
- service-owned Mailery, Telephony, Logs, Projects, Todos, Knowledge, Notes,
  Mementos, Servers, Domains, and Deployment refs as needed.

Public/shared evidence should name these classes only. Exact AWS Secrets Manager
or SSM paths belong in private Terraform state and private deployment metadata.

ECS task definitions must use Secrets Manager or SSM `valueFrom` entries for
secret-bearing values. They must not inline plaintext secret values in
environment arrays. Cloud records store channel ids, secret refs, and redacted
metadata only.

IAM split:

- execution role: ECR pull, log write, and ECS runtime secret retrieval needed
  to start the task;
- web role: read/write Uptime DB, read authorized secret refs, write logs,
  generate signed artifact URLs;
- scheduler role: Uptime DB, logs, reporting channel metadata, and no arbitrary
  outbound target execution permissions;
- public probe role: claim jobs, submit results, write evidence artifacts, read
  only probe-scoped secret refs;
- reporter role: read report schedules/runs, write report artifacts, resolve
  approved delivery channel refs, submit delivery attempts, and write logs;
- migration role: migrations/backfill only, time-limited and manually invoked.

Provider credentials for deployment should come from GitHub OIDC or an operator
role. Do not store AWS access keys in Open Deployment local DB rows.

## Egress And SSRF Boundaries

AWS network controls and application target policy are both required. The
current hosted API enforces configuration-time checks for direct denied hosts,
secret-bearing URLs, and private DNS suffixes. The SDK also exposes
`runHostedHttpCheck` for hosted public HTTP probes; it resolves DNS at
execution time, denies unsafe answers, pins the validated address into the
request, validates redirects, and records target-policy decisions. The bounded
`uptimemon cloud postgres-scheduler run` review command can create public-safe
Postgres `check_jobs`, and `uptimemon cloud postgres-public-probe run` can claim
existing jobs and run HTTP/TCP checks through that policy, but generic scheduler
and public-probe ECS execution remain disabled until the service/API scheduler
contracts, scheduler lease ownership, deploy drain, backlog/stale-lease alarms,
and AWS behavior are validated end to end.

The required hosted public-probe policy must deny:

- loopback, link-local, metadata endpoints, RFC1918, multicast, wildcard,
  unspecified, carrier-grade NAT, and IPv6 ULA/link-local ranges;
- DNS names that resolve to denied ranges;
- redirects to denied ranges;
- URL userinfo and secret-like query strings;
- TCP targets not approved by monitor kind and source provenance.

Public probe workers should use a restricted egress path and emit target policy
decision logs. Private targets are routed only to private probes with explicit
inventory provenance and probe authorization.

NAT strategy must be deliberate. Public probe egress may become a major fixed
cost, so the infra PR must choose between NAT gateways, VPC endpoints where
possible, or a smaller controlled-egress design, and document expected cost and
failure modes.

## Browser Worker Requirements

Browser/page checks stay disabled in hosted mode until the deployed container and
artifact pipeline satisfy this contract:

- Playwright or equivalent browser runtime is present in the probe image;
- CPU, memory, and ephemeral storage sizing are documented and load-tested;
- per-check browser contexts are isolated;
- concurrency is bounded per task and per workspace;
- browser sandboxing is enabled where compatible with Fargate, or a documented
  compensating isolation control exists;
- HAR/trace/console/network data is redacted before upload;
- screenshots support selector and region masking;
- evidence uploads fail closed if redaction, encryption, or artifact metadata
  write fails;
- retention defaults are short and tied to a cost estimate.

## Private Probe Lifecycle

Private probes are first-class cloud actors:

- enrollment creates a probe identity bound to workspace, machine id, allowed
  source inventories, capabilities, and trust class;
- credentials are scoped, rotatable, revocable, and never reused by public
  probes;
- probes heartbeat with version, capabilities, queue lag, and local clock skew;
- offline buffering is bounded and cannot submit results after lease expiry;
- upgrade policy defines minimum supported version and forced disable behavior;
- compromised-probe response revokes credentials, quarantines recent results,
  blocks further job claims, and records audit/log events.

## Observability

Minimum CloudWatch/monitoring resources:

- log groups for web, scheduler, public probe, migration, and private probe
  ingestion, with retention;
- metrics and alarms for ALB target health, ALB 5xx, API 5xx, latency, ECS task
  restarts, desired/running count drift, CPU, memory, RDS connections, RDS CPU,
  storage, S3 errors, evidence upload failures, probe heartbeat lag, check job
  backlog, result ingest failures, incident notification failures, reporter lag,
  report delivery retry exhaustion, report run failures, and migration failures;
- dashboard for current service health, queue/job backlog, probe fleet health,
  open incidents, report delivery, and deploy version;
- Open Logs integration for structured app events with no secret values;
- self-monitoring monitor definitions seeded after deployment.

Alert destinations must use service-owned channel refs, not raw webhook URLs or
request-provided credentials.

The Terraform module includes a default-off worker runtime alarm contract behind
`enable_worker_runtime_alarms`. Do not enable it as readiness evidence until the
scheduler, public-probe, and reporter workers all emit the matching custom
metrics and approved human/on-call delivery is proven. The bounded scheduler and
public-probe review commands can emit EMF for producer-contract review only; the
reporter path still needs hosted lag/delivery/retry metrics before
`worker_runtime_metric_producers_ready` can be true. The contract covers
scheduler backlog/stale leases/heartbeat age, public-probe backlog/submission
failures/heartbeat age, and reporter lag/failed deliveries/retry-exhausted
deliveries/heartbeat age.

## Backup, Restore, And Rollback

Before production cutover:

1. run migration dry-run with counts/schema versions/conflict counts only;
2. back up local `~/.hasna/uptime` data and dependent local stores;
3. take RDS snapshot or verify PITR point;
4. verify S3 versioning/lifecycle;
5. freeze legacy local writes for migrated surfaces;
6. run migration/backfill;
7. compare cloud and local read-only summaries;
8. run restore drill in a non-production target;
9. document rollback command sequence and responsible actor.

Rollback sequence:

1. pause scheduler and probe claims;
2. revoke the private probe primary/operator lease if involved;
3. make cloud writes read-only;
4. roll ECS service back to previous task definition if the app release failed;
5. restore DB or run compensating migration if the data release failed;
6. keep S3 artifacts versioned and quarantined;
7. point local CLIs back to fallback only if the cloud cutover is explicitly
   rolled back;
8. record the event in audit events, Open Logs, Projects, and Todos.

Destructive infrastructure actions require final snapshots and deletion
protection. Generic Open Deployment code that skips final snapshots is not
acceptable for Open Uptime production resources.

## Deployment Pipeline

Minimum implementation path:

1. review the repo-owned `Dockerfile` and package-image `Dockerfile.package`;
2. add the ECR repository and CodeBuild package image builder;
3. build the published npm package into ECR, verify the expected npm
   `dist.integrity` when `runtime_package_integrity` is set, install production
   dependencies with the published `bun.lock`, and record the immutable digest;
4. run typecheck, tests, package checks, and container smoke locally/CI;
5. for the EFS bridge, keep the desired count at one web task maximum and zero
   scheduler/public-probe/reporter/migration tasks;
6. deploy ECS services by digest with deployment circuit breaker enabled;
7. verify `/health`, auth-denied reads, authenticated dashboard/API mutations
   through the public edge origin, direct-origin denial, EFS backup evidence, and
   web alarms; defer probe heartbeat, check job claim, evidence upload, and
   report delivery smokes until worker roles are cloud-backed;
8. publish/update packages only after hosted smoke passes if code changed.

Open Deployment may record deployment metadata, but it must not be exposed as a
public deployment controller and must not inject plaintext secrets into task
definitions.

Before Open Deployment can drive production Uptime deploys, it must:

- persist provider deployment ids separately from local deployment row ids;
- pass `cluster/service` or task definition ids correctly for ECS status, logs,
  and rollback;
- include execution role, task role, log configuration, health check, target
  group/service networking, deployment circuit breaker, and `secrets.valueFrom`
  in ECS task definitions;
- disable destructive production helpers that skip final snapshots;
- stop storing raw production secret values in local provider/environment rows.

## Cost Controls

Every AWS resource must carry owner/project/environment/service tags. The infra
PR must include a rough monthly estimate for:

- ALB;
- ECS Fargate web task for the bridge and later scheduler/probe tasks;
- NAT gateway and/or approved private VPC endpoints for ECR, Logs, Secrets
  Manager or SSM, and S3, including runtime ECS evidence for image pull, secret
  injection, log delivery, S3 access, and EFS mount behavior;
- EFS/Backup bridge costs and later RDS incremental usage for the Uptime
  schema/database;
- S3 evidence/artifact storage and requests;
- CloudWatch logs/metrics/alarms;
- KMS requests;
- CloudFront default-domain edge costs, and Route53/ACM where applicable.

Evidence retention and browser trace capture are the primary variable costs.
Default retention must be short until usage is measured.

ECS services must enable AWS-managed tags and `propagate_tags = "SERVICE"` so
service-launched tasks retain cost allocation tags. One-off smoke tasks run
outside ECS service propagation and must pass equivalent tags explicitly in the
operator command/evidence.

The AWS Terraform starter exposes optional AWS Budgets alerts through
`monthly_budget_limit_usd` and `budget_alert_email_addresses`; the approved
infra root must set real human/on-call notification targets and prove
non-secret delivery before live scale-out. Budget alarms and alert delivery are
required before browser evidence or public probe scale-out.

## Implementation Blockers

- The approved private AWS bridge must prove zero-count runtime resources
  in private evidence before any live scale-up: ECR, dormant ECS services, ALB,
  CloudFront default-domain distribution, evidence bucket, encrypted logs,
  Backup, EFS, and service secret containers. A bridge is not live while
  services remain at desired count `0`. Private evidence must prove current
  secret versions, scoped hosted-token descriptors used only for operator
  smokes, and either the approved HTTPS-origin/custom-hostname path or explicit
  bounded HTTP-origin risk acceptance. Terraform blocks `desired_counts.web >
  0` in CloudFront mode unless origin verification is enabled and either
  HTTPS-origin mode is configured or
  `allow_cloudfront_http_origin_live_traffic = true` records explicit bounded
  smoke risk acceptance. Full production identity/RBAC is still not implemented.
- Open Uptime is still SQLite-only for this bridge; only one protected web task
  may write EFS until Postgres and cloud leases exist.
- Hosted API/dashboard auth, workspace RBAC, target policy, and Postgres leases
  are not implemented.
- Route/scope matrix, report worker ownership, private probe lifecycle, probe
  location/down semantics, and browser worker sizing are design requirements but
  not implemented.
- Open Deployment's current AWS provider is not production-grade for this
  service because it can register task definitions without roles/logs/secrets and
  includes unsafe DB deletion/default secret handling patterns.

## Acceptance Criteria

- A reviewed infra PR defines all runtime resources and outputs consumed by Open
  Uptime and any deployment tooling.
- The first bridge deploy runs one web task maximum with web-only EFS write IAM;
  scheduler, public probe, reporter, and migration roles remain disabled until
  their cloud data paths are implemented and validated. The bounded Postgres
  scheduler and public-probe review commands do not change desired counts or the
  generic ECS worker commands.
- Hosted routes except `/health` require app auth and workspace RBAC.
- Final cloud-primary runtime state is Postgres plus S3 artifacts; the current
  EFS SQLite bridge is explicitly temporary and not the target source of truth.
- ECS task definitions use secret refs, not plaintext secret values.
- ECS task definitions include explicit container health checks: web checks
  `/health`, while disabled non-web roles run
  `uptimemon cloud workers preflight --role <role> --healthcheck` and fail their
  readiness health check while `canStart=false`, including when hosted mode,
  component identity, workspace env, or role-specific cloud prerequisites are
  invalid. Their main commands call fail-closed
  `uptimemon cloud workers run --role <role>` entrypoints until the real cloud data
  paths are implemented. Reporter preflight also names the report-run store,
  delivery-attempt state machine, provider idempotency, retry/backoff,
  redacted artifact storage, audit export, and delivery alarms as explicit
  blockers.
- Public probes cannot reach denied target classes; private monitors require
  private probes and approved inventory refs.
- Backups, restore drill, rollback sequence, alarms, and cost estimate are
  documented and verified before production cutover.
- Route-to-scope tests, reporter worker tests, private probe lifecycle tests,
  browser worker smoke/load tests, and probe quorum/down-semantics tests pass
  before hosted cutover.
