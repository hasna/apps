# Cloud Source Of Truth

This document defines the target source-of-truth model for running Open Uptime
as a hosted cloud service while keeping local developer workflows intact.

The current release is local-first: Open Uptime stores SQLite under
`~/.hasna/uptime`, and the dashboard/API are intended for local or trusted
loopback use. Hosted cloud mode is a separate operating mode and must not be
implemented as "sync the local SQLite database and expose it on the web".

Current deployment bridge as of 2026-06-28: the deployable AWS runtime uses an
explicit EFS-mounted SQLite database at `HASNA_UPTIME_HOSTED_SQLITE_DB` with AWS
Backup. That is cloud-backed file storage for the first protected service
deployment, not the final cloud source-of-truth design. The target state remains
a first-class Postgres adapter with workspace-scoped migrations, leases,
tombstones, and audit rows.

## Principles

- Cloud-primary must mean an explicit cloud mode, not `hybrid` fallback.
- Every service owns its own durable data. Cross-service integration stores
  stable references and snapshots, not copied private records or secrets.
- Local SQLite and Markdown stores become caches, import sources, or developer
  fallback stores after cutover. They are not authoritative in cloud mode.
- Deletes use tombstones and versions. A local stale write must never overwrite
  a newer cloud row.
- A private operator/probe machine can be preferred for local checks, but authority comes from
  cloud leases, service credentials, migrations, and audit records.
- Secret values stay in AWS Secrets Manager or the owning service. Cloud records
  store secret references, channel ids, and redacted metadata only.
- Rendered dashboards and canvases are JSON Render/React Flow specs generated
  from cloud records. They must not embed credentials, raw local paths that leak
  private state, or provider tokens.

## Canonical Stores

| Surface | Cloud source of truth | Local role | Notes |
| --- | --- | --- | --- |
| Open Uptime | Dedicated `uptime` Postgres schema or database on the approved apps RDS, plus object storage for browser evidence. | `~/.hasna/uptime/uptime.db` is local/dev fallback and migration source only. | Needs first-class Postgres store, migrations, distributed check leases, audit tables, and tombstones. |
| Projects registry | `projects` database on the approved apps RDS. | `~/.hasna/projects/projects.db` is cache/fallback. | Open Uptime project id is deployment-specific; link external service ids rather than duplicating project rows. |
| Per-project stores | Cloud rows keyed by `workspace_id` and app namespace, with local cache at `$HASNA_PROJECTS_HOME/data/<workspace_id>/project.db`. | Existing `by-id/<workspace_id>/project.db` paths remain compatibility imports until migrated. | Stores todos links, canvases, JSON Render specs, loops, handoffs, mementos refs, notes refs, and knowledge refs. |
| Project canvases | Project cloud store tables: canvases, nodes, edges, layout, render spec refs. | Local cache for offline inspection only. | Multiple canvases per project are allowed. React Flow is the editing surface; JSON Render specs are the view payload. |
| Todos | Todos cloud database after conflict/tombstone fixes. | `~/.hasna/todos/todos.db` is cache. | Reuse the existing `open-uptime` todos project instead of creating a duplicate. Current unresolved conflicts must be reconciled before cutover. |
| Conversations | Conversations cloud database after messages, reactions, receipts, tasks, and activity are included or assigned to another owner. | `~/.hasna/conversations/messages.db` is cache. | Until then, conversation metadata can be linked, but the service is not cloud-primary for full conversation history. |
| Mementos | Mementos cloud database after versioned tombstones and conflict semantics are fixed. | `~/.hasna/mementos/mementos.db` is cache. | Store refs from Open Uptime/project stores; avoid copying large memory bodies into Uptime. |
| Knowledge | Knowledge cloud artifact/index store. | Local knowledge DB/files are authoring cache. | Generated architecture records should go through the knowledge/artifact API once cloud auth is ready. |
| Notes | Notes cloud metadata plus object storage for Markdown/audio. | Local Markdown/audio files are cache and authoring source during migration. | Fleet `rsync` is not sufficient for cloud-primary. |
| Servers | Open Servers remains owner of server inventory. | Local SQLite remains source until Open Servers gets cloud-primary mode. | Uptime imports refs/snapshots and runs private probes, not arbitrary operator-entered private targets. |
| Domains | Open Domains remains owner of domain/DNS inventory. | Local SQLite remains source until Open Domains gets cloud-primary mode. | Uptime imports domain refs for DNS, TLS, expiry, and root HTTP monitors. |
| Deployment | Open Deployment remains owner of deployment inventory and run state. | Local SQLite remains source until Open Deployment gets cloud-primary mode. | Uptime imports latest environment/resource refs; it must not expose Open Deployment's server publicly. |
| Mailery, Telephony, Logs | Owning services and AWS secrets own delivery configuration. | Local URLs/keys are dev-only. | Hosted Uptime uses configured channel ids and secret refs. Requests must not submit raw `apiUrl`, `sendKey`, or `apiKey`. |

