---
"@hasna/recordings": minor
---

recordings: keep the local database engine out of the hosted binaries, and say so when local mode is on

The CLI and the MCP server already failed closed without a credential, but both
shipped bundles still embedded `bun:sqlite` and the whole `src/db` tree, because
the LocalStore was statically reachable from `src/store.ts`. The on-box store now
lives in `src/local/sqlite-store.ts` and is reached through ONE gated dynamic
import (`src/local/load.ts`), which `build:cli` / `build:mcp` emit as a chunk
under `dist/chunks/` — `dist/cli/index.js` and `dist/mcp/index.js` no longer
contain a single reference to the sqlite driver. Which store is used is unchanged
and is still decided before any Keychain or disk read: a configured authority
outranks everything, `HASNA_RECORDINGS_LOCAL=1` (alias `RECORDINGS_LOCAL=1`) is
the only way to the on-box file, and nothing configured fails closed.

Selecting the local store now prints one line on stderr, once per process, from
every surface — the CLI and any `./sdk` consumer the first time `getStore()`
resolves, the MCP server at startup as before — instead of the MCP server being
the only surface that said it.

`describeActiveStore()` and `localStoreIsBehindSchema()` (exported from the
package root) are now `async`: their read-only inspection of an existing local
file goes through the same gated import. Their answers are unchanged; callers
must `await` them.

`recordings save --help` no longer promises "else the on-box SQLite store"; it
names the fail-closed behaviour and the opt-in.
