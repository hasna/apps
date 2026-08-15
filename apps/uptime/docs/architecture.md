# Architecture

Open Uptime has four public surfaces over one local service model:

- SDK: `createUptimeClient()`
- CLI: `uptimemon`
- MCP: `uptime-mcp`
- API/dashboard: `uptimemon serve`

State is stored in SQLite through `UptimeStore`. `UptimeService` owns monitor
checks, retry policy, incident reconciliation, scheduler ticks, and summaries.
The CLI, MCP server, and API call the service rather than maintaining separate
business logic.

The local HTTP API is intended for same-origin dashboard use and local
automation. State-changing API requests reject mismatched browser `Origin`
headers, and JSON mutation endpoints require `content-type: application/json`.

## Data Model

- `monitors`: configured HTTP/TCP monitors and current status.
- `check_results`: immutable check attempts after retry resolution.
- `incidents`: open/closed downtime windows per monitor.

## Check Semantics

HTTP monitors are up when the request completes before timeout and the response
status is either the configured `expectedStatus` or any 2xx/3xx status when no
specific status is configured. TCP monitors are up when a connection can be
opened before timeout.

Retries happen before a result is recorded. One stored check result represents
the final outcome for that scheduled check.

Monitor interval, timeout, and retry settings are bounded in the store so every
surface (SDK, CLI, API, and MCP) shares the same protection against runaway
checks. MCP schemas mirror those bounds for earlier validation.

`uptimePercent` is intentionally a check-count availability metric in the first
release: up stored results divided by all stored results for that monitor. It is
not elapsed-time SLA accounting. Incident windows are stored separately so a
later report can add duration-based availability without changing the check
history model.
