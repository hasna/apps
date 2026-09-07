# @hasna/economy

AI coding cost tracker for Claude Code, Takumi, Codex, Gemini, OpenCode, Cursor, Pi, and Hermes. It ships as a CLI, MCP server, REST API, and native macOS menu bar app.

[![npm](https://img.shields.io/npm/v/@hasna/economy)](https://www.npmjs.com/package/@hasna/economy)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Features

- Ingests local Claude Code, Takumi, Codex, Gemini, OpenCode, Cursor, Pi, and Hermes usage.
- Tracks sessions, requests, projects, machines, models, cache tokens, cost centers, budgets, goals, and provider billing.
- Attributes usage to `@hasna/accounts` profiles when agents run under managed account/profile config dirs.
- Breaks down API-equivalent, metered API, subscription-included, estimated, and unknown cost by account, coding agent, and cost center.
- Seeds editable model pricing with input, output, cache-read, 5-minute cache-write, 1-hour cache-write, and context-cache storage rates.
- Handles tiered pricing such as Gemini long-prompt rates and OpenAI long-context rates.
- Reconciles estimates against Anthropic, OpenAI, and Gemini billing sources.
- Exposes cost data through CLI commands, an MCP server, and REST endpoints.
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

## Documentation

- [CLI reference](docs/cli.md)
- [Ingestion sources and attribution](docs/ingestion.md)
- [Configuration, storage modes, and deployment](docs/configuration.md)
- [REST API](docs/rest-api.md)
- [MCP server](docs/mcp.md)
- [OTLP/HTTP sidecar](docs/otel.md)

## CLI Output Defaults

Economy CLI commands are compact by default so agent terminals do not fill their context with full records. High-cardinality list and status commands show essential columns, cap row counts, and print a hint when more rows are available.

Use explicit detail paths when you need more:

```bash
economy sessions --limit 50
economy session <id> --verbose
economy accounts month --json
economy usage month --verbose
economy todos list --limit 20
economy todos list --verbose
economy todos show 9.7
```

`--json` remains the machine-readable path for commands that support it. Human output may truncate rows or long text; use `--json`, `--limit`, or a `show`/detail command for complete data. `--verbose` expands output where supported; its exact limit is command-specific (for example, `economy session --verbose` shows up to 50 requests).

Status subcommands follow the same rule. For example, `economy goal status` prints a compact human summary by default and `economy goal status --limit 5` or `--verbose` controls how many goals are listed.

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

The MCP server exposes read tools for summaries, sessions, machines, pricing, daily spend, budgets, goals, provider billing, usage snapshots, savings, project/account/agent/cost-center breakdowns, and subscriptions. MCP tools are compact by default for agent context safety; high-cardinality tools accept `limit`, `verbose`, or `json=true` where raw structured output is useful. It also exposes mutation tools for budgets, pricing rows, goals, and subscriptions so coding agents can manage Economy data through the same validated surface as the CLI and REST API. See the [MCP guide](docs/mcp.md) for HTTP mode and the complete tool list.

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

`economy sync --loops` reads the OpenLoops store (`~/.hasna/loops/loops.db` by default, resolved through the `@hasna/paths` XDG data home once the loops store has migrated there) in read-only mode and imports OpenLoops orchestration/judge `goal_runs.tokens_used` into `loop:*` cost centers. It intentionally does not ingest dispatched coding-agent work from loops; heavy agent spend remains captured by the existing per-agent ingesters and can be analyzed alongside loop cost centers through account/profile attribution.

Useful repair options:

```bash
economy sync --force
economy sync --recalculate
economy sync --backfill-machine
```

Full sync also imports active project metadata from `@hasna/projects` when the registry is available. The Codex source reads both `~/.codex/state_5.sqlite` and the Codewith store at `~/.codewith/state_5.sqlite` by default; explicit `HASNA_ECONOMY_CODEX_DB_PATH` and `HASNA_ECONOMY_CODEWITH_DB_PATH` values override those locations.

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

Apps and services can report usage through the local `economy-otel` sidecar:

```bash
economy-otel --port 4318
curl -X POST http://127.0.0.1:4318/ingest \
  -H 'content-type: application/json' \
  -d '{"source":"app","cost_center":"alumia","cost_center_kind":"app","project_path":"/workspace/alumia","model":"gpt-5-mini","cost_usd":0.12,"input_tokens":1200,"output_tokens":300}'
```

Accepted `/ingest` attribution fields include `cost_center`, `cost_center_kind`, `cost_center_id`, `attribution_tag`, `project_path`, `repo`, `account_key`, `account_tool`, `account_name`, `account_email`, and explicit `cost_usd`. The [OTLP guide](docs/otel.md) documents both payload formats and all aliases.

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

Estimated costs can be reconciled with provider billing in local mode:

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

The canonical API uses `/v1`; `/api` remains a legacy alias for older clients. For example:

- `GET /health`, `/ready`, `/version`, and `/openapi.json`
- `GET /v1/summary?period=today`
- `GET /v1/sessions?agent=codex&account=work@example.com&limit=20`
- `GET /v1/breakdown?by=cost-center&period=month`
- `POST /v1/budgets`, `/v1/goals`, `/v1/pricing`, and `/v1/subscriptions`
- `POST /v1/sync`, `/v1/billing/sync`, and `/v1/ingest`

See the [REST API reference](docs/rest-api.md) for every route, response envelopes, authentication, and legacy aliases. The server publishes the current generated contract at `/openapi.json`.

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

## Data Directory

Data is stored under a single data root resolved through the `@hasna/paths` resolver (XDG/macOS home layout). The legacy `~/.hasna/economy/` stays the effective root until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME`; the exact-app overrides `HASNA_ECONOMY_HOME` / `ECONOMY_HOME` win unconditionally.

The main SQLite database lives at `<data-root>/economy.db` (`~/.hasna/economy/economy.db` by default). Older `~/.economy/` data is copied on first open when the new directory does not exist. Override the database path with `HASNA_ECONOMY_DB_PATH` or `ECONOMY_DB`.

For shared deployments, CLI, MCP and `./sdk` can use a remote `/v1` API instead of local SQLite. Their credential is resolved by `@hasna/contracts` 1.0.2, fresh per request, from: an explicit `--api-key`/`--profile` argument, the env pointers `HASNA_ECONOMY_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_ECONOMY_API_KEY_REF`, the macOS Keychain item `hasna.credentials.economy.api-key`, the 0600 file `~/.hasna/economy/config/credentials` (`HASNA_ECONOMY_API_KEY=…`), then `HASNA_ECONOMY_API_KEY` in the environment. The authority follows the same ladder (`HASNA_ECONOMY_API_URL`, the Keychain `api-url` item, the credentials file) and defaults to the fleet gateway `https://api.hasna.com/economy`. Unprefixed `ECONOMY_API_URL`/`ECONOMY_API_KEY` aliases are legacy, accepted for one release.

**A run without a credential fails closed**: non-zero exit, no SQLite file, no local-fallback event. The on-box store is served only with the explicit opt-in `HASNA_ECONOMY_LOCAL=1` (alias `ECONOMY_LOCAL=1`), which prints `economy: local mode …` on stderr. See [configuration](docs/configuration.md) for the full client resolution, server auth, Postgres mode, and all environment variables.

## Development

```bash
bun test
bun run typecheck
bun run build
bun scripts/sync-openapi.ts
cd menubar && swift build -c release
```

## Open Source

Economy is published under the Apache-2.0 license. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and release hygiene, [SECURITY.md](SECURITY.md) for vulnerability reporting, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
