/**
 * The on-box SQLite store, as ONE separately emitted module.
 *
 * This is the only module in the CLIENT graph that reaches `bun:sqlite`, and
 * nothing imports it statically: the CLI, the MCP server and `./sdk` load it
 * through {@link ../local-store-loader}, which resolves its specifier at
 * RUNTIME and refuses unless the explicit `HASNA_MESSAGES_LOCAL=1` opt-in
 * selected the on-box store.
 *
 * Two properties follow, and both are the point:
 *  - `bun build` cannot fold this file into `bin/index.js` or `bin/mcp.js`
 *    (the specifier is computed), so the shipped client bins contain no
 *    SQLite engine at all — `grep -c 'bun:sqlite' bin/index.js bin/mcp.js`
 *    is 0. It is emitted as its own `dist/local-store.js`.
 *  - a hosted run can never execute it: the loader's gate is the same
 *    `selectsMessagesLocalStore()` predicate the transport resolver uses, so
 *    a configured authority or credential outranks the flag and the module is
 *    never even fetched.
 *
 * `messages-serve` does NOT come through here — the server owns its backend
 * selection (SQLite or PostgreSQL via `HASNA_MESSAGES_DATABASE_URL`) in
 * `src/server/store.ts` and imports the store directly.
 */
import { MessagesService } from "./service";
import { SqliteMessagesStore } from "./server/sqlite-store";

/**
 * Build the local domain service over the on-box SQLite store.
 *
 * `sqlitePath` is the `HASNA_MESSAGES_SQLITE_PATH` override when a caller
 * already read it; omitted, the store resolves its own default path
 * (`src/paths.ts` → `~/.hasna/messages/messages.db`).
 */
export function createLocalMessagesService(sqlitePath?: string): MessagesService {
  return new MessagesService(new SqliteMessagesStore(sqlitePath));
}

export { MessagesService, SqliteMessagesStore };
