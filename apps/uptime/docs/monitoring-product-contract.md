# Monitoring Product Contract

This document defines the hosted Open Uptime product scope. It translates the
cloud and AWS architecture into user-visible monitoring, operator workflows,
data contracts, and dashboard/canvas requirements.

Open Uptime should feel closer to Pingdom than Sentry: it watches websites,
pages, APIs, domains, DNS, TLS, servers, private health checks, deployment
signals, and heartbeat jobs. It is not an exception-tracing product.

## Current Local Product

The current release is intentionally small:

- monitor kinds: `http` and `tcp`;
- API routes: summary, report, monitor CRUD, immediate checks, incidents, and
  recent results;
- dashboard: local HTML for add/edit/check/pause/delete, summary cards, recent
  results, and incident table;
- reports: immediate snapshot report through Mailery, Telephony, and Logs using
  local/dev integration settings;
- availability: check-count uptime percentage, not elapsed-time SLA;
- persistence: local SQLite only.

Hosted mode must not expose this local surface as-is. It needs cloud auth,
workspace/project scope, probe separation, source imports, target policy, cloud
storage, evidence redaction, and richer operator workflows first.

Hard cutover gate: do not expose hosted dashboard, API, MCP-over-HTTP, report,
render, canvas, artifact, or check surfaces until the P0 hosted gates in this
document have automated tests.

## Product Objects

Cloud Open Uptime owns these product objects:

- `workspace`: auth and isolation boundary.
- `asset`: monitorable thing imported from Projects, Servers, Domains,
  Deployment, or created manually.
- `monitor`: policy for checking an asset or target.
- `check_job`: scheduled work item for a probe.
- `check_result`: immutable result for one monitor version and schedule slot.
- `probe`: public or private worker identity and capabilities.
- `incident`: duration-based downtime or degradation record.
- `maintenance_window`: planned suppression or expected outage period.
- `browser_evidence`: redacted artifact refs for browser/page checks.
- `report_schedule`: recurring SLA/operator report definition.
- `report_run`: generated report artifact and delivery state.
- `notification_policy`: escalation, dedupe, silence, and delivery routing.
- `import_batch`: preview/apply/rollback record for inventory imports.
- `dashboard_view`: saved fleet/dashboard filter or JSON Render view.
- `canvas`: React Flow project canvas backed by Projects cloud stores.

Every object is workspace-scoped and carries ownership/provenance/audit metadata.

High-cardinality objects such as `check_result`, `browser_evidence`,
`audit_events`, and report artifacts require retention and partitioning/index
rules before production. Fleet and report pages must have query plans or load
tests for the expected monitor count, interval mix, and retention window.

## Monitor Kinds

Initial hosted monitor kinds:

| Kind | Purpose | Source |
| --- | --- | --- |
| `http` | Website/API availability, status, latency, redirects, headers, body, JSON assertions. | Manual, Projects, Domains, Deployment |
| `browser_page` | Page load, console errors, uncaught exceptions, failed resources, screenshot/trace evidence. | Manual, Projects, Domains, Deployment |
| `tcp` | Public or private port connect. | Manual for public, Servers/Deployment for private |
| `server_health` | Private server health URL/port from server inventory. | Servers only |
| `dns` | A/AAAA/CNAME/MX/TXT/NS checks, authoritative/recursive drift. | Domains |
| `tls` | Certificate expiry, hostname match, chain validity. | Domains, HTTP assets |
| `domain_expiry` | Domain/RDAP expiry threshold. | Domains |
| `deployment` | Latest environment URL/resource status and rollback/failure signal. | Deployment |
| `heartbeat` | Job/service check-in before a deadline. | Manual/API |
| `report_delivery` | Scheduled report generation/delivery health. | Open Uptime internal |

Each kind needs:

- config schema;
- assertion schema;
- normalized result schema;
- failure reason taxonomy;
- allowed probe classes;
- default interval, timeout, retry, and down policy;
- CLI/API/MCP/SDK representation;
- JSON Render summary/detail specs;
- dashboard creation/editing flow;
- tests for success, failure, validation, and redaction.

