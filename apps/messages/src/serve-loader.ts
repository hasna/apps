/**
 * `messages serve` — the CLI's door to the HTTP server, loaded at runtime.
 *
 * `messages-serve` is the real bin; the CLI verb is a convenience that must
 * not drag the server into the client bundle. The server owns the storage
 * backend (SQLite by default, PostgreSQL via `HASNA_MESSAGES_DATABASE_URL`),
 * so a statically-inlined `await import("../server/serve-entry")` put
 * `bun:sqlite`, the store and `pg` inside `bin/index.js` — which is exactly
 * the residue the client bins must not carry.
 *
 * Computing the specifier at runtime (see ./runtime-module.ts) leaves the
 * bundler nothing to inline: from source we load `src/server/serve-entry.ts`,
 * and from the built CLI we load the sibling `bin/serve.js` — the same bundle
 * the `messages-serve` bin runs. `serve-entry` only self-starts under
 * `import.meta.main`, so importing it is side-effect-safe.
 */
import { resolveRuntimeModule } from "./runtime-module";

/** The public shape of `src/server/serve-entry.ts`, declared rather than imported. */
interface ServeEntryModule {
  serve(): Promise<void>;
}

/**
 * Where the server entry sits RELATIVE TO THIS FILE in each shape we run in:
 *
 *   `./server/serve-entry.ts` — running from source (`bun run src/cli/index.ts`)
 *   `./serve.js`              — this loader bundled into `bin/index.js`
 *   `../bin/serve.js`         — this loader bundled into `dist/`
 */
const SERVE_ENTRY_CANDIDATES = [
  "./server/serve-entry.ts",
  "./serve.js",
  "../bin/serve.js",
] as const;

/** Load the HTTP server entry. The caller invokes `serve()`. */
export async function loadServeEntry(): Promise<ServeEntryModule> {
  const specifier = resolveRuntimeModule(
    import.meta.url,
    SERVE_ENTRY_CANDIDATES,
    "the server module (messages-serve)",
  );
  return (await import(specifier)) as ServeEntryModule;
}
