import { readFileSync } from "node:fs";
import { resolveServerDataBackend, type ServerDataBackend } from "./generated/storage-kit/backend.js";
import { getDefaultDbPath } from "./core/app-home.js";

/**
 * Canonical Hasna Service Contract v1 storage config for consolidations.
 *
 * A server has exactly one technical switch: `sqlite | postgresql`. SQLite at
 * the effective consolidations home — the legacy `~/.hasna/consolidations/
 * consolidations.db` default, resolved through `@hasna/paths`, until the XDG
 * data home is adopted (store migrated there or `HASNA_DATA_HOME` set) — is
 * authoritative by default; a configured HASNA_CONSOLIDATIONS_DATABASE_URL (or
 * *_DATABASE_URL_FILE mount) selects PostgreSQL. Legacy storage-mode variables
 * are rejected by the vendored kit with migration guidance and are never
 * interpreted.
 */
export const APP_NAME = "consolidations";
export const ENV_TOKEN = "CONSOLIDATIONS";

const DB_URL_KEYS = [`HASNA_${ENV_TOKEN}_DATABASE_URL`, `${ENV_TOKEN}_DATABASE_URL`] as const;
const DB_URL_FILE_KEYS = [`HASNA_${ENV_TOKEN}_DATABASE_URL_FILE`, `${ENV_TOKEN}_DATABASE_URL_FILE`] as const;
const DB_PATH_KEYS = [`HASNA_${ENV_TOKEN}_DB_PATH`, `${ENV_TOKEN}_DB_PATH`] as const;

type Env = Record<string, string | undefined>;

function firstEnv(env: Env, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

// Legacy storage-mode variables were removed with the deployment-modes
// doctrine. The vendored kit no longer rejects them, so the app keeps the
// migration guard itself: a set legacy variable is a stale configuration and
// must not silently select a different backend.
function assertNoLegacyStorageMode(env: Env): void {
  const LEGACY_MODE_KEYS = [
    `HASNA_${ENV_TOKEN}_STORAGE_MODE`,
    `HASNA_${ENV_TOKEN}_MODE`,
    `${ENV_TOKEN}_STORAGE_MODE`,
    `${ENV_TOKEN}_MODE`,
  ] as const;
  const legacyKey = LEGACY_MODE_KEYS.find((key) => Object.hasOwn(env, key) && env[key] !== undefined);
  if (!legacyKey) return;
  throw new Error(
    `${legacyKey} was removed. Delete the storage-mode variable; ` +
      `set ${DB_URL_KEYS[0]} to select the postgresql server backend, ` +
      `or leave it unset for sqlite.`,
  );
}

/**
 * Resolve the active server data backend from the environment. A DATABASE_URL
 * (or *_FILE mount) selects `postgresql`; otherwise SQLite is authoritative.
 * Throws when a legacy storage-mode variable is set (the kit refuses them).
 */
export function resolveDataBackend(env: Env = process.env): ServerDataBackend {
  assertNoLegacyStorageMode(env);
  const resolution = resolveServerDataBackend(APP_NAME, env);
  if (resolution.backend === "postgresql") return "postgresql";
  // *_FILE mount variant: presence selects PostgreSQL just like the env var.
  return firstEnv(env, DB_URL_FILE_KEYS) ? "postgresql" : "sqlite";
}

/** Whether a cloud database URL is present (presence only — the value is never read here). */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_KEYS) !== undefined || firstEnv(env, DB_URL_FILE_KEYS) !== undefined;
}

/**
 * Resolve the PostgreSQL DSN value for connecting. Precedence: a `0400` file
 * mount (`*_DATABASE_URL_FILE`), then the raw env var (dev/local only). Returns
 * null when none is present. The caller MUST never log the returned value.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath) {
    try {
      const value = readFileSync(filePath, "utf8").trim();
      if (value) return value;
    } catch (error) {
      throw new Error(
        `Failed to read ${DB_URL_FILE_KEYS[0]} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return firstEnv(env, DB_URL_KEYS) ?? null;
}

/**
 * Scrub the DSN from process.env after the store connects, so child processes
 * and later introspection (/proc/<pid>/environ, docker inspect) cannot read it.
 */
export function scrubDatabaseUrl(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) delete env[key];
}

/** Canonical local SQLite path at the root of the effective consolidations home. */
export function defaultSqlitePath(): string {
  return getDefaultDbPath();
}

/** Resolve the SQLite path, honoring the HASNA_CONSOLIDATIONS_DB_PATH override (tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
