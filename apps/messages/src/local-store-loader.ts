/**
 * The ONE gated door to the on-box SQLite store for every client surface.
 *
 * The CLI, the MCP server and `./sdk` never import `./local-store` (and
 * therefore never import `bun:sqlite`); they call
 * {@link loadLocalMessagesService}, which does two things a static import
 * cannot:
 *
 *  1. **It refuses unless the opt-in selected local.** The gate is the same
 *     `selectsMessagesLocalStore()` predicate the transport resolver uses:
 *     `HASNA_MESSAGES_LOCAL=1` (alias `MESSAGES_LOCAL=1`) AND no authority or
 *     credential configured in the environment. A configured environment
 *     outranks the flag, so under a hosted credential no code path can open
 *     SQLite — the call throws one clear line instead.
 *  2. **It keeps the SQLite engine out of the shipped client bins.** The
 *     module specifier is computed at runtime (see ./runtime-module.ts), so
 *     `bun build` leaves the import alone instead of folding
 *     `src/local-store.ts` into `bin/index.js` / `bin/mcp.js`. The store is
 *     emitted once, as its own `dist/local-store.js`, and loaded from there.
 *
 * Nothing in this file's own import graph touches `bun:sqlite`.
 */
import { resolveRuntimeModule } from "./runtime-module";
import { selectsMessagesLocalStore } from "./sdk/resolve.js";
import { MESSAGES_LOCAL_OPT_IN_ENV_KEYS } from "./sdk/client-types.js";
import type { MessagesClientEnv } from "./sdk/client-types.js";
import type { MessagesService } from "./service";

/** The public shape of `src/local-store.ts`, declared rather than imported. */
interface LocalStoreModule {
  createLocalMessagesService(sqlitePath?: string): MessagesService;
}

/**
 * Where the emitted local-store module sits RELATIVE TO THIS FILE in each
 * shape we run in:
 *
 *   `./local-store.ts`       — running from source (`bun run src/cli/index.ts`, `bun test`)
 *   `./local-store.js`       — this loader bundled into `dist/index.js`
 *   `../local-store.js`      — this loader bundled into `dist/sdk/index.js`
 *   `../dist/local-store.js` — this loader bundled into `bin/index.js` / `bin/mcp.js`
 */
const LOCAL_STORE_CANDIDATES = [
  "./local-store.ts",
  "./local-store.js",
  "../local-store.js",
  "../dist/local-store.js",
] as const;

/** The refusal a hosted (or unconfigured) run gets if it ever asks for the on-box store. */
function refusal(): Error {
  return new Error(
    `messages: refusing to open the on-box SQLite store — it is reachable only under ` +
      `${MESSAGES_LOCAL_OPT_IN_ENV_KEYS[0]}=1 (alias ${MESSAGES_LOCAL_OPT_IN_ENV_KEYS[1]}=1) with no ` +
      `authority or credential configured in the environment. A configured environment outranks the flag.`,
  );
}

/**
 * Load the local domain service over the on-box SQLite store — the only way
 * a client surface may reach it.
 *
 * THROWS when the environment does not select local mode, so a mis-wired
 * caller fails closed instead of quietly opening a database.
 */
export async function loadLocalMessagesService(
  env: MessagesClientEnv = process.env,
  sqlitePath?: string,
): Promise<MessagesService> {
  if (!selectsMessagesLocalStore(env)) throw refusal();
  const specifier = resolveRuntimeModule(
    import.meta.url,
    LOCAL_STORE_CANDIDATES,
    "the on-box store module (local-store)",
  );
  const module = (await import(specifier)) as LocalStoreModule;
  return module.createLocalMessagesService(sqlitePath);
}
