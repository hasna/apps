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
- SDK: the `./sdk` export subpath of this one package (`src/index.ts` — the Store abstraction). There is no separate `-sdk` package.

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
- `src/db/database.ts` — the SQL query layer (pure functions over a handle; NO `bun:sqlite` import)
- `src/db/sqlite-store.ts` — `openDatabase()` + the query-layer re-export: the ONE module that opens economy's own SQLite.
  Clients reach it through a gated dynamic import inside the local lane, so `dist/cli`, `dist/mcp` and `dist/index.js`
  carry no `bun:sqlite` (the code lands in `dist/chunks/`). `economy-serve` / `economy-otel` import it statically.
- `src/db/third-party-sqlite.ts` — the only other `bun:sqlite` importer: read-only handles on OTHER tools' stores
  (Codex, Codewith, Hermes, OpenLoops); loaded dynamically by the collectors. The OpenLoops read is refused for a
  hosted client (cross-app on-box read).
- `src/lib/pricing.ts` — model pricing table
- `src/ingest/claude.ts` — Claude Code telemetry ingest
- `src/ingest/codex.ts` — Codex SQLite ingest
- `src/ingest/gemini.ts` — Gemini CLI ingest
- `src/cli/index.ts` — CLI entry
- `src/mcp/index.ts` — MCP server
- `src/server/index.ts` — REST API
- `src/lib/cloud-storage.ts` — the ONE client storage seam: `@hasna/contracts` 1.0.2 resolver (Keychain item `hasna.credentials.economy.api-key`, `~/.hasna/economy/config/credentials`, `HASNA_ECONOMY_API_KEY`, default gateway `https://api.hasna.com/economy`), fail-closed on no credential, local store only via `HASNA_ECONOMY_LOCAL=1` (prints one `economy: LOCAL mode …` line on stderr)
- `menubar/Sources/EconomyBar` — native SwiftUI menu bar app

## Testing
`bun test`
