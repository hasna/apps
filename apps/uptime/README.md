# Open Uptime

Local-first uptime and downtime monitoring for internal systems. It is closer to
Pingdom than Sentry: define HTTP or TCP monitors, run checks, track incidents,
summarize uptime, and expose the same data through a CLI, SDK, MCP server, and
local dashboard.

## Install

```bash
bun install -g @hasna/uptime
npm install -g @hasna/uptime
```

The published CLI and MCP binaries run on Bun. The `npm install` path is useful
for npm-managed global packages, but `bun` must still be installed and available
on `PATH` before running `uptime` or `uptime-mcp`.

Update an existing global install with the same command and an explicit version
or `latest` tag:

```bash
bun install -g @hasna/uptime@latest
npm install -g @hasna/uptime@latest
uptime --version
```

Local data is stored in `~/.hasna/uptime/uptime.db`. Set
`HASNA_UPTIME_HOME` or `HASNA_UPTIME_DB` to isolate data for tests or another
profile.

## CLI

```bash
uptime init
uptime add api --url https://example.com/health --interval 60 --timeout 5000
uptime add postgres --tcp db.internal --port 5432
uptime list
uptime check --all
uptime summary
uptime report --dry-run
uptime report --email ops@example.com --from alerts@example.com --send-key "$MAILERY_SEND_KEY"
uptime report --sms +15550000001 --logs
uptime report-schedules create ops --interval 3600 --email ops@example.com --from alerts@example.com
uptime report-schedules run-due
uptime report-schedules runs
uptime audit
uptime cloud plan --json
uptime cloud memory-preflight --healthcheck --json
uptime cloud postgres-plan --json
uptime cloud postgres-plan --sql
uptime cloud workers preflight --role public-probe --json
uptime cloud public-checks worker --workspace-id ws_internal --max-iterations 1 --hosted-sqlite-db /data/uptime/uptime.db --allow-public-checks-bridge
uptime cloud private-probe-config --probe-id prb_private_01 --machine-id private-probe-01 --json
uptime cloud private-probe-config --probe-id prb_private_01 --machine-id private-probe-01 --env --allow-blocked-env
uptime incidents
uptime serve --port 3899 --check
```

Scheduled reports persist endpoint and recipient configuration, but not send
keys or API tokens. Configure `MAILERY_SEND_KEY`, `HASNA_MAILERY_SEND_KEY`,
`HASNA_LOGS_API_TOKEN`, or the matching service env vars before scheduled runs.
Private probe env output is blocked by default while hosted probe routes remain
fail-closed; `--allow-blocked-env` is for review artifacts only, not startup.

The `uptime cloud plan` and `uptime cloud private-probe-config` commands
generate dry-run AWS/private-probe planning artifacts. They do not call AWS,
write secrets, or produce an approved deploy script; current output is
intentionally blocked until the repository deployment runbook, infra, and
cloud-store evidence are satisfied. The `cloud public-checks` and
`cloud edge-smoke` commands are operational smokes: they perform bounded hosted
checks or HTTP requests and must be run only with approved private evidence
handling.

Deployment review artifacts live in `Dockerfile` and `infra/aws`. The Terraform
desired counts default to zero, and `uptime cloud plan --json` exposes the
format/init/validate/plan commands with `applyAllowed: false`. The first
protected access path uses the CloudFront default HTTPS domain with ALB origin
ingress restricted to CloudFront. The hosted web task must set
`HASNA_UPTIME_ALLOWED_ORIGINS` to the public HTTPS edge origin so same-origin
browser mutations still pass through the selected ALB origin path. The default
zero-count bridge keeps `cloudfront_origin_protocol_policy = "http-only"`;
token-bearing live traffic needs `https-only` with an origin hostname that
resolves to the ALB and matches `certificate_arn`, or an explicit risk
acceptance. Hosted AWS runtime state currently uses explicit EFS-backed SQLite via
`HASNA_UPTIME_HOSTED_SQLITE_DB=/data/uptime/uptime.db` for one protected web
task maximum; do not set `HASNA_UPTIME_DATABASE_URL` until the async Postgres
adapter is implemented for the full service store. The Postgres report-runtime
helper can write finished report metadata, delivery-attempt state, retry
metadata, and redacted artifact metadata refs for review, but it is not a
hosted service-store promotion gate. `uptime cloud postgres-plan` exposes the reviewed
target schema, workspace RLS policy shape, tombstones, audit tables,
idempotency fields, and check-job lease tables for private review without
connecting to Postgres or printing credentials.
The interim hosted SQLite bridge now also requires explicit workspace context
for hosted store/API reads and mutations, hides tombstoned monitors from active
queries, records hosted monitor deletes in `sync_tombstones`, and keeps active
monitor names unique only among non-deleted rows.
`uptime cloud workers preflight --role <role>` reports machine-checkable
blockers for hosted scheduler, public-probe, reporter, and migration roles.
`--healthcheck` is readiness-like and exits non-zero while `canStart=false`.
Their `run` entrypoints fail closed until Postgres, check jobs, channel refs,
authoritative report schedule/run claiming, object artifact storage, audit
export, alarms, and migration plans exist. Reporter preflight may show narrower
Postgres metadata capabilities as implemented while still returning
`canStart=false`.
`uptime cloud public-checks run-due` and `worker` are only bounded EFS SQLite
bridge paths around hosted HTTP/TCP smoke checks, and they require
`--allow-public-checks-bridge` or `HASNA_UPTIME_ALLOW_PUBLIC_CHECKS_BRIDGE=1`.
They are not the final cloud `check_jobs`/lease/fencing protocol.
`uptime cloud edge-smoke` is the repeatable protected-web promotion smoke. It
checks `/health`, authenticated `/ready`, unauthenticated denial, scoped reads,
wrong-workspace denial, wrong-scope and denied-origin mutations, fail-closed
hosted report/probe/import/check routes, optional write-token create/delete
cleanup, and direct-origin denial without printing token values. A zero-count
deployment is only provisioned infrastructure; do not describe it as live
protected web access until this smoke passes against a running web task with
`promotionReady=true`.
`Dockerfile.package` is used by the Terraform CodeBuild image builder to build
the published npm package into ECR from inside AWS.

