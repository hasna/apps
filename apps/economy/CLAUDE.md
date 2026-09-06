# economy

AI coding cost tracker — `@hasna/economy`

## Stack
- Runtime: Bun
- Language: TypeScript
- DB: SQLite via the in-repo `SqliteAdapter` (`src/db/sqlite-adapter.ts`) at `~/.hasna/economy/economy.db`
- CLI: Commander.js
- MCP: @modelcontextprotocol/sdk
- Server: Bun.serve
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
- `src/lib/cloud-storage.ts` — the ONE client storage seam: `@hasna/contracts` 1.0.2 resolver (Keychain item `hasna.credentials.economy.api-key`, `~/.hasna/economy/config/credentials`, `HASNA_ECONOMY_API_KEY`, default gateway `https://api.hasna.com/economy`), fail-closed on no credential, local store only via `HASNA_ECONOMY_LOCAL=1` (prints `local` on stderr)
- `menubar/Sources/EconomyBar` — native SwiftUI menu bar app

## Testing
`bun test`
