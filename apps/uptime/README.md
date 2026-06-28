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
uptime incidents
uptime serve --port 3899 --check
```

The local dashboard and API bind to `127.0.0.1` by default:

```bash
open http://127.0.0.1:3899
```

State-changing API requests reject cross-origin browser requests and
non-loopback mutation hosts by default. For a trusted remote bind, set
`HASNA_UPTIME_API_TOKEN` or pass `uptime serve --api-token <token>` and send
`Authorization: Bearer <token>` or `X-Uptime-Token: <token>`.
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
result tools, plus an `uptime_send_report` tool for report delivery.

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
```

## API

Run `uptime serve` and use:

- `GET /health`
- `GET /api/summary`
- `GET /api/report`
- `POST /api/report`
- `GET /api/monitors`
- `POST /api/monitors`
- `GET /api/monitors/:id`
- `PATCH /api/monitors/:id`
- `POST /api/monitors/:id/check`
- `GET /api/incidents`
- `GET /api/results?monitorId=<id>&limit=100`

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

Non-goals for this first release:

- Sentry-style exception tracing
- hosted multi-tenant SaaS billing
- synthetic browser journeys
- public incident pages
- provider-owned delivery configuration; Open Uptime sends through existing
  Mailery, Telephony, and Logs services instead of storing their credentials

## License

Apache-2.0. See [LICENSE](LICENSE).