The npm package includes runtime code, CLI/MCP/SDK exports, legal/security docs,
Docker build inputs, and the reusable `infra/aws` Terraform module. Internal
operator runbooks, cloud architecture notes, and deployment evidence records
stay in the repository and are not included in the published tarball.

`uptime cloud memory-preflight --json` prints a redacted report and exits `0`
for inspection even when blocked. Use
`uptime cloud memory-preflight --healthcheck --json` as the fail-closed gate for
calling Spark01 or the Hasna project/task memory stack cloud-primary. It reports
only service names, configured environment variable names, booleans, and
blockers. It checks env presence but does not retain or print database URLs, API
keys, secret refs, notes, mementos, messages, knowledge chunks, Terraform state,
or monitor private targets. `--healthcheck` exits non-zero until Projects,
Todos, Conversations, Mementos, Knowledge, and the Spark01 machine lease checks
all have audited cloud-primary evidence. Notes and Open Uptime are harder
blockers: they remain blocked until Notes has audited cloud metadata/object
storage and Open Uptime has the async Postgres runtime adapter, leases, report
storage, and probe fencing.
Machine evidence is bound to the selected `--machine-id`: `spark01` uses
`HASNA_UPTIME_SPARK01_*` proof flags, while another machine such as `worker02`
must use its own `HASNA_UPTIME_WORKER02_*` proof flags. Secret-looking or
malformed machine IDs are rejected and rendered only as `invalid-machine-id`.

Private/local probes can submit signed results from another machine:

```bash
uptime probes create private-probe-01 \
  --private-key-file ./private-probe-01.key.pem \
  --probe-class private \
  --probe-location spark01 \
  --machine-id spark01
uptime probes jobs create \
  --monitor <monitor-id> \
  --schedule-slot 2026-06-28T12:00:00Z \
  --probe-class private \
  --probe-locations spark01
uptime probes jobs claim <job-id> --probe <probe-id>
uptime probes submit \
  --probe <probe-id> \
  --job <job-id> \
  --schedule-slot 2026-06-28T12:00:00Z \
  --fencing-token <claim-fencing-token> \
  --monitor <monitor-id> \
  --monitor-revision <claim-monitor-revision> \
  --private-key-file ./private-probe-01.key.pem \
  --status up
```

Local probe jobs use deterministic identity over workspace, monitor revision,
schedule slot, and probe policy; same-probe claim retries keep the active
fencing token instead of rotating it.
Generated probe private keys are written only to the explicit
`--private-key-file` path. API and MCP probe enrollment require caller-managed
public keys.

The local dashboard and API bind to `127.0.0.1` by default:

```bash
open http://127.0.0.1:3899
```

State-changing API requests reject cross-origin browser requests and
non-loopback mutation hosts by default. For a trusted remote bind, set
`HASNA_UPTIME_API_TOKEN` or pass `uptime serve --api-token <token>` and send
`Authorization: Bearer <token>` or `X-Uptime-Token: <token>`.
Hosted mode additionally accepts comma-separated public origins from
`HASNA_UPTIME_ALLOWED_ORIGINS` for deployments behind a TLS-terminating edge.
Hosted tokens must be provided as scoped JSON through
`HASNA_UPTIME_HOSTED_TOKENS`, or as a JSON-compatible
`HASNA_UPTIME_HOSTED_TOKEN` value:

```json
{
  "tokens": [
    { "token": "read-token", "scopes": ["uptime:read"], "workspaceId": "default" },
    { "token": "write-token", "scopes": ["uptime:write"], "workspaceId": "default" }
  ]
}
```