Monitor kinds are enabled by feature flag. `http` and `tcp` can be the first
cloud-safe kinds after the hosted core is in place. `browser_page`, private
`server_health`, hosted report delivery, and broader deployment/import monitors
remain disabled until their specific acceptance gates pass.

## Target And Probe Rules

Public monitors can be manually created only when the target policy classifies
the target as public and safe.

Private monitors must come from approved inventory refs and run only on private
probes. Hosted forms must not allow an operator to type arbitrary private IPs,
private DNS names, metadata endpoints, or loopback addresses as private monitor
targets.

Probe selection rules:

- public checks run on public probes only;
- private checks run on private probes only;
- private probe identity is bound to workspace, machine id, source inventories,
  capabilities, and trust class;
- each result stores probe id, probe class, probe location, monitor version, and
  schedule slot;
- down policy defines whether one location, quorum, or authoritative private
  result opens an incident;
- stale or duplicate result submissions cannot close or reopen incidents.

Job lease semantics:

- deterministic job identity is
  `workspace_id/monitor_id/monitor_version/schedule_slot/probe_policy`;
- scheduler inserts jobs idempotently and has a bounded catch-up window;
- duplicate scheduler instances cannot create duplicate authoritative jobs;
- probes claim jobs transactionally with `lease_expires_at` and a fencing token;
- result ingest requires the active fencing token, probe identity, schedule slot,
  monitor version, and idempotency key;
- stale fencing tokens and duplicate submissions are rejected or marked
  duplicate without mutating incidents;
- deploy drain pauses new claims and lets in-flight leases expire or finish;
- alarms fire for stale leases and backlog.

Current implementation note: `@hasna/uptime@0.1.67` implements the deterministic
job key, probe policy hash, class/location claim checks, same-probe claim retry
idempotency, nonce payload conflict rejection in the local SQLite probe
scaffold, service-owned report channel-ref catalog validation for hosted
reporter preflight, a read-only Postgres private-probe identity preflight, and
mandatory `hosted-public` target-policy enforcement for Postgres monitor
upserts. It also includes the explicit hosted Postgres monitor API adapter that
was introduced in `0.1.66` and corrected in `0.1.67` for `/api/v1/summary` and
`/api/v1/monitors*`, with workspace-scoped reads/writes, monitor-list offset
paging, expected-revision PATCH guards, audit-key PATCH replay conflict checks,
actor/origin/idempotency metadata, audit rows, tombstones, and fail-closed
behavior for non-migrated hosted reads. It also includes SDK/CLI shared-evidence
sanitization for rollout artifacts, AWS-shaped origin-header value redaction, an
explicit zero-count origin-header rotation exception gate, plus callback
contracts for redacted report artifact object writes and sanitizer-safe Open
Logs audit export payloads. The hosted reporter preflight also accepts redacted
`open-uptime.reporter-promotion-evidence.v1` evidence so approved object-store,
Open Logs export, delivery alarm, and liveness/drain checks can be recorded
without exposing private resource identifiers or secret values; supplied
promotion evidence must name the active workspace before any individual
promotion check can pass. Enabled Postgres
`browser_page` rows remain blocked until browser evidence workers are configured,
and private targets still require future
inventory-backed provenance. Sanitized evidence is not live-readiness proof.
Service-store integration, channel secret loading, worker lease ownership,
deploy drain, backlog/stale-lease metrics, live report delivery, private-probe
heartbeat/revocation/rotation, and hosted cloud-worker enablement remain future
cloud-store gates.

## Inventory Import Workflow

Imports are preview/apply workflows.

Preview sources:

- Projects: project identity, status, owner, stage, priority, GitHub refs,
  service metadata, project stores, canvases, and render specs.
- Servers: hostname, health URL, ports, Tailscale fields, project refs, and
  readiness snapshots for private health monitors.
