# Open Uptime

Local-first uptime and downtime monitoring for internal systems. It is closer to
Pingdom than Sentry: define HTTP or TCP monitors, run checks, track incidents,
summarize uptime, and expose the same data through a CLI, SDK, MCP server, and
local dashboard.

## Install

```bash
bun install -g @hasna/uptime
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

The `uptime cloud ...` commands generate dry-run AWS/private-probe planning artifacts
only. They do not call AWS, write secrets, or produce an approved deploy script;
current output is intentionally blocked until the infra and cloud-store evidence
in `docs/aws-deployment-runbook.md` is satisfied.

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
adapter is implemented.
`Dockerfile.package` is used by the Terraform CodeBuild image builder to build
the published npm package into ECR from inside AWS.

Private/local probes can submit signed results from another machine:

```bash
uptime probes create private-probe-01 --private-key-file ./private-probe-01.key.pem
uptime probes jobs create --monitor <monitor-id> --schedule-slot 2026-06-28T12:00:00Z
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
Hosted tokens can be provided as a single legacy token through
`HASNA_UPTIME_HOSTED_TOKEN`, or as scoped JSON through
`HASNA_UPTIME_HOSTED_TOKENS`:

```json
{
  "tokens": [
    { "token": "read-token", "scopes": ["uptime:read"], "workspaceId": "default" },
    { "token": "write-token", "scopes": ["uptime:write"], "workspaceId": "default" }
  ]
}
```

Use scoped JSON for hosted deployments. A single raw hosted token is kept only
for local compatibility and expands to broad read/write/probe/report scopes;
it is rejected when hosted auth mode or `NODE_ENV` is `production`.
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

Hosted `/api/v1/report-schedules*`, `/api/v1/report-runs`, and
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
