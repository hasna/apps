import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for consolidations.
 *
 * Runtime storage modes are `local | cloud` ONLY (Amendment A1, PURE REMOTE):
 *   - local: SQLite at ~/.hasna/consolidations/consolidations.db is authoritative.
 *   - cloud: reads AND writes go directly to the app-owned cloud Postgres.
 *
 * The legacy words `remote`, `hybrid`, and `self_hosted` are accepted only as
 * deprecated aliases that normalize to `cloud`. Mode is chosen from the mode env
 * var only; the DSN value is never read to pick a mode (presence only).
 */
export const APP_NAME = "consolidations";
export const ENV_TOKEN = "CONSOLIDATIONS";

export type StorageMode = "local" | "cloud";

const DEPRECATED_CLOUD_ALIASES = new Set(["remote", "hybrid", "self_hosted"]);

const MODE_KEYS = [`HASNA_${ENV_TOKEN}_STORAGE_MODE`, `${ENV_TOKEN}_STORAGE_MODE`] as const;
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

/** Resolve the storage mode from the environment; defaults to `local`. */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  const raw = firstEnv(env, MODE_KEYS);
  if (!raw) {
    // Fail-closed misconfig guard: a DSN present while mode resolves to local is
    // almost certainly a mis-deploy that would silently write to SQLite while a
    // cloud DB is configured. Treat it as a hard startup error.
    if (databaseUrlPresent(env)) {
      throw new Error(
        `A ${ENV_TOKEN} DATABASE_URL is present but storage mode is 'local'. This is likely a mis-deploy. ` +
          `Set ${MODE_KEYS[0]}=cloud, or unset the DATABASE_URL for local mode.`,
      );
    }
    return "local";
  }
  const normalized = raw.toLowerCase().replace(/-/g, "_");
  if (normalized === "local") {
    if (databaseUrlPresent(env)) {
      throw new Error(
        `A ${ENV_TOKEN} DATABASE_URL is present but storage mode is 'local'. This is likely a mis-deploy. ` +
          `Set ${MODE_KEYS[0]}=cloud, or unset the DATABASE_URL for local mode.`,
      );
    }
    return "local";
  }
  if (normalized === "cloud" || DEPRECATED_CLOUD_ALIASES.has(normalized)) {
    if (DEPRECATED_CLOUD_ALIASES.has(normalized)) {
      console.warn(`[consolidations] storage mode '${raw}' is a deprecated alias; treating as 'cloud'.`);
    }
    if (!databaseUrlPresent(env)) {
      console.warn(
        `[consolidations] cloud mode needs ${DB_URL_KEYS[0]} (or *_FILE); PURE REMOTE reads/writes go to cloud Postgres.`,
      );
    }
    return "cloud";
  }
  throw new Error(`Unknown storage mode: ${raw}. Use local or cloud.`);
}

/** Whether a cloud database URL is present (presence only — the value is never read here). */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_KEYS) !== undefined || firstEnv(env, DB_URL_FILE_KEYS) !== undefined;
}

/**
 * Resolve the cloud DSN value for connecting. Precedence: a `0400` file mount
 * (`*_DATABASE_URL_FILE`), then Secrets Manager (not wired in local/dev), then
 * the raw env var (dev/local only). Returns null when none is present. The
 * caller MUST never log the returned value.
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
  // Secrets Manager fetch (hasna/oss/consolidations/database-url) would go here
  // in cloud runtimes granted access; intentionally not wired for local/dev.
  return firstEnv(env, DB_URL_KEYS) ?? null;
}

/**
 * Scrub the DSN from process.env after the store connects, so child processes
 * and later introspection (/proc/<pid>/environ, docker inspect) cannot read it.
 */
export function scrubDatabaseUrl(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) delete env[key];
}

/** Canonical local SQLite path: ~/.hasna/consolidations/consolidations.db */
export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", APP_NAME, `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_CONSOLIDATIONS_DB_PATH override (tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