- Domains: domain records, DNS records, SSL/TLS expiry, domain expiry, root
  HTTP checks, and discovered page candidates.
- Deployment: environment URLs, provider/resource status, live deployment refs,
  region, deployment failures, and rollback signals.

Source classification:

- `cloud-capable`: source has an authenticated cloud API/store with versions,
  tombstones, and safe refs;
- `preview-only`: source can produce safe candidates but apply is disabled;
- `link-only`: source can be referenced by id/snapshot but not treated as an
  authoritative hosted dependency;
- `blocked`: source cannot be used until its owner fixes auth, secrets,
  tombstones, or data quality.

Initial classification:

- Projects: preview/link identity metadata is feasible; cloud-primary canvases
  require Projects cloud-backed per-project stores and local-path stripping.
- Servers: preview approved inventory candidates; private apply waits for
  private probe trust and source refs.
- Domains: preview DNS/TLS/domain-expiry/root HTTP; avoid copying ownership PII,
  raw WHOIS/history, or treating hard deletes as tombstones.
- Deployment: link-only until authenticated, secret-ref-only, and safe for hosted
  consumption.

Preview must show:

- proposed asset and monitor rows;
- source provenance and freshness;
- target policy decision;
- dedupe/conflict action: create, update, unchanged, stale, blocked, conflict;
- owner/team/environment/tag mapping;
- warnings and required approvals;
- no secret values and no raw local paths in hosted render payloads.

Apply must:

- create/update assets and monitors idempotently;
- store provenance snapshots and import-batch audit events;
- allow rollback of newly-created monitor config from a batch;
- preserve historical results and incidents;
- mark stale sources without deleting history automatically;
- rollback creates, updates, stale markings, provenance changes, and conflict
  decisions from before/after snapshots, while preserving historical results and
  incidents.

Preview/apply parity is required across API, CLI, MCP, and SDK for agent use.

## Browser/Page Monitoring

`browser_page` is hosted-only and remains disabled until the evidence pipeline is
implemented.

Checks capture:

- navigation status and final URL;
- load timing and Core Web Vitals-lite metrics;
- console errors matching policy;
- uncaught page exceptions;
- failed script/image/API resources;
- mixed content or blocked resources where available;
- screenshot and optional trace/network artifact refs;
- DOM assertions where configured.

Evidence handling:

- redact before persistence;
- mask configured selectors/regions;
- scrub cookies, auth headers, tokens, query secrets, storage values, form
  values, console payloads, and network payloads;
- store artifact refs, checksums, sizes, redaction status, and retention class;
- expose signed URLs only after workspace/artifact authorization;
- default retention is short.
- feature flag remains off until Playwright/container smoke and load tests,
  redaction fail-closed tests, S3 signed URL auth tests, and budget alarms pass.

Browser result grouping:

- console/page/network errors get grouping keys by monitor, URL pattern, error
  type, normalized message, source file/resource host, and stack signature where
  safe;
- repeated failures update incident timeline and evidence count instead of
  creating noisy duplicate incidents.

## Incident Workflow

Incident states:

- `open`
- `acknowledged`
- `silenced`
- `maintenance`
- `resolved`
- `closed`
- `reopened`

State transitions:

- checks can open incidents after monitor down policy is satisfied;
- checks can auto-resolve incidents only when recovery policy is satisfied and
  the result is from an authoritative schedule slot/probe;
- operators can acknowledge, unacknowledge, silence, unsilence, assign, comment,
  attach evidence, create maintenance, manually close, and reopen;
- maintenance suppresses notifications and SLA impact according to report policy
  but does not delete check results;
- stale probe results and duplicate jobs cannot change incident state.

The implementation must publish a state-machine table covering allowed
transitions, actor/source of transition, required reason, audit action,
notification behavior, report impact, and reversal behavior. Tests must cover
auto-open, auto-resolve, ack, silence, maintenance, manual close, reopen,
assignment, comments, evidence attachment, notification dedupe, and stale-result
rejection.