## Open Uptime Cloud Data Model

Open Uptime cloud mode needs tables for:

- `assets`: imported or manual monitorable things, keyed by
  `source_service`, `source_table`, `source_id`, `workspace_id`, and `kind`.
- `monitors`: cloud monitor config, owner/team/env/tags, source asset ref,
  selected probe policy, assertion config, retry/timeout/interval config, and
  status.
- `probes`: public and private probe registrations with capabilities, machine
  id, region/location, version, last heartbeat, and trust policy.
- `check_jobs`: scheduled work leased transactionally by probes.
- `check_results`: immutable final results with timing, normalized error,
  probe id, monitor version, and evidence refs.
- `incidents`: duration-based downtime windows with ack/silence/assignment,
  escalation state, timeline, affected assets, and report suppression state.
- `browser_evidence`: redacted screenshot/trace/console/network artifact refs.
- `report_schedules` and `report_runs`: SLA/report windows, recipients or
  channel refs, delivery attempts, and generated JSON/HTML summary refs.
- `audit_events`: actor, source IP/proxy identity, machine id, reason,
  mutation target, before/after hashes, and idempotency key.
- `sync_tombstones`: deleted ids with entity type, version, actor, and expiry.

All rows that can change must carry at least `id`, `workspace_id`, `version`,
`created_at`, `updated_at`, `deleted_at`, `origin_machine_id`, `actor_ref`,
and `idempotency_key` where applicable.

The first cloud schema must be implemented as a real Postgres adapter. A generic
`@hasna/cloud` snapshot sync may support discovery, status, migration reporting,
or backfill, but it is not the runtime data store for checks, probes, incidents,
reports, or operator actions.

The repository now exposes the blocked target schema as
`uptimemon cloud postgres-plan`. The command emits redacted review metadata and
optional SQL for the intended Postgres schema, including workspace-scoped
tables, `version`/`deleted_at` tombstone fields, `actor`/`origin`/
`idempotency_key` metadata, `audit_events`, `sync_tombstones`, `check_jobs`,
fencing-token lease fields, and RLS policies based on a session workspace
setting.

The `uptimemon cloud postgres-migrate` command is the reviewed migration-runner
surface for that schema. It defaults to dry-run metadata, requires TLS database
URLs, requires `--apply --confirm-schema <schema>` for DDL, wraps statements in
a transaction, uses idempotent policy creation plus `FORCE ROW LEVEL SECURITY`,
and verifies required tables, policies, and indexes without printing database
credentials. This only moves the migration gate forward. The runtime remains
fail-closed until an explicit async Postgres store is implemented and reviewed
against the approved database with workspace-scoped transaction discipline.

`0.1.42` adds the first bounded Postgres core runtime facade. It can write
workspace-scoped monitor rows, probe identities, deterministic `check_jobs`,
probe submissions with payload-hash replay checks, check results, audit events,
and sync tombstones. It parameterizes the RLS workspace setting and rejects
non-TLS database URLs when it owns the pool. This still is not the authoritative
hosted store until `UptimeService`, hosted API routes, scheduler/public-probe
worker loops, live RLS verification, deploy drain, backlog/stale-lease metrics,
and alarms use it end to end.