Use scoped JSON for hosted deployments. A single raw hosted token is rejected
by default. It is kept only for local compatibility behind
`HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN=1`, expands to broad
read/write/probe/report scopes, and is still rejected when hosted auth mode or
`NODE_ENV` is `production`.
Endpoints that accept request bodies require `content-type: application/json`.

## Uptime Semantics

The first release reports `uptimePercent` as the percentage of stored check
results that are up for a monitor across the local SQLite history. It is a
check-count availability metric, not elapsed-time SLA accounting. Incident rows
capture downtime windows separately and are the basis for future time-window
availability reports.

Monitor settings are bounded to keep local checks predictable:

- interval: 1 to 86,400 seconds
- timeout: 1 to 60,000 milliseconds
- retries: 0 to 10 per check

## MCP

```bash
uptime-mcp
```

Example Claude Code registration:

```bash
claude mcp add --scope user uptime -- uptime-mcp
```

The MCP server exposes monitor CRUD, check execution, summary, incident, and
result tools, an `uptime_send_report` tool for one-shot report delivery,
scheduled report tools, local audit event reads, and local probe tools for
public-key enrollment, job creation/claiming, and signed result submission.

## SDK

```ts
import { createUptimeClient } from "@hasna/uptime";

const uptime = createUptimeClient();
await uptime.createMonitor({
  name: "api",
  kind: "http",
  url: "https://example.com/health",
  intervalSeconds: 60,
});

await uptime.checkAll();
console.log(await uptime.summary());

await uptime.sendReport({
  email: {
    apiUrl: "http://localhost:3900",
    sendKey: process.env.MAILERY_SEND_KEY,
    from: "alerts@example.com",
    to: "ops@example.com",
  },
  sms: { apiUrl: "http://localhost:19451", to: "+15550000001" },
  logs: { apiUrl: "http://localhost:3460", apiKey: process.env.HASNA_LOGS_API_TOKEN, projectId: "open-uptime" },
});

const schedule = uptime.createReportSchedule({
  name: "ops",
  intervalSeconds: 3600,
  channels: {
    email: { from: "alerts@example.com", to: "ops@example.com" },
    logs: { apiUrl: "http://localhost:3460", projectId: "open-uptime" },
  },
});
await uptime.runReportSchedule(schedule.id);
```

Probe agents can import signing helpers from `@hasna/uptime/probes`.

## API

Run `uptime serve` and use:

- `GET /health`
- `GET /ready`
- `GET /api/summary`
- `GET /api/report`
- `POST /api/report`
- `GET /api/report-schedules`
- `POST /api/report-schedules`
- `GET /api/report-schedules/:id`
- `PATCH /api/report-schedules/:id`
- `DELETE /api/report-schedules/:id`
- `POST /api/report-schedules/:id/run`
- `POST /api/report-schedules/run-due`
- `GET /api/report-runs?scheduleId=<id>&limit=100`
- `GET /api/audit-events?resourceType=<type>&resourceId=<id>`
- `GET /api/monitors`
- `POST /api/monitors`
- `GET /api/monitors/:id`
- `PATCH /api/monitors/:id`
- `POST /api/monitors/:id/check`
- `GET /api/incidents`
- `GET /api/results?monitorId=<id>&limit=100`
- `GET /api/probes`
- `POST /api/probes`
- `POST /api/probes/jobs`
- `GET /api/probes/jobs/:id`
- `POST /api/probes/jobs/:id/claim`
- `POST /api/probes/results`

Hosted `/api/v1/probes*` routes currently fail closed with `501` until cloud
check jobs, workspace stores, and audit logging are implemented. Local job reads
redact fencing tokens; the claim response is the only API response that returns
the active fencing token.

Hosted `POST /api/v1/report`, `/api/v1/report-schedules*`, `/api/v1/report-runs`, and
`/api/v1/audit-events` also fail closed until cloud channel refs, workspace
stores, and cloud audit logging are implemented.

## Scope

First release:

- HTTP/HTTPS checks with expected status handling
- TCP checks
- interval, timeout, retry, and enable/disable settings
- SQLite persistence
- incident open/close lifecycle
- uptime percentage and latency summaries
- local dashboard/API
- CLI, MCP, SDK, and tests
- Optional report delivery through Open Mailery, Open Telephony, and Open Logs
- Scheduled report definitions, report run history, and local audit events
- Private/local probe identities, check jobs, signed submissions, and fenced
  result recording for internal agents

Non-goals for this first release:

- Sentry-style exception tracing
- hosted multi-tenant SaaS billing
- hosted probe ingest before cloud check jobs and workspace-scoped storage
- synthetic browser journeys
- public incident pages
- provider-owned delivery configuration; Open Uptime sends through existing
  Mailery, Telephony, and Logs services instead of storing their credentials

## License

Apache-2.0. See [LICENSE](LICENSE).