Incident detail must show:

- affected asset and monitor;
- status, severity, owner/team, assignee;
- source inventory refs;
- timeline events;
- check results and probe identity;
- notification attempts and suppressions;
- evidence artifacts;
- related incidents;
- SLA impact for selected windows;
- audit trail for operator actions.

## Notifications And Reports

Notifications:

- use workspace-authorized channel refs only;
- support email, SMS/phone, Open Logs, and future webhooks through service-owned
  refs;
- support dedupe, escalation, silence, maintenance suppression, retry/backoff,
  and failure alarms;
- mask private targets unless the channel is authorized for that target class.

Reports:

- scheduled SLA/operator reports, not only immediate snapshots;
- duration-based availability by time window;
- timezone and business-hour support;
- maintenance exclusion policy;
- filters by owner, team, environment, project, source, monitor kind, severity,
  and incident state;
- generated JSON and HTML artifacts;
- delivery attempts with idempotency and retry state;
- report-run monitor to detect stuck or failed reports.

Report run state machine:

- `scheduled`
- `generating`
- `generated`
- `delivering`
- `delivered`
- `partially_failed`
- `failed`
- `cancelled`

Report acceptance needs DST/timezone golden tests, business-hour window tests,
recipient/channel authorization recheck at send time, retry exhaustion behavior,
idempotent delivery keys, redacted artifacts in S3, reporter-specific IAM, and
alarms for stuck or failed runs.

The local direct `apiUrl`/key style can remain for local development. Hosted
report APIs reject raw URLs, keys, arbitrary recipients, and arbitrary Logs
project ids.

Hosted reporter preflight accepts only an operator-provided, server-owned
channel-ref catalog in `HASNA_UPTIME_REPORT_CHANNEL_REFS_JSON`. This catalog is
runtime configuration for the hosted service. It is not a client request body,
MCP input, or schedule payload shape:

```json
{
  "version": "open-uptime.report-channel-refs.v1",
  "channels": [
    {
      "id": "ops-email",
      "channel": "email",
      "service": "mailery",
      "secretRef": "<aws-secretsmanager-reporting-email-ref>",
      "targetRef": "workspace-ops"
    },
    {
      "id": "ops-logs",
      "channel": "logs",
      "service": "logs",
      "secretRef": "<aws-ssm-reporting-logs-ref>",
      "targetRef": "workspace-logs"
    }
  ]
}
```

The catalog is a validation contract only until the hosted Postgres store,
approved S3/object artifact writer wiring and smoke evidence, approved Open
Logs audit export wiring and smoke evidence, delivery alarms, and live reporter
liveness/drain evidence are implemented. The Postgres migration plan and report
runtime include workspace-scoped `report_delivery_attempts` and
`report_artifacts` metadata plus callback contracts for redacted artifact object
writes and sanitizer-safe Open Logs audit export payloads, so the runtime can
persist per-attempt idempotency, retry state, claim/fencing metadata, retention
class, and redacted artifact refs without storing provider secrets or raw report
bytes in SQL. It must not contain raw `apiUrl`, recipient, token, key, password,
or secret value fields. Hosted schedule/API/MCP requests must
later reference approved channel ids only; clients must never submit `secretRef`
values.

The artifact callback is an at-least-once integration boundary: object writers
must be idempotent for the supplied hash/idempotency key, and approved S3/object
store wiring must include reconciliation or lifecycle cleanup for objects whose
metadata transaction fails after the external write succeeds.

The Postgres report runtime also includes transactional report schedule/window
claiming plus a fenced report-run state machine. A reporter worker can claim one
due schedule, begin a deterministic run for that schedule window, finish it with
its own worker lease/fencing token, and advance `last_run_at`/`next_run_at` in
the same transaction. This prevents duplicate workers from processing the same
due window without skipping the window after an expired unfinished claim.
Schedule discovery and claim records expose only channel presence booleans,
never raw recipients, provider endpoints, secret refs, or channel payloads. This
is still not permission to scale the hosted reporter until approved artifact
object storage wiring, approved secret loading, approved audit export wiring,
delivery alarms, and worker liveness are proven end to end.

