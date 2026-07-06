import { resolveDbPath, resolveStorageMode, scrubDatabaseUrl, type StorageMode } from "../config.js";
import { SqliteStore } from "./sqlite-store.js";
import type { Store } from "./store.js";

export interface OpenStoreOptions {
  /** Force a specific SQLite path (tests use ":memory:"). Implies local mode. */
  path?: string;
}

/**
 * Open the app store for the active runtime mode.
 *   - local: authoritative SQLite (bun:sqlite).
 *   - cloud: PURE-REMOTE Postgres via the vendored kit (genuinely connects +
 *     migrates; fail-closed on connect error — never falls back to memory).
 *
 * After a successful cloud connect the DSN is scrubbed from process.env so child
 * processes / introspection cannot read it.
 */
export async function openStore(options: OpenStoreOptions = {}): Promise<Store> {
  if (options.path !== undefined) {
    return new SqliteStore(options.path);
  }
  const mode: StorageMode = resolveStorageMode();
  if (mode === "local") {
    return new SqliteStore(resolveDbPath());
  }
  // cloud — genuinely wired, fail-closed.
  const { PostgresStore } = await import("./postgres-store.js");
  const store = await PostgresStore.connect();
  scrubDatabaseUrl();
  return store;
}

export { resolveStorageMode };
