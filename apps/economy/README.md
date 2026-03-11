# @hasna/economy

AI coding cost tracker for Claude Code, Codex, and Gemini.

Track every dollar spent across all your AI coding sessions — per request, per session, per project, per day.

## Features

- **Claude Code** — exact costs from telemetry JSONL (`costUSD` per request)
- **Codex** — estimated costs from token count × model pricing
- **SQLite backend** — all data stored locally at `~/.economy/economy.db`
- **DB-backed pricing** — model rates editable via CLI, seeded from defaults
- **CLI** — `economy sync`, `economy today`, `economy sessions`, `economy watch`, etc.
- **Live watch** — `economy watch` streams costs as they arrive
- **Budgets** — set per-project or global budgets with alert thresholds
- **MCP server** — agents can query their own costs
- **REST API** — `economy serve` on port 3456
- **Web dashboard** — charts, sessions table, model/project breakdown
- **macOS menubar** — live cost display in your menu bar
- **SDK** — `@hasna/economy-sdk` for programmatic access

## Install

```bash
bun add -g @hasna/economy
economy sync
economy today
```

## Usage

```bash
economy sync              # ingest Claude Code + Codex data
economy today             # today's cost summary
economy week              # this week
economy month             # this month
economy sessions          # list sessions with costs
economy top               # most expensive sessions
economy watch             # live cost stream
economy breakdown         # by model/agent/project
economy budget set --period monthly --limit 100
economy budget list
economy project add /path/to/project --name "My Project"
economy pricing list
economy pricing set gpt-4o --input 2.50 --output 10.00
economy serve             # start REST API on port 3456
economy dashboard         # open web dashboard
economy mcp --all         # show MCP install commands
```

## MCP Server

```bash
claude mcp add --transport stdio --scope user economy -- economy-mcp
```

## SDK

```ts
import { EconomyClient } from '@hasna/economy-sdk'

const client = new EconomyClient()
const today = await client.getSummary('today')
console.log(`Today's cost: $${today.total_usd.toFixed(4)}`)
```

## License

Apache-2.0