Hosted delivery code now has a separate server-side resolver for the channel-ref
catalog. The resolver requires explicit selected channel ids from an already
authorized schedule/run, accepts a runtime secret-loader callback, loads the
server-owned secret payload for each selected workspace-scoped ref, verifies the
secret payload version/service/target binding, and prepares Mailery, Telephony,
and Open Logs API calls using approved service endpoints:

- Mailery: `POST /api/v1/send` with `Authorization: Bearer <sendKey>`;
- Telephony: `POST /api/sms/send`, optionally with a server-owned bearer token;
- Open Logs: `POST /api/logs/structured` with server-side bearer auth.

The delivery result returned to report/runtime code includes channel id,
provider, hashed target ref, status, provider id, and a stable request hash. It does
not include recipient addresses, phone numbers, API URLs with credentials,
tokens, send keys, raw report bytes, provider-echoed targets, or secret payload
JSON. Hosted delivery uses a redacted report payload by default: monitor target
URLs, hosts, ports, and target-like incident text are masked before email, SMS,
Open Logs, request-hash, or delivery evidence creation. This is still not
permission to scale the reporter: S3/object artifact writer wiring, delivery
audit export wiring, reporter alarms, and live worker liveness evidence remain
required before live promotion.

## Dashboard Views

Hosted UI is a work-focused operator app, not a marketing surface.

Required views:

- fleet overview: owner/environment/source/probe health, open incidents,
  stale monitors, muted/maintenance items, report status, probe health;
- monitor list: filters, saved views, bulk actions, source provenance,
  current status, SLA, latency, incident count, probe policy;
- monitor detail: config, assertions, target policy decision, recent results,
  incidents, evidence, timeline, source refs, audit;
- incident queue: severity, state, assignee, owner/team, duration, affected
  assets, silence/maintenance state, notification state;
- incident detail: full operator timeline and action panel;
- import preview/apply: candidate diffs, warnings, approvals, apply progress,
  rollback record;
- probe management: public/private probes, heartbeats, version drift,
  capabilities, assigned jobs, failures, revocation;
- browser errors: grouped console/page/resource failures, screenshots/traces,
  retention and redaction status;
- reports: schedules, report runs, generated artifacts, delivery attempts,
  retry failures;
- settings: workspaces, roles/scopes, channel refs, policies, retention,
  maintenance windows.

All views need authenticated empty, loading, error, stale-data, and partial-data
states. Fleet pages need explicit freshness timestamps and pagination or
virtualized tables for scale.

User-facing dashboard acceptance requires:

- fleet overview, monitor detail, incident detail, import preview, probe health,
  browser errors, report schedules/runs, settings, and project canvas embedding;
- RBAC-aware action visibility;
- freshness indicators on every live data panel;
- no local SQLite fallback in hosted dashboards;
- redaction based on viewer authorization.

## JSON Render And React Flow

Open Uptime exposes JSON Render specs for operator surfaces:

- `uptime.fleet`
- `uptime.monitor`
- `uptime.incident`
- `uptime.import_preview`
- `uptime.probe_health`
- `uptime.browser_errors`
- `uptime.report_schedule`
- `uptime.report_run`
- `uptime.canvas_node`

Projects owns canvas storage. Open Uptime owns render specs and dashboard query
payloads that can be embedded in project canvases.

Canvas node types:

- fleet summary node;
- monitor status node;
- incident queue node;
- browser evidence node;
- probe health node;
- import batch node;
- report run node;
- source inventory node.

Canvas/render requirements:

- specs are versioned and validated;
- nodes link to workspace/project/monitor/incident/probe/report/import ids;
- no raw local paths or secret values in hosted payloads;
- private target labels are redacted by viewer authorization;
- React Flow nodes support drill-in links to hosted views;
- multiple canvases per project are supported through Projects cloud stores.