`0.1.66` wires a bounded hosted Postgres monitor-control-plane adapter into the
API handler for `/api/v1/summary` and `/api/v1/monitors*` when the caller
supplies an explicit `hostedPostgresRuntime`; `0.1.67` corrects that adapter
with monitor-list offset paging, expected-revision PATCH guards, and audit-key
PATCH replay conflict checks. The adapter uses Postgres monitor rows for
create/list/get/update/delete, carries actor/origin/idempotency metadata, writes
monitor mutation audit rows, and tombstones deletes. It does not make
`uptimemon serve` use `HASNA_UPTIME_DATABASE_URL`, does not promote workers, and
deliberately leaves reports, incidents, results, import apply, probes, browser
checks, scheduler loops, and reporter delivery fail-closed until their
Postgres-backed contracts are implemented and reviewed.

`0.1.68` adds an explicit `hostedPostgresReportRuntime` API adapter for hosted
report schedule metadata, report-run reads, and report audit reads. Schedule
create/update/delete use
atomic Postgres audit helpers with actor, origin, idempotency key, request hash,
and expected-revision provenance. The adapter only accepts explicit
`channelRefIds` and redacts artifact refs plus audit payloads on API reads. It
still blocks `/api/v1/report-schedules/run-due` and
`/api/v1/report-schedules/:id/run`; live hosted reporter execution remains a
separate promotion gate.

`0.1.69` adds an explicit `hostedPostgresProbeRuntime` API adapter for bounded
probe control-plane wiring. The hosted API can enroll probe identities with an
admin-scoped token, claim existing `check_jobs` with a probe-scoped token bound
to the same `probeId`, and verify signed result submissions against the
workspace-scoped probe public key before writing Postgres check results. Probe
enrollment, claim, and submit require runtime mutation-with-audit helpers so the
mutation and audit row share the same workspace transaction. It does not make
private probes cloud-primary or live: probe listing, API-created jobs,
heartbeat, revocation, rotation, inventory-backed private target refs, alarms,
deploy drain, and live worker evidence are still separate gates.

`0.1.44` adds a bounded `uptimemon cloud postgres-scheduler run` review command
that creates deterministic Postgres `check_jobs` for due public-safe HTTP/TCP
monitors with interval-aligned slots, bounded catch-up, and producer-side hosted
target-policy checks. `0.1.43` adds a bounded
`uptimemon cloud postgres-public-probe run` review command over existing Postgres
`check_jobs`. It requires an explicit workspace and probe id, claims jobs with
fencing tokens, runs HTTP/TCP checks through the hosted target policy, records
probe results, and fenced-cancels unsupported, disabled, missing, or
stale-revision jobs. These commands do not enable hosted probe API routes and do
not change the generic hosted worker `canStart=false` preflight state.

The current hosted SQLite bridge is still not cloud-primary, but it now follows
the minimum hosted storage contract where it is used for controlled smokes:
hosted reads and mutations require explicit workspace context, active monitor
queries exclude `deleted_at` rows, hosted monitor deletes write
`sync_tombstones` with actor/origin/idempotency metadata, and monitor-name
uniqueness applies only to active rows so tombstoned names can be recreated.

## Auth, Workspace, And Audit Contract

Hosted mode is closed by default:

- `/health` is the only unauthenticated endpoint.
- dashboard HTML, JSON APIs, MCP-over-HTTP, JSON Render specs, canvas records,
  browser artifacts, report previews, import previews, and every mutation
  require an authenticated actor and workspace context.
- service tokens are scoped by purpose: `uptime:read`, `uptime:write`,
  `uptime:probe`, `uptime:report`, `uptime:admin`, and service-specific import
  scopes.
- probe tokens and operator tokens are separate. A probe can claim jobs and
  submit results only when its hosted token descriptor is bound to the matching
  `probeId`, and it cannot read unrelated monitor configuration, export reports,
  mutate imports, or administer workspaces.
- workspace isolation is enforced in the storage layer through RLS or equivalent
  scoped queries, workspace-scoped unique indexes, and service methods that
  require explicit workspace context.
- tokens must be rotatable and revocable. Rotation and revocation are audit
  events.

Every cloud mutation writes an immutable `audit_events` record:

