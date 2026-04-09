# open-economy

AI coding cost tracker — `@hasna/economy`

## Stack
- Runtime: Bun
- Language: TypeScript
- DB: SQLite via `@hasna/cloud` `SqliteAdapter` at `~/.hasna/economy/economy.db`
- CLI: Commander.js
- MCP: @modelcontextprotocol/sdk
- Server: Bun.serve
- Dashboard: React + Vite (dashboard/)
- Menubar: native SwiftUI menu bar app (menubar/)
- SDK: @hasna/economy-sdk (sdk/)

## Data Sources
- **Claude Code**: `~/.claude/telemetry/*.json` — `tengu_api_success` events with exact `costUSD`
- **Codex**: `~/.codex/state_5.sqlite` — `threads` table, cost estimated from `tokens_used × model_pricing`

## Commands
- `economy sync` — ingest latest data
- `economy today/week/month` — cost summaries
- `economy sessions` — list sessions
- `economy top` — most expensive sessions
- `economy watch` — live cost stream
- `economy budget` — manage budgets
- `economy project` — manage projects
- `economy-serve` — start REST API on port 3456
- `economy-mcp` — start MCP stdio server

## Key Files
- `src/db/database.ts` — SQLite layer
- `src/lib/pricing.ts` — model pricing table
- `src/ingest/claude.ts` — Claude Code telemetry ingest
- `src/ingest/codex.ts` — Codex SQLite ingest
- `src/ingest/gemini.ts` — Gemini CLI ingest
- `src/cli/index.ts` — CLI entry
- `src/mcp/index.ts` — MCP server
- `src/server/index.ts` — REST API
- `menubar/Sources/EconomyBar` — native SwiftUI menu bar app

## Testing
`bun test`
