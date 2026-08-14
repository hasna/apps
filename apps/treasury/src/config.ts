import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for treasury.
 *
 * Runtime storage modes are `local | cloud` ONLY (Amendment A1, PURE REMOTE):
 *   - local: SQLite at ~/.hasna/treasury/treasury.db is authoritative.
 *   - cloud: reads AND writes go directly to the app-owned cloud Postgres.
 *
 * The legacy words `remote`, `hybrid`, and `self_hosted` are accepted only as
 * deprecated aliases that normalize to `cloud`.
 */
export const APP_NAME = "treasury";
export const ENV_TOKEN = "TREASURY";

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

/**
 * Resolve the storage mode from the environment; defaults to `local`.
 *
 * Fail-closed misconfig guard (BUILD-SPEC §2.3): a DATABASE_URL present while
 * mode resolves to `local` is almost certainly a mis-deploy that would silently
 * write to SQLite while a cloud DB is configured — that is a hard startup error.
 */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  const raw = firstEnv(env, MODE_KEYS);
  const dsnPresent = databaseUrlPresent(env);
  let mode: StorageMode;
  if (!raw) {
    mode = "local";
  } else {
    const normalized = raw.toLowerCase().replace(/-/g, "_");
    if (normalized === "local") mode = "local";
    else if (normalized === "cloud" || DEPRECATED_CLOUD_ALIASES.has(normalized)) mode = "cloud";
    else throw new Error(`Unknown storage mode: ${raw}. Use local or cloud.`);
  }
  if (mode === "local" && dsnPresent) {
    throw new Error(
      `Fail-closed misconfig: a ${ENV_TOKEN} DATABASE_URL is present but storage mode is 'local'. ` +
        `Set HASNA_${ENV_TOKEN}_STORAGE_MODE=cloud (PURE REMOTE) or unset the DATABASE_URL. ` +
        `Refusing to silently write money/audit data to SQLite while a cloud DB is configured.`,
    );
  }
  if (mode === "cloud" && !dsnPresent) {
    console.warn(
      `[treasury] cloud mode needs HASNA_${ENV_TOKEN}_DATABASE_URL (or *_FILE); ` +
        `PURE REMOTE reads/writes go to cloud Postgres.`,
    );
  }
  return mode;
}

/** Whether a cloud database URL is present (presence only — the value is never read to pick a mode). */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_KEYS) !== undefined || firstEnv(env, DB_URL_FILE_KEYS) !== undefined;
}

/**
 * Resolve the DSN value (BUILD-SPEC §2.4): prefer a `0400` file mount
 * (`*_DATABASE_URL_FILE`), else the env var (local/dev only). Secrets-Manager
 * fetch is a cloud-runtime concern handled by the deploy module; here we only
 * read a file mount or env var. Never logs the value.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) return readFileSync(filePath, "utf8").trim();
  return firstEnv(env, DB_URL_KEYS) ?? null;
}

/**
 * Scrub the DSN from process.env after the store has connected so child
 * processes and `/proc/<pid>/environ` introspection cannot read it (§2.4).
 */
export function scrubDatabaseUrl(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) delete env[key];
}

/** Canonical local SQLite path: ~/.hasna/treasury/treasury.db */
export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", APP_NAME, `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_TREASURY_DB_PATH override (used by tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