- actor, workspace, machine id, probe id when relevant, source IP or proxy
  identity, user agent or service name, action, target entity, target version,
  idempotency key, reason, and before/after hashes;
- create, update, delete/tombstone, check, check-result ingest, report send,
  import preview, import apply, probe registration, probe lease, rollback, and
  migration actions are audited;
- audit rows never store secret values, full browser evidence, raw request
  bodies, or unredacted private target URLs.

Hosted tests must prove unauthenticated reads fail, mutation requests without
the right scope fail, and workspace A cannot read, mutate, check, report, import,
or delete workspace B data.

The public edge must preserve the headers needed for that contract:
`Authorization`, `X-Uptime-Hosted-Token`, `X-Uptime-Workspace`,
`Idempotency-Key`, `Content-Type`, and `Origin`. Promotion evidence must prove
the `X-Uptime-Workspace` and `Idempotency-Key` header paths through CloudFront
instead of relying only on query-string workspace selection.

## Target Policy

The target-state architecture uses one shared target policy at both
configuration time and execution time. The current hosted API implements
configuration-time checks for direct targets, and the SDK exposes
`runHostedHttpCheck` plus a bounded hosted public-check service/CLI path for
workspace-scoped HTTP/TCP checks. Those paths perform runtime DNS resolution,
address pinning, redirect validation, DNS-rebinding protection, and
decision-record evidence. Long-running public probe execution stays disabled
until cloud check-job leases and the public-probe worker loop are wired to that
runner and validated in AWS.

Public probes must deny:

- loopback, wildcard, unspecified, link-local, multicast, RFC1918, carrier-grade
  NAT, IPv6 ULA/link-local, and cloud metadata ranges;
- `localhost` and names resolving to denied ranges;
- URL userinfo such as `https://user:pass@example.com`;
- redirects to a denied target;
- DNS rebinding between validation and execution;
- arbitrary TCP hosts that are not approved public targets.

Private targets are allowed only when they come from an approved inventory ref,
such as Open Servers or a deployment resource, and only on private probes whose
egress policy permits that target class. Operators cannot bypass this by typing
an arbitrary private IP or hostname into a hosted monitor form.

The target policy must expose a decision record with target class, resolved
addresses, rule id, probe class, and redacted target display. Tests must cover
localhost, link-local, metadata endpoints, private IPs, IPv6 denied ranges,
redirects, DNS rebinding, private DNS names, Tailscale/private names, and
secret-like URL query strings.

## Monitor Taxonomy

The cloud product must define monitor kinds and assertion schemas before
implementation. Initial first-class kinds:

- `http`: URL, method, redirects, expected status, header assertions, body text
  assertions, JSON assertions, latency threshold, retry policy.
- `browser_page`: URL, viewport/device, navigation timeout, console-error
  policy, uncaught-exception policy, failed-resource policy, screenshot/trace
  policy, Core Web Vitals-lite timing, and optional DOM assertions.
- `tcp`: host/port connect from approved public or private probe.
- `server_health`: inventory-backed health URL or port check from Open Servers,
  always routed through private probes unless the source is explicitly public.
- `dns`: record type, authoritative and recursive resolvers, expected values,
  propagation/drift policy.
- `tls`: hostname, expiry threshold, chain validity, hostname match, issuer
  metadata.
- `domain_expiry`: registry/RDAP expiry threshold and registrar metadata.
- `deployment`: imported deployment/environment resource status, latest live URL
  health, rollback/failure signal.
- `heartbeat`: external job or service check-in before a deadline.
- `report_delivery`: scheduled report generation and delivery health.

Each kind needs a config schema, normalized result schema, summary fields,
failure reason taxonomy, CLI/API/MCP/SDK representation, JSON Render view, and
contract tests.

## Browser Evidence And PII

Browser monitoring is not part of the local-first release. It becomes cloud
scope only when the evidence pipeline is in place:

- screenshots, traces, HAR-like network records, console logs, page errors, and
  HTML snippets are stored in an encrypted object bucket with versioning,
  lifecycle, retention, and public access blocks;
- Postgres stores artifact refs, redaction status, checksum, content type,
  size, retention class, workspace id, monitor id, result id, and evidence
  grouping key;
