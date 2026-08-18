import { resolveDataBackend, resolveDbPath, scrubDatabaseUrl } from "../config.js";
import { SqliteStore } from "./sqlite-store.js";
import type { Store } from "./store.js";

export interface OpenStoreOptions {
  /** Force a specific SQLite path (tests use ":memory:"). */
  path?: string;
}

/**
 * Open the app store for the active server data backend.
 *   - sqlite: authoritative SQLite (bun:sqlite) at the canonical path.
 *   - postgresql: PostgreSQL via the vendored kit (genuinely connects +
 *     migrates; fail-closed on connect error — never falls back to memory).
 *
 * After a successful PostgreSQL connect the DSN is scrubbed from process.env so
 * child processes / introspection cannot read it.
 */
export async function openStore(options: OpenStoreOptions = {}): Promise<Store> {
  if (options.path !== undefined) {
    return new SqliteStore(options.path);
  }
  if (resolveDataBackend() === "sqlite") {
    return new SqliteStore(resolveDbPath());
  }
  // postgresql — genuinely wired, fail-closed.
  const { PostgresStore } = await import("./postgres-store.js");
  const store = await PostgresStore.connect();
  scrubDatabaseUrl();
  return store;
}

export { resolveDataBackend };
