# @hasna/economy

AI coding cost tracker for Claude Code, Takumi, Codex, Gemini, OpenCode, Cursor, Pi, and Hermes. It ships as a CLI, MCP server, REST API, web dashboard, and native macOS menu bar app.

[![npm](https://img.shields.io/npm/v/@hasna/economy)](https://www.npmjs.com/package/@hasna/economy)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Features

- Ingests local Claude Code, Takumi, Codex, Gemini, OpenCode, Cursor, Pi, and Hermes usage.
- Tracks sessions, requests, projects, machines, models, cache tokens, cost centers, budgets, goals, and provider billing.
- Attributes usage to `@hasna/accounts` profiles when agents run under managed account/profile config dirs.
- Breaks down API-equivalent, metered API, subscription-included, estimated, and unknown cost by account, coding agent, and cost center.
- Links OpenLoops runs to session/thread/account/provider/model token attribution, including subscription-included, billable, and failure/retry costs.
- Reports provider readiness and subscription-aware routing for Codewith, Codex, Claude, Cursor, AICopilot, OpenCode, and Gemini.
- Seeds editable model pricing with input, output, cache-read, 5-minute cache-write, 1-hour cache-write, and context-cache storage rates.
- Handles tiered pricing such as Gemini long-prompt rates and OpenAI long-context rates.
- Reconciles estimates against Anthropic, OpenAI, and Gemini billing sources.
- Exposes cost data through CLI commands, an MCP server, REST endpoints, and a dashboard.
- Syncs project metadata from the `@hasna/projects` registry during full local sync.
- Sends budget alert webhooks and retries failed deliveries on later syncs.

## Install

```bash
bun install -g @hasna/economy
```

## Quick Start

```bash
economy sync --verbose
economy today
economy pricing list
economy serve --port 3456
```

Open the dashboard with:

```bash
economy dashboard --port 3456
```

## Agent Integrations

Use the MCP server for live cost context inside coding agents:

```bash
economy mcp --all
```

That prints install snippets for Claude Code, Codex, and Gemini:

```bash
claude mcp add --transport stdio --scope user economy -- economy-mcp
```

Codex config:

```toml
[mcp_servers.economy]
command = "economy-mcp"
args = []
```

Gemini settings:

```json
{
  "mcpServers": {
    "economy": { "command": "economy-mcp", "args": [] }
  }
}
```

The MCP server exposes read tools for summaries, sessions, machines, pricing, daily spend, budgets, goals, provider billing, usage snapshots, savings, project/account/agent/cost-center breakdowns, and subscriptions. It also exposes mutation tools for budgets, pricing rows, goals, and subscriptions so coding agents can manage Economy data through the same validated surface as the CLI and REST API.

## Ingest

Run a full local ingest:

```bash
economy sync
```

Limit ingest to one source:

```bash
economy sync --claude
economy sync --codex
economy sync --gemini
economy sync --takumi
economy sync --opencode
economy sync --cursor
economy sync --pi
economy sync --hermes
economy sync --loops
```

`economy sync --loops` reads `~/.hasna/loops/loops.db` in read-only mode and imports OpenLoops orchestration/judge `goal_runs.tokens_used` into `loop:*` cost centers. It intentionally does not ingest dispatched coding-agent work from loops; heavy agent spend remains captured by the existing per-agent ingesters and can be analyzed alongside loop cost centers through account/profile attribution.

Useful repair options:

```bash
economy sync --force
economy sync --recalculate
economy sync --backfill-machine
```

Full sync also imports active project metadata from `@hasna/projects` when the registry is available.

Account attribution is automatic when `@hasna/accounts` has a matching active, applied, or env-dir profile for the agent. Account identity is the email address plus coding agent, so `work@example.com` under Codex and Claude is reported as two accounts. You can also force attribution for a process with `ECONOMY_ACCOUNT=tool:name` or agent-specific overrides such as `ECONOMY_CODEX_ACCOUNT=codex:work`.

Session drilldown can be scoped to an account key, account name, or email:

```bash
economy sessions --account work@example.com
economy accounts month
economy breakdown --by account
```

Account breakdowns report `api_equivalent_usd` for the API list-price value of the usage, plus `billable_usd`/`metered_api_usd` for known direct API spend and `subscription_included_usd` for usage covered by a subscription.

Cost-center breakdowns group spend across loops, apps, repos, services, and teams:

```bash
economy breakdown --by cost-center
economy breakdown --by loop
economy breakdown --by app
economy breakdown --by repo
```

Exact loop attribution is available separately from the compact cost-center summary:

```bash
economy loops --since 7d --loop fleet-evaluator
economy loops --machine spark02 --provider codex --account work --json
```

`economy loops` links `loop_id`, `loop_name`, `loop_run_id`, `session_id`, `thread_id`, account, provider, model, tokens, API-equivalent USD, subscription-included USD, billable/on-demand USD, failure/retry USD, schedule, and duration. Human output is capped and compact by default; use `--limit` or `--json` for more rows.

Loop efficiency and provider routing checks are available from the existing efficiency command:

```bash
economy efficiency --since 7d --machine spark02
economy efficiency --json
```

The JSON output includes loop efficiency aggregates plus provider readiness for `codewith`, `codex`, `claude`, `cursor`, `aicopilot`, `opencode`, and `gemini`. It flags missing `CURSOR_SESSION_TOKEN`, unavailable providers, zero-cost token rows, missing pricing, and missing keys. Routing recommendations prefer subscription-backed Codewith, Codex, and Claude first, and only list third-party API candidates when key health and pricing show material savings.

Apps and services can report usage through the local `economy-otel` sidecar:

```bash
economy-otel --port 4318
curl -X POST http://127.0.0.1:4318/ingest \
  -H 'content-type: application/json' \
  -d '{"source":"app","cost_center":"alumia","cost_center_kind":"app","project_path":"/workspace/alumia","model":"gpt-5-mini","cost_usd":0.12,"input_tokens":1200,"output_tokens":300}'
```

Accepted `/ingest` attribution fields include `cost_center`, `cost_center_kind`, `cost_center_id`, `attribution_tag`, `project_path`, `repo`, `account_key`, `account_tool`, `account_name`, `account_email`, and explicit `cost_usd`.

Subscription plans can be configured locally and are used by savings calculations:

```bash
economy subscriptions set --provider cursor --plan pro --fee 20 --included 20 --agent cursor
economy subscriptions list
economy savings month
economy usage month --agent cursor
```

## Pricing

Default pricing is seeded into SQLite and can be edited locally:

```bash
economy pricing list
economy pricing set gpt-5.4 --input 2.50 --output 15 --cache-read 0.25
economy pricing set claude-sonnet-4-6 --input 3 --output 15 --cache-read 0.30 --cache-write 3.75 --cache-write-1h 6
economy pricing set gemini-3.1-pro-preview --input 2 --output 12 --cache-read 0.20 --cache-storage 4.50
```

Pricing supports separate cache-read, 5-minute cache-write, 1-hour cache-write, and context-cache storage rates. Custom user-edited rows are preserved when default pricing seeds are repaired or updated.

Provider-qualified rows such as `z-ai/glm-5.1` or `minimax/minimax-m2.7` are matched before unqualified rows, so router-specific prices can coexist with direct provider API prices.

OpenRouter-style model IDs ending in `:free` are treated as zero-cost variants even when their base model has a paid default row.

## Billing

Estimated costs can be reconciled with provider billing:

```bash
economy billing sync --days 31
economy billing show --period month
```

Supported billing sources:

- Anthropic: `HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY` or `ANTHROPIC_ADMIN_API_KEY`
- OpenAI: `HASNAXYZ_OPENAI_LIVE_ADMIN_API_KEY` or `OPENAI_ADMIN_API_KEY`
- Gemini: `HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH`, legacy `HASNAXYZ_ECONOMY_GEMINI_BILLING_EXPORT_PATH`, or `GEMINI_BILLING_EXPORT_PATH`

Gemini billing export files may be JSON arrays, JSON objects with `rows`, JSONL, or simple CSV.

## Budgets, Goals, And Alerts

```bash
economy budget set --period monthly --limit 50 --alert 80
economy budget set --agent codex --period weekly --limit 25 --alert 70
economy budget set --cost-center loop:fleet-evaluator --period weekly --limit 10
economy budget list
economy goal set --period month --limit 40
economy goal set --agent gemini --period week --limit 15
economy goal list
economy config set webhook-url https://example.com/economy-webhook
economy config webhook-test
```

Budgets can be global, project-scoped with `--project`, agent-scoped with `--agent`, cost-center scoped with `--cost-center`, or combined. Goals can be global, project-scoped, agent-scoped, or both. Valid agent scopes are `claude`, `takumi`, `codex`, `gemini`, `opencode`, `cursor`, `pi`, and `hermes`.

Budget webhooks fire after sync when the alert threshold is crossed. Failed webhook deliveries are not marked as fired, so the next sync can retry them.

## REST API

Start the server:

```bash
economy-serve --port 3456
```

Common endpoints:

- `GET /health`
- `GET /api/summary?period=today`
- `GET /api/sessions?agent=codex&account=work@example.com&limit=20`
- `GET /api/sessions/:id/requests`
- `GET /api/models`
- `GET /api/projects?period=month`
- `GET /api/breakdown?by=agent&period=month`
- `GET /api/breakdown?by=cost-center&period=month`
- `GET /api/breakdown?by=loop&period=month`
- `GET /api/loops?since=2026-06-01&machine=spark02&loop=fleet&provider=codex&account=work&model=gpt-5&limit=100`
- `GET /api/efficiency?since=2026-06-01&machine=spark02&loop=fleet&provider=codex&account=work&model=gpt-5`
- `GET /api/accounts?period=month`
- `GET /api/usage?period=month`
- `GET /api/savings?period=month`
- `GET /api/subscriptions`
- `POST /api/subscriptions`
- `DELETE /api/subscriptions/:id`
- `GET /api/budgets`
- `POST /api/budgets`
- `DELETE /api/budgets/:id`
- `GET /api/pricing`
- `POST /api/pricing`
- `DELETE /api/pricing/:model`
- `GET /api/goals`
- `POST /api/goals`
- `DELETE /api/goals/:id`
- `GET /api/billing?period=month`
- `POST /api/sync`
- `POST /api/billing/sync`

Budget, goal, and subscription mutation endpoints validate agent scopes against `claude`, `takumi`, `codex`, `gemini`, `opencode`, `cursor`, `pi`, and `hermes`.

The server also serves the built dashboard when `dashboard/dist` is present. The dashboard includes account-scoped session filtering, subscription plan create/update/delete controls in Savings, and savings/usage/account tables for subscription-aware cost analysis.

## Native macOS Menubar

The `menubar/` app is a native SwiftUI `MenuBarExtra` app, not Electron. It targets Swift 5.9+ and macOS 14+, and talks to the REST API exposed by `economy-serve`. It shows today/week/month spend, token and request counts, top agents, top accounts, top projects, active subscription plans, subscription savings, multi-agent usage snapshots, recent sessions, and fleet status. The default server URL is `http://127.0.0.1:3456`.

Build it on macOS:

```bash
cd menubar
swift build -c release
```

Release app helpers:

```bash
economy menubar install
economy menubar start
economy menubar stop
economy menubar uninstall
```

## Cloud Sync

Economy can push and pull local SQLite data through `@hasna/cloud` PostgreSQL sync:

```bash
economy cloud status
economy cloud push
economy cloud pull
economy cloud sync
```

## Data Directory

Data is stored in `~/.hasna/economy/`.

The main SQLite database lives at `~/.hasna/economy/economy.db`. Older `~/.economy/` data is auto-migrated on first open. Override the database path with `HASNA_ECONOMY_DB_PATH` or `ECONOMY_DB`.

## Development

```bash
bun test
bun run typecheck
bun run build
cd dashboard && bun run lint
cd menubar && swift build -c release
```

## HTTP mode

Shared Streamable HTTP transport for multi-agent sessions (stdio remains the default):

```bash
economy-mcp --http              # http://127.0.0.1:8860/mcp
MCP_HTTP=1 economy-mcp            # same
economy-mcp --http --port 8815    # explicit port
```

- Health: `GET http://127.0.0.1:8860/health` -> `{"status":"ok","name":"economy"}`
- Override port with `MCP_HTTP_PORT` or `--port`

## License

Apache-2.0 -- see [LICENSE](LICENSE)
