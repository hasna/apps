---
"@hasna/messages": minor
---

Keep the SQLite engine out of the `messages` and `messages-mcp` bundles, and put the on-box store behind one gated door.

`messages` already failed closed — hosted with no credential it exits non-zero and creates no database — but the CLI and MCP bundles still linked `bun:sqlite` statically, so the engine shipped with every client and a future edit could have reached it without the opt-in.

- The on-box store is now its own module (`src/local-store.ts`), emitted as its own `dist/local-store.js`, and reachable only through `loadLocalMessagesService()` (`src/local-store-loader.ts`). The loader re-checks the same `selectsMessagesLocalStore()` gate the transport resolver uses, so it refuses unless `HASNA_MESSAGES_LOCAL=1` (alias `MESSAGES_LOCAL=1`) is set AND no authority or credential is configured in the environment — a configured environment outranks the flag, and under a hosted credential no code path can open SQLite. Local mode is unchanged for users: one `local mode` line on stderr, then the same commands.
- The loader resolves the module specifier at runtime, so the bundler cannot fold it back in: `bin/index.js` and `bin/mcp.js` now contain **zero** `bun:sqlite` references (the CLI bundle drops from 0.37 MB to 128 KB). `messages serve` loads the sibling `messages-serve` bundle the same way, so the HTTP server and its storage backends are no longer linked into the CLI either. `messages-serve` itself is unchanged and still selects PostgreSQL via `HASNA_MESSAGES_DATABASE_URL`, else its on-box SQLite.
- `./sdk`: `resolveMessagesClientStore()` is now **async** (it awaits the gated import), and the `SqliteMessagesStore` class is no longer re-exported from `@hasna/messages/sdk` — the store is server-side. Use `loadLocalMessagesService()` (also exported from `./sdk`) for the opt-in local store, or `messages-serve` for the HTTP backend. The `./sdk` bundle no longer links `bun:sqlite` at all.
- The MCP server dispatches on the resolved `transport` tag instead of `instanceof MessagesService`, which a dynamically imported class cannot satisfy.
- `src/local-store-loader.test.ts` is the ratchet: it bundles the real CLI, MCP and `./sdk` entrypoints and fails if `bun:sqlite` reappears, and it proves the loader refuses both an unconfigured environment and a hosted one that also sets the flag.
