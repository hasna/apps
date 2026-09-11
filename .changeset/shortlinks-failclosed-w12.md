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
- **`bun:sqlite` is gone from the `shortlinks` and `shortlinks-mcp` bundles.**
  The local store moved to `src/local-store.ts` and is reached through ONE
  gated dynamic import taken only after the opt-in was checked, and the build
  now runs with `--splitting --chunk-naming 'chunks/[name]-[hash].[ext]'`, so
  the sqlite code is emitted under `dist/chunks/` instead of `dist/cli` and
  `dist/mcp`. A hosted or refusing run never loads it. `createShortlinksHandler`
  likewise opens its own SQLite store lazily, only when the caller passes no
  store.
- **`resolveStore()` and `assertMcpBackend()` are now async** (they `await` that
  gated import); `withStore()`, the CLI and `shortlinks-mcp` are unchanged for
  callers. Importers of `resolveStore` from `@hasna/shortlinks` must `await` it.
  `LocalStore` is now exported from `./local-store.js` (still re-exported from
  the package root).
- The local-mode notice is now `shortlinks: LOCAL mode — on-box SQLite store in
  use (…)`, printed once per process, and it names the actual database file
  when `--db` chose one.
- `shortlinks-mcp` still decides its authority before the transport connects and
  exits non-zero with no credential and no opt-in — now verified with the async
  gate.
