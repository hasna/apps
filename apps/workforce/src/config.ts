import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for @hasna/workforce.
 *
 * Runtime storage modes are `local | cloud` ONLY (Amendment A1, PURE REMOTE):
 *   - local: SQLite at ~/.hasna/workforce/workforce.db is authoritative.
 *   - cloud: reads AND writes go directly to the app-owned cloud Postgres.
 *
 * The legacy words `remote`, `hybrid`, and `self_hosted` are accepted only as
 * deprecated aliases that normalize to `cloud`. Mode is chosen from the mode env
 * var and the *presence* of a DATABASE_URL — never by reading a secret value.
 */
export const APP_NAME = "workforce";
export const ENV_TOKEN = "WORKFORCE";

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

/** Whether a cloud DSN is *present* (env var or a file mount). Value is never read here. */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_KEYS) !== undefined || firstEnv(env, DB_URL_FILE_KEYS) !== undefined;
}

/**
 * Resolve the storage mode from the environment; defaults to `local`.
 *
 * Fail-closed guard (v2): if a DATABASE_URL is present but mode resolves to
 * `local`, that is almost certainly a mis-deploy that would silently write to
 * SQLite while a cloud DB is configured — treat it as a hard startup error.
 */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  const raw = firstEnv(env, MODE_KEYS);
  let mode: StorageMode;
  if (!raw) {
    mode = "local";
  } else {
    const normalized = raw.toLowerCase().replace(/-/g, "_");
    if (normalized === "local") mode = "local";
    else if (normalized === "cloud" || DEPRECATED_CLOUD_ALIASES.has(normalized)) mode = "cloud";
    else throw new Error(`Unknown storage mode: ${raw}. Use local or cloud.`);
  }

  if (mode === "local" && databaseUrlPresent(env)) {
    throw new Error(
      `Refusing to start: a DATABASE_URL is present but HASNA_${ENV_TOKEN}_STORAGE_MODE is local. ` +
        `This would silently write to SQLite while a cloud database is configured. ` +
        `Set HASNA_${ENV_TOKEN}_STORAGE_MODE=cloud or unset the DATABASE_URL.`,
    );
  }
  if (mode === "cloud" && !databaseUrlPresent(env)) {
    console.warn(
      `[workforce] cloud mode needs HASNA_${ENV_TOKEN}_DATABASE_URL(_FILE); PURE REMOTE reads/writes go to cloud Postgres.`,
    );
  }
  return mode;
}

/**
 * Resolve the cloud DSN at startup, preferring a 0400 file mount over a
 * broadcast env var, and fetching a secret-ref when the runtime grants access.
 * Returns null in local mode. Secrets Manager fetch is intentionally a no-op in
 * this local-first build (documented cloud-ready seam).
 */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch (error) {
      throw new Error(`Could not read DATABASE_URL file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return firstEnv(env, DB_URL_KEYS) ?? null;
}

/**
 * After the store connects, scrub the DSN from process.env so child processes
 * and later introspection (/proc/<pid>/environ, docker inspect) cannot read it.
 */
export function scrubDatabaseUrlFromEnv(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) delete env[key];
}

/** Canonical local SQLite path: ~/.hasna/workforce/workforce.db */
export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", APP_NAME, `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_WORKFORCE_DB_PATH override (used by tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