## API Surface

Target hosted API namespace: `/api/v1`.

Hosted mode uses `/api/v1` as the canonical API. Legacy local `/api/*` routes
are either local-only or explicit translations that still enforce the hosted
route-to-scope matrix. Tests must inventory every hosted route and prove 401,
403, and cross-workspace denial behavior.

Required groups:

- `/assets`
- `/monitors`
- `/monitor-kinds`
- `/checks/jobs`
- `/checks/results`
- `/probes`
- `/incidents`
- `/incidents/:id/actions`
- `/maintenance-windows`
- `/imports/preview`
- `/imports/apply`
- `/imports/:id/rollback`
- `/browser/errors`
- `/evidence`
- `/reports/schedules`
- `/reports/runs`
- `/notifications/policies`
- `/render/*`
- `/canvases/*` for links/projections, with Projects owning persistence

MCP and SDK surfaces must mirror the same product operations. CLI commands can
lag hosted UI breadth, but must expose safe dry-run/import/report/probe/admin
operations needed for operators and agents.

## First Hosted Milestones

Milestone 1: cloud-safe core

- hosted auth/RBAC;
- Postgres store and migrations;
- target policy;
- HTTP/TCP monitor parity through jobs/probes;
- import preview from Projects/Domains/Servers/Deployment in dry-run mode;
- incident queue with ack/silence/maintenance/comment;
- scheduled report data model without external delivery;
- JSON Render fleet/monitor/incident specs.

Milestone 1 explicitly excludes hosted browser checks, private server-health
apply, report delivery to external channels, deployment apply, and cloud-primary
project canvases. It can include safe dry-run previews and link-only refs.

Milestone 2: imports and private probes

- import apply/rollback;
- private probe enrollment for an operator machine;
- server health checks from Open Servers;
- DNS/TLS/domain expiry checks from Open Domains;
- report delivery through authorized Mailery/Telephony/Logs refs;
- project canvas embedding through cloud-backed Projects stores.

Milestone 3: browser/page monitoring

- Playwright/container runtime;
- redaction/artifact pipeline;
- browser page check kind;
- grouped page errors;
- screenshot/trace evidence;
- retention and cost controls.

Milestone 4: broader probe fleet and polish

- additional public locations;
- quorum/down policies;
- richer dashboards and saved views;
- deployment monitors;
- self-monitoring and SLA reporting polish.

## Acceptance Criteria

- Hosted mode exposes no monitor data without auth.
- Hosted mode has one canonical `/api/v1` route map and route-to-scope tests.
- Monitor kind schemas and result schemas exist for every enabled kind.
- Public probes cannot reach denied target classes; private monitors require
  inventory provenance and private probe authorization.
- Check jobs have deterministic identity, transactional leases, fencing tokens,
  duplicate/stale rejection, and scheduler/probe race tests.
- Import preview/apply is idempotent and never copies secrets or raw local paths.
- Import rollback covers creates, updates, stale markings, provenance changes,
  and conflict decisions from before/after snapshots.
- Incidents have tested state transitions and cannot be changed by stale/duplicate
  results.
- Reports use duration-based SLA windows and authorized channel refs.
- Report runs have a durable state machine, retry/idempotency behavior, timezone
  tests, authorization recheck, and failure alarms.
- Browser checks are disabled until redacted S3 evidence and signed URL controls
  are implemented.
- High-cardinality tables have partition, index, retention, and query/load-test
  acceptance.
- Dashboards cover fleet, monitor detail, incident detail, imports, probes,
  browser errors, reports, and canvases with proper empty/error/stale states.
- JSON Render specs validate and can be embedded into Projects React Flow
  canvases without leaking private targets or secrets.
- Feature flags keep browser checks, private probes, hosted report delivery, and
  cloud-primary canvases disabled until their acceptance gates pass.
