/**
 * Resolve a sibling module's specifier at RUNTIME, by existence.
 *
 * Why this exists: `bun build` folds `await import("./literal")` into the
 * calling bundle, so a statically-spelled dynamic import does NOT keep the
 * imported code out of `bin/index.js` / `bin/mcp.js` — it only defers when it
 * runs. Computing the specifier here leaves the bundler nothing to inline, so
 * the module is loaded from its own emitted file instead (the SQLite store
 * from `dist/local-store.js`, the HTTP server from `bin/serve.js`).
 *
 * The candidates are checked in order and by existence rather than by
 * try/catch, so a real load error inside the target module surfaces instead
 * of being swallowed as "not found". `from` is the CALLER's `import.meta.url`
 * — after bundling, the caller's URL is the bundle's URL, which is exactly
 * what the relative candidates are written against.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveRuntimeModule(
  from: string,
  candidates: readonly string[],
  what: string,
): string {
  const tried: string[] = [];
  for (const relative of candidates) {
    const url = new URL(relative, from);
    if (url.protocol !== "file:") continue;
    const file = fileURLToPath(url);
    if (existsSync(file)) return url.href;
    tried.push(file);
  }
  throw new Error(
    `messages: ${what} is not installed next to this build; looked for ${tried.join(", ")}. ` +
      `Reinstall @hasna/messages.`,
  );
}