- signed URLs are short-lived, workspace-scoped, and audit logged;
- scrubbing removes cookies, auth headers, tokens, secret-like query params,
  form values, local storage/session storage values, and credential-looking
  console/network payloads before persistence;
- screenshot capture must support masking selectors and page areas;
- default retention is short, with longer retention only by policy.

If this evidence pipeline is not implemented, browser/page checks must stay out
of hosted cutover.

## Probe And Check Job Protocol

Cloud checks are never scheduled by independent local loops over local SQLite.
They use cloud jobs and cloud leases:

1. scheduler creates deterministic `check_jobs` for monitor/version/schedule
   slots;
2. probes heartbeat with machine id, version, capabilities, location, trust
   class, and current load;
3. probes claim jobs transactionally with a TTL and fencing token;
4. probes execute only jobs matching their capabilities and target policy;
5. result ingest requires the active fencing token and idempotency key;
6. expired leases can be reclaimed, but duplicate result ingest for the same
   job slot is rejected or marked duplicate;
7. probe health is derived from heartbeat lag, failed claims, execution errors,
   result latency, and version drift.

Two-probe race tests must prove that one schedule slot produces one authoritative
result and that stale fencing tokens cannot submit or overwrite results.

As of `@hasna/uptime@0.1.33`, the local SQLite probe scaffolding uses
workspace/monitor-revision/schedule-slot/probe-policy deterministic job
identity, stores probe class/location and policy hashes on jobs/results, keeps
same-probe claim retries idempotent, and rejects nonce reuse with a different
signed payload. Reporter preflight can also validate service-owned channel-ref
catalogs without accepting raw provider destinations or credentials. This is
local contract coverage only. Hosted probe enrollment, claim, and submit have a
bounded audited Postgres adapter when `hostedPostgresProbeRuntime` is injected,
but live report delivery, heartbeat/revocation/rotation, API-created jobs, and
cloud workers remain fail-closed until deploy drain, backlog/stale-lease
metrics, retry/audit/artifact delivery semantics, and RLS/audit-backed runtime
promotion evidence are implemented.

## Import Preview And Apply Contract

Import is a reviewable workflow, not direct bulk creation.

Preview output includes:

- source service, source table/model, source id, source updated time, workspace,
  candidate kind, redacted target display, proposed monitor config, tags,
  owner/team/env, source checksum, freshness, conflicts, and policy warnings;
- action: create, update, unchanged, stale, blocked, or conflict;
- idempotency key: `source_service/source_table/source_id/kind`;
- no secret values and no raw local-only paths in hosted render payloads.

Apply input references preview ids and chosen actions. Apply writes assets,
monitors, provenance snapshots, audit events, and rollback records. Stale source
records mark assets stale; they do not delete monitor history automatically.
Rollback can undo newly-created monitor config from an import batch without
deleting historical check results.

CLI, API, MCP, and SDK surfaces must expose dry-run preview and apply with the
same schema.

## Incident And Operator Workflow

Cloud incidents are duration-based operational records. They need:

- severity, owner/team, assignee, affected asset refs, source monitor refs,
  status, opened/resolved timestamps, detection result id, recovery result id,
  and SLA impact;
- actions: acknowledge, unacknowledge, silence, unsilence, create maintenance
  window, assign, comment, manual close, reopen, link related incident, and
  attach evidence;
- escalation state, notification suppression state, and report inclusion policy;
- immutable timeline events for checks, operator actions, notification attempts,
  imports, maintenance changes, and report events.

Every action requires actor, scope, reason, idempotency key, and audit row.
Dashboard and JSON Render views must support filtering by owner, environment,
source, probe, kind, severity, status, assignment, silence, and maintenance.

## Reports And Delivery

Local development can keep direct Mailery/Telephony/Logs options. Hosted mode
uses workspace-authorized delivery channel refs and secret refs only.

Hosted report APIs must reject raw `apiUrl`, `sendKey`, `apiKey`, arbitrary
Open Logs project ids, and arbitrary delivery destinations. The server resolves
approved channel refs through the owning service or AWS secret refs and records
only redacted delivery metadata.

