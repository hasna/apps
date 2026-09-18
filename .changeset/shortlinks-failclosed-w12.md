---
"@hasna/shortlinks": minor
---

One door into local storage, and no sqlite engine in the client bundles
(fail-closed ruling (d), 2026-09-11).

- **`--db <path>` no longer selects the on-box SQLite store.** It was a second,
  undocumented opt-in: any `shortlinks --db ./x.db <command>` opened local
  storage even with no credential in sight. It now only chooses WHICH file an
  already-opted-in run uses; passed on its own it refuses with one line naming
  the opt-in (`--db … no longer selects the on-box SQLite store on its own: set
  HASNA_SHORTLINKS_LOCAL=1 (alias SHORTLINKS_LOCAL) to use local storage, and
  --db to choose its file.`) and opens nothing. `HASNA_SHORTLINKS_LOCAL=1`
  (alias `SHORTLINKS_LOCAL=1`) is the only door; a resolvable hosted credential
  still outranks it.
- **`bun:sqlite` is gone from the `shortlinks`, `shortlinks-mcp`, and `./sdk` entry artifacts.**
  The local store moved to `src/local-store.ts` and is reached through ONE
  gated dynamic import taken only after the opt-in was checked, and the build
  now runs with `--splitting --chunk-naming 'chunks/[name]-[hash].[ext]'`, so
  the sqlite code is emitted under `dist/chunks/` instead of `dist/cli` and
  `dist/mcp`. A hosted or refusing run never loads it.
- **Public redirect helpers no longer invent a store.**
  `createShortlinksHandler` and `serveShortlinks` require an injected store or
  the same explicit local opt-in before lazily opening SQLite. The package
  ratchets all three client entries and proves the local-store artifact still
  carries the engine as a positive control.
- **`resolveStore()` and `assertMcpBackend()` are now async** (they `await` that
  gated import); `withStore()`, the CLI and `shortlinks-mcp` are unchanged for
  callers. Importers of `resolveStore` from `@hasna/shortlinks` must `await` it.
  `LocalStore` is now exported from `./local-store.js` (still re-exported from
  the package root).
- The local-mode notice is now `shortlinks: LOCAL mode — on-box SQLite store in
  use (…)`, printed once per process, and names the actual path from the shared
  database-path resolver (`--db`, `SHORTLINKS_DB`, `SHORTLINKS_HOME`,
  `HASNA_HOME`, or the caller's `HOME`).
- The contract, README, and `.env.example` now match runtime behavior:
  `shortlinks-serve` is PostgreSQL-only and fails closed without its DSN; CLI
  and MCP are authenticated hosted clients with explicit local opt-in.
- `shortlinks-mcp` still decides its authority before the transport connects and
  exits non-zero with no credential and no opt-in — now verified with the async
  gate.
- Collection output is bounded by default: CLI JSON and MCP link/domain lists
  return at most 20 rows unless callers request an explicit positive limit, and
  MCP limits are capped at 100 rows per call.
