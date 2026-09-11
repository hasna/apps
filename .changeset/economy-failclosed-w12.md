---
"@hasna/economy": patch
---

Fail-closed residue: no `bun:sqlite` in the CLI/MCP bundles, and no silent on-box reads

- **`dist/cli/index.js` and `dist/mcp/index.js` now contain zero `bun:sqlite` references** (previously 4 and 5).
  The on-box SQLite lane moved to `src/db/sqlite-store.ts` (economy's own store) and
  `src/db/third-party-sqlite.ts` (the Codex/Codewith/Hermes/OpenLoops readers), and the agent-lifecycle
  registry's SQL engine to `src/mcp/agent-registry-store.ts`. Every client entry point reaches them through
  one awaited, lane-gated dynamic import; `build:cli`, `build:mcp` and `build:lib` run with `--splitting`
  and emit that code to `dist/chunks/`, outside `dist/cli`, `dist/mcp` and `dist/index.js`. A hosted run
  never loads a SQLite engine to read or write data. `economy-serve` and `economy-otel` keep their static
  imports — they own the on-box/server backend.
- **Account attribution no longer falls back to the on-box registry.** With no accounts credential resolved,
  `~/.hasna/accounts/accounts.json` is read only under the explicit local opt-in `HASNA_ECONOMY_LOCAL=1`
  (alias `ECONOMY_LOCAL=1`). Otherwise attribution is omitted and one line says so on stderr, instead of a
  hosted run quietly attributing fleet spend from an on-box file. The `applied`-profile lookup obeys the same
  gate.
- **`sync --loops` is refused for a hosted client.** The OpenLoops collector reads another Hasna app's on-box
  SQLite (`~/.hasna/loops/loops.db`); a client with a resolved economy credential now skips it with one
  stderr line naming the opt-in, and the hosted `/v1/ingest` push sets the same gate. The on-box lane is
  unchanged. Hosted loops usage will come from the loops API.
- The local-mode notice is now `economy: LOCAL mode (HASNA_ECONOMY_LOCAL=1) — …` (was `local mode`), matching
  the fleet wording; the accounts lane prints the same shape.
- `openDatabase()` moved from `db/database.js` to `db/sqlite-store.js` (which re-exports the whole query
  layer); `autosyncMarkerStore`, `autosyncLastRun`, `markAutoSync` and `autoSyncDue` are now async because
  they may need that gated import. Internal surfaces only — no CLI, MCP tool or `./sdk` signature changed.