Scheduled reports use duration-based SLA windows, not check-count percentages.
Report config includes workspace, owner/team/env filters, monitor kinds, time
window, timezone, maintenance exclusion policy, recipients/channel refs,
template, and retention. `report_runs` records generated JSON/HTML refs,
delivery attempts, delivery failures, idempotency keys, and audit refs.

Payloads are audience scoped. Private target hostnames/URLs are masked unless
the recipient/channel is authorized for that workspace and target class.

## Sync And Conflict Contract

The minimum cloud-primary contract for hosted services is:

1. `status` command shows effective mode, redacted database env name, schema
   version, machine id, sync cursor, conflict count, and whether local storage
   is cache-only.
2. Cloud mode opens Postgres directly. It does not silently fall back to local
   SQLite when a cloud connection fails.
3. Pull applies tombstones. Deletes are propagated, not filtered away.
4. Push uses optimistic concurrency on `version` or `updated_at`. Stale writes
   produce conflicts instead of overwriting cloud rows.
5. Migration dry-runs report counts, schema versions, and conflict counts only.
   They do not print records or secret values.
6. Cutover freezes legacy local stores for the migrated service until the
   rollback window closes.
7. Project per-project stores, canvases, JSON Render specs, and project data
   records are cloud-backed. Local `project.db` files are caches or import
   sources, not the source of truth.
8. Dependent services are explicitly classified before Uptime cutover:
   cloud-capable, local-only/link-only, or blocked. Link-only services can be
   referenced but cannot be treated as authoritative cloud records.

`@hasna/cloud` can remain the shared discovery/status/migration layer, but
Open Uptime should implement a real cloud storage adapter instead of trying to
reuse a generic SQLite snapshot sync as runtime storage.

## Private Probe Cloud-Primary Mode

An operator/probe machine should become cloud-primary only after a preflight proves:

- canonical service database endpoints resolve and connect using scoped service
  credentials loaded from secret refs;
- `cloud status` no longer points at stale or non-resolving hosts;
- `projects`, `todos`, `conversations`, `mementos`, `knowledge`, `notes`, and
  `uptime` all report an explicit cloud-capable mode or are marked local-only
  with a documented owner;
- outstanding todos conflicts are reconciled or quarantined;
- schema versions match the release being deployed;
- the machine has a unique cloud machine registration and a time-limited primary
  operator lease;
- local `~/.hasna` databases are backed up before migration and then treated as
  cache/fallback, not active authority.

`uptimemon cloud memory-preflight --json` prints a redacted report for this
checklist and exits `0` for inspection even when blocked. Use
`uptimemon cloud memory-preflight --healthcheck --json` as the current fail-closed
operator gate. It intentionally reports only redacted evidence such as service
names, configured environment variable names, booleans, and blocker text. It
checks env presence but does not retain or print database URLs, API keys, secret
refs, private note/message/memory/knowledge bodies, Terraform state, or monitor
private targets. The current command has no local-only exception override; every
listed service must either pass its audited cloud-primary checks or remain an
explicit blocker. It must not be used to claim an operator machine
cloud-primary while Notes and Open Uptime still lack authoritative cloud
storage/runtime adapters.
Machine proof flags are machine-specific: `operator-01` uses
`HASNA_UPTIME_OPERATOR_01_*`, and any other `--machine-id` derives its own
`HASNA_UPTIME_<MACHINE_ID>_*` prefix. Secret-looking or malformed machine IDs
are rejected and rendered only as `invalid-machine-id`.

Operator primary status is a time-limited lease, not a boolean flag. The lease
must include a fencing token, heartbeat deadline, revocation path, audit rows,
and clear behavior for expiration. Cloud writers and probe workers must include
the current fencing token for primary-only actions.

Rollback is a planned mode:

1. pause new cloud writes for the affected service;
2. revoke the operator machine's primary lease;
3. point CLIs back to the preflight local fallback store;
4. keep cloud rows read-only for comparison until the incident is resolved;
5. record the rollback in Projects, Todos, Logs, and the service audit table.

