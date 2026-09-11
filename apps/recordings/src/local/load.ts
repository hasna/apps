// The ONE gated dynamic import of the on-box SQLite store.
//
// Every client surface (CLI, MCP, `./sdk`, the package root) reaches the local
// store through here and nowhere else. Two properties depend on that:
//
//  1. POLICY IS DECIDED FIRST. Callers only get here once
//     `selectsRecordingsLocalStore` (src/lib/local-opt-in.ts) has answered YES
//     on the environment alone — no Keychain read, no credential file, and
//     never as a fallback from a failed hosted resolution. A hosted or
//     unconfigured run never evaluates this module's import.
//  2. THE ENGINE STAYS OUT OF THE HOSTED BINARIES. Because the import is
//     dynamic and `build:cli` / `build:mcp` run with `--splitting`, the
//     sqlite-carrying module is emitted as a chunk under `dist/chunks/` rather
//     than inlined into `dist/cli/index.js` / `dist/mcp/index.js`.
//
// The promise is cached, so the chunk is parsed at most once per process.

export type LocalSqliteStoreModule = typeof import("./sqlite-store.js");

let pending: Promise<LocalSqliteStoreModule> | null = null;

/** Load (once per process) the on-box SQLite store module. */
export function loadLocalSqliteStore(): Promise<LocalSqliteStoreModule> {
  pending ??= import("./sqlite-store.js");
  return pending;
}

/** Test helper: forget the loaded module so a fresh import can be observed. */
export function __resetLocalSqliteStoreLoad(): void {
  pending = null;
}
