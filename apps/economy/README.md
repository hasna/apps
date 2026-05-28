# @hasna/economy

AI coding cost tracker for Claude Code, Takumi, Codex, and Gemini. It ships as a CLI, MCP server, REST API, web dashboard, and native macOS menu bar app.

[![npm](https://img.shields.io/npm/v/@hasna/economy)](https://www.npmjs.com/package/@hasna/economy)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Features

- Ingests local Claude Code, Takumi, Codex, and Gemini CLI usage.
- Tracks sessions, requests, projects, machines, models, cache tokens, budgets, goals, and provider billing.
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

The MCP server exposes read tools for summaries, sessions, machines, pricing, daily spend, budgets, goals, and provider billing. It also exposes mutation tools for budgets, pricing rows, and goals so Claude Code, Codex, and Gemini can manage Economy data through the same validated surface as the CLI and REST API.

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
```

Useful repair options:

```bash
economy sync --force
economy sync --recalculate
economy sync --backfill-machine
```

Full sync also imports active project metadata from `@hasna/projects` when the registry is available.

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
economy budget list
economy goal set --period month --limit 40
economy goal set --agent gemini --period week --limit 15
economy goal list
economy config set webhook-url https://example.com/economy-webhook
economy config webhook-test
```

Budgets and goals can be global, project-scoped with `--project`, agent-scoped with `--agent`, or both. Valid agent scopes are `claude`, `takumi`, `codex`, and `gemini`.

Budget webhooks fire after sync when the alert threshold is crossed. Failed webhook deliveries are not marked as fired, so the next sync can retry them.

## REST API

Start the server:

```bash
economy-serve --port 3456
```

Common endpoints:

- `GET /health`
- `GET /api/summary?period=today`
- `GET /api/sessions?agent=codex&limit=20`
- `GET /api/sessions/:id/requests`
- `GET /api/models`
- `GET /api/projects`
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

Budget and goal mutation endpoints validate agent scopes against `claude`, `takumi`, `codex`, and `gemini`.

The server also serves the built dashboard when `dashboard/dist` is present.

## Native macOS Menubar

The `menubar/` app is a native SwiftUI `MenuBarExtra` app, not Electron. It targets Swift 5.9+ and macOS 14+, and talks to the REST API exposed by `economy-serve`. The default server URL is `http://127.0.0.1:3456`.

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
economy-mcp --http              # http://127.0.0.1:8815/mcp
MCP_HTTP=1 economy-mcp            # same
economy-mcp --http --port 8815    # explicit port
```

- Health: `GET http://127.0.0.1:8815/health` → `{"status":"ok","name":"economy"}`
- Override port with `MCP_HTTP_PORT` or `--port`

## License

Apache-2.0 -- see [LICENSE](LICENSE)