Migration and rollback require pre-cutover backups, conflict quarantine, dry-run
counts only, legacy-store freeze, restore rehearsal, cloud/local read-only
comparison evidence, and a documented window for deleting or archiving temporary
fallback data.

## Inventory Imports

Imports are explicit preview/apply workflows:

- preview reads source services and emits candidates without secret values;
- apply creates or updates `assets` and `monitors` with provenance;
- idempotency key is `source_service/source_table/source_id/kind`;
- stale source records mark Uptime assets as stale; they do not delete monitor
  history automatically;
- private targets are only created from approved inventory refs and are assigned
  to private probes.

Initial import sources:

- Projects: repo/service groups, owner, stage, priority, GitHub refs, project
  stores, canvases, and JSON Render dashboard refs.
- Servers: hostname, health URL, ports, Tailscale fields, project refs, and
  readiness snapshots for private probe monitors.
- Domains: registered domains, DNS records, TLS expiry, domain expiry, root
  HTTP checks, and discovered page candidates.
- Deployment: environment URLs, provider/resource status, latest deployment
  refs, region, and rollback/failure signals.

## JSON Render And Canvases

Every project can have multiple cloud-backed canvases. A canvas stores React
Flow nodes/edges and links each node to a JSON Render spec, a source record, or
an Open Uptime dashboard query.

Open Uptime should expose JSON Render specs for:

- fleet overview by owner/environment/source/probe;
- incidents and SLA windows;
- browser error evidence;
- probe health;
- import preview diffs;
- report schedules and report runs.

The rendering layer reads cloud records through authenticated APIs. It does not
read local SQLite databases directly and does not receive raw secrets.

Canvas/render APIs must include:

- project canvas CRUD, node/edge CRUD, and stable links to monitors, incidents,
  probes, imports, report runs, and source inventory refs;
- JSON Render spec versioning and validation;
- redaction tests for private targets, local paths, secret refs, and browser
  evidence;
- workspace/project authorization on every render and canvas endpoint.

## AWS Runtime Contract

The preferred hosted runtime is:

- approved apps RDS with a dedicated Uptime database or schema,
  least-privileged user, TLS, migrations, automated backups, PITR, deletion
  protection, and pre-cutover snapshots;
- AWS Backup coverage for the temporary EFS bridge, including a reviewed Backup
  Vault Lock retention window before live scale-out;
- hardened S3 bucket for browser evidence and report artifacts, with KMS
  encryption, versioning, lifecycle/retention, public access block, explicit
  deny rules for non-KMS or wrong-key uploads, and scoped IAM policies;
- ECR image repository, ECS/Fargate service, task role, execution role, private
  subnets, security groups, protected edge, public ALB origin, CloudFront
  default-domain HTTPS or custom TLS/DNS, log groups, metrics, alarms, and
  deployment circuit breaker;
- hosted web task public-origin configuration through
  `HASNA_UPTIME_ALLOWED_ORIGINS`, matching the selected HTTPS edge origin;
- Secrets Manager or SSM parameter `valueFrom` refs in task definitions, never
  plaintext secret values in task environment;
- Terraform scale-up gates that require explicit backend-state, human-alert,
  backup/restore, and evidence-retention readiness before any `web` desired
  count above zero;
- owner/project/environment tags, budget alarms, and a monthly cost estimate.

Except for the current single-web-task deployment bridge documented above, EFS
is not part of the target architecture unless a future requirement proves a
shared filesystem is necessary. SQLite-on-EFS is not the final cloud source of
truth and must not be expanded to scheduler/probe/reporter workers.

Open Deployment can orchestrate or record deployment metadata only after its
hosted mode is private or authenticated and its provider model stops storing raw
secret values. It must not be exposed as a public upstream for Uptime.

An infra change in the approved infrastructure repository must exist before live
deployment. It must define the runtime resources, outputs consumed by Open
Uptime/Open Deployment, backup/restore drills, CloudWatch alarms for
ECS/API/RDS/S3/probe lag/job backlog/delivery failures, and rollback commands.

## Current Blockers

