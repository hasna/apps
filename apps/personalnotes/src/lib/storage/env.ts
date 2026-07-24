// Storage configuration + engine factory for Personal Notes.
//
// Resolves the runtime placement (local | self_hosted | cloud) and the
// concrete storage engine from `HASNA_PERSONALNOTES_*` environment variables,
// following the loops resolution order. The Postgres path is loaded via dynamic
// import so the default (SQLite) code path never pulls in `pg` — the hermetic
// test suite runs with no Postgres present (hasna-storage-standard).

import { homedir } from "node:os";
import { join } from "node:path";
import type { NoteStorageContract } from "./contract.js";
import { createSqliteNoteStorage } from "./sqlite.js";

export const ENV_PREFIX = "HASNA_PERSONALNOTES_";

/** Runtime placement — a location axis, NOT the product story (hasna-deployment-doctrine). */
export type StorageMode = "local" | "self_hosted" | "cloud";
export const STORAGE_MODES: readonly StorageMode[] = ["local", "self_hosted", "cloud"];

export interface StorageConfig {
  mode: StorageMode;
  /** SQLite database path used when `mode === "local"`. */
  sqlitePath: string;
  /** Server-side Postgres DSN. Present only for a self_hosted serve/migrate process. */
  databaseUrl?: string;
  /** HTTP API base URL a client flips to for self_hosted/cloud. */
  apiUrl?: string;
  /** HTTP API key paired with `apiUrl`. */
  apiKey?: string;
}

function env(name: string, source: NodeJS.ProcessEnv): string | undefined {
  const value = source[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", "personalnotes", "personalnotes.db");
}

/**
 * Resolve {@link StorageConfig} from the environment. Precedence mirrors
 * open-loops/src/lib/mode.ts:
 *   STORAGE_MODE (explicit) > API_URL (client → HTTP) > DATABASE_URL (server → PG) > local.
 */
export function resolveStorageConfig(source: NodeJS.ProcessEnv = process.env): StorageConfig {
  const sqlitePath = env(`${ENV_PREFIX}DB_PATH`, source) ?? defaultSqlitePath();
  const databaseUrl = env(`${ENV_PREFIX}DATABASE_URL`, source);
  const apiUrl = env(`${ENV_PREFIX}API_URL`, source);
  const apiKey = env(`${ENV_PREFIX}API_KEY`, source);

  const explicit = env(`${ENV_PREFIX}STORAGE_MODE`, source);
  let mode: StorageMode;
  if (explicit && STORAGE_MODES.includes(explicit as StorageMode)) {
    mode = explicit as StorageMode;
  } else if (apiUrl) {
    // A client with an API URL configured routes over HTTP (cloud or a remote
    // self_hosted server). We do not know which from the URL alone; default to
    // self_hosted — callers who mean the Hasna SaaS set STORAGE_MODE=cloud.
    mode = "self_hosted";
  } else if (databaseUrl) {
    mode = "self_hosted";
  } else {
    mode = "local";
  }

  return {
    mode,
    sqlitePath,
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

/**
 * Build the storage engine for the resolved config.
 *
 * - `local` → SQLite at `sqlitePath`.
 * - `self_hosted`/`cloud` WITH a `databaseUrl` → live Postgres (server-side only).
 * - `self_hosted`/`cloud` WITHOUT a `databaseUrl` → fail closed: clients must use
 *   the HTTP SDK, never a direct store, to avoid split-brain state.
 */
export async function createNoteStorage(
  config: StorageConfig = resolveStorageConfig(),
): Promise<NoteStorageContract> {
  if (config.mode === "local") {
    return createSqliteNoteStorage(config.sqlitePath);
  }

  if (!config.databaseUrl) {
    throw new Error(
      `Personal Notes storage mode "${config.mode}" has no ${ENV_PREFIX}DATABASE_URL. ` +
        `Clients must route through the HTTP API (set ${ENV_PREFIX}API_URL + ${ENV_PREFIX}API_KEY ` +
        `and use the SDK); only the serve/migrate binaries hold a database URL.`,
    );
  }

  // Dynamic import keeps `pg` out of the default (SQLite) path.
  const { PgPoolExecutor } = await import("./pg-executor.js");
  const { PostgresNoteStorage } = await import("./postgres-note-storage.js");
  const executor = PgPoolExecutor.fromConnectionString({
    connectionString: config.databaseUrl,
    applicationName: "personalnotes",
  });
  return new PostgresNoteStorage(executor);
}