- Open Uptime has a bounded Postgres runtime facade, scheduler review runner,
  public-probe review runner, and audited hosted probe enrollment/claim/submit
  adapter, but no fully wired Postgres service store, hosted probe listing/job
  creation/heartbeat/revocation/rotation routes, scheduler lease loop, deploy drain,
  backlog/stale-lease alarms, or sustained ECS worker readiness.
- Hosted API reads use static scoped hosted-token descriptors for operator
  smokes, and the hosted dashboard shell still fails closed; production-grade
  identity/RBAC is not implemented yet.
- Outbound target policy for hosted HTTP/TCP checks exists in the SDK and the
  `uptimemon cloud public-checks run-due` operator path. A bounded
  `uptimemon cloud public-checks worker` EFS SQLite bridge loop exists for
  controlled smokes only when `--allow-public-checks-bridge` or
  `HASNA_UPTIME_ALLOW_PUBLIC_CHECKS_BRIDGE=1` is explicitly set. A separate
  bounded `uptimemon cloud postgres-scheduler run` command can create public-safe
  deterministic Postgres `check_jobs`, and `uptimemon cloud postgres-public-probe
  run` can review existing jobs with lease fencing, but sustained ECS worker
  readiness is not wired yet.
- `@hasna/cloud` hybrid mode still returns SQLite, so it is not cloud-primary.
- The local cloud config currently points at a stale/non-resolving database host.
- Todos has unresolved conflicts that must be reconciled before cloud cutover.
- Conversations, notes, mementos, servers, domains, and deployment have partial
  or local-first storage models that need explicit ownership decisions.
- Open Uptime is not registered in `@hasna/cloud` known service lists.
- A private AWS bridge can provide zero-count runtime resources, including
  ECR, dormant ECS services, ALB, CloudFront default-domain edge, logs, alarms,
  EFS, Backup, and Secrets Manager containers. The public Terraform module
  defines explicit ECS container health checks for every task definition.
  Private deployment evidence must prove secret refs have `AWSCURRENT` versions,
  one-off web task smokes covered image pull/startup, secret injection,
  CloudWatch log delivery, EFS read/write, S3 PutObject, and NAT HTTPS egress
  while services stayed at desired count `0`, and the selected origin
  verification posture denies direct-origin access. The origin header value is
  secret-bearing Terraform/AWS configuration, not public evidence. Private
  deployment evidence should also include a representative SQLite EFS
  backup/restore drill with integrity/count checks.
  It is not live: live scale-up is still blocked by edge/auth smokes, approved
  human/on-call SNS subscriptions and delivery smoke, and production auth
  hardening beyond scoped static operator tokens. Terraform now prevents
  accidental `web > 0` promotion in CloudFront mode unless origin verification
  is enabled and either HTTPS-origin mode or explicit HTTP-origin risk
  acceptance is configured.
- Projects per-project cloud stores do not exist yet; current local
  `project.db` stores are not enough for cloud-backed canvases or JSON Render.
- Browser/page monitoring lacks the artifact, redaction, retention, and storage
  controls required for hosted mode.
- Open Deployment stores and injects secrets in ways that conflict with the
  hosted secret-ref model and must stay private until hardened.

## Acceptance Criteria

- A fresh operator-machine local state directory can read and mutate cloud-backed
  projects, project stores, todos, knowledge, notes, mementos, and uptime data
  without copying a database.
- Open Uptime cloud mode refuses to start if the cloud database is unavailable
  unless an explicit `--local-fallback` dev flag is used.
- Public API/dashboard reads and every mutation require auth except `/health`.
- Uptime checks use transactional cloud leases and cannot double-run from two
  probes for the same schedule slot.
- Import preview/apply is idempotent and stores source provenance for every
  monitorable asset.
- Tombstones propagate across push/pull, and stale writes are conflicts.
- Project canvases and JSON Render specs are stored per project in cloud-backed
  project stores and support multiple canvases per project.
- Hosted report delivery uses service-owned channel refs and secret refs only.
- Rollback from cloud-primary to local fallback is documented and tested before
  private-probe cutover.
- The implementation contract covers monitor kinds/assertions, probe leases,
  target policy, incident actions, report schedules, import preview/apply,
  browser evidence, auth/RBAC, schema migrations, backups, and infra outputs.
