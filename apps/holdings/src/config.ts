import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for the holdings app.
 *
 * Runtime storage modes are `local | cloud` ONLY (Amendment A1, PURE REMOTE):
 *   - local: SQLite at ~/.hasna/holdings/holdings.db is authoritative.
 *   - cloud: reads AND writes go directly to the app-owned cloud Postgres.
 *
 * The legacy words `remote`, `hybrid`, and `self_hosted` are accepted only as
 * deprecated aliases that normalize to `cloud` (with a warning).
 *
 * The npm package is `@hasna/holdings` and the manifest identity is `holdings`;
 * every name-derived storage token uses the bare token `holdings`: env prefix
 * HASNA_HOLDINGS_, data dir ~/.hasna/holdings, secret ref
 * hasna/oss/holdings/database-url.
 */
export const APP_NAME = "holdings";
export const ENV_TOKEN = "HOLDINGS";
export const DATABASE_URL_SECRET_REF = "hasna/oss/holdings/database-url";

export type StorageMode = "local" | "cloud";

const DEPRECATED_CLOUD_ALIASES = new Set(["remote", "hybrid", "self_hosted"]);

const MODE_KEYS = [`HASNA_${ENV_TOKEN}_STORAGE_MODE`, `${ENV_TOKEN}_STORAGE_MODE`] as const;
const DB_URL_KEYS = [`HASNA_${ENV_TOKEN}_DATABASE_URL`, `${ENV_TOKEN}_DATABASE_URL`] as const;
const DB_URL_FILE_KEYS = [`HASNA_${ENV_TOKEN}_DATABASE_URL_FILE`] as const;
const DB_PATH_KEYS = [`HASNA_${ENV_TOKEN}_DB_PATH`, `${ENV_TOKEN}_DB_PATH`] as const;

type Env = Record<string, string | undefined>;

function firstEnv(env: Env, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Whether a cloud database URL (or a `*_FILE` mount for it) is present. Presence only — value never read here. */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_KEYS) !== undefined || firstEnv(env, DB_URL_FILE_KEYS) !== undefined;
}

/**
 * Resolve the storage mode from the environment; defaults to `local`.
 * Fail-closed guard (§2.3): a DATABASE_URL present while mode resolves to local
 * is almost certainly a mis-deploy that would silently write to SQLite while a
 * cloud DB is configured — treat it as a hard startup error.
 */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  const raw = firstEnv(env, MODE_KEYS);
  let mode: StorageMode;
  if (!raw) {
    mode = "local";
  } else {
    const normalized = raw.toLowerCase().replace(/-/g, "_");
    if (normalized === "local") {
      mode = "local";
    } else if (normalized === "cloud" || DEPRECATED_CLOUD_ALIASES.has(normalized)) {
      if (DEPRECATED_CLOUD_ALIASES.has(normalized)) {
        console.warn(`[holdings] storage mode '${raw}' is a deprecated alias; normalizing to 'cloud'.`);
      }
      mode = "cloud";
    } else {
      throw new Error(`Unknown storage mode: ${raw}. Use local or cloud.`);
    }
  }

  if (mode === "local" && databaseUrlPresent(env)) {
    throw new Error(
      "Misconfiguration: a DATABASE_URL is present but storage mode resolved to 'local'. " +
        "This would silently write to SQLite while a cloud database is configured. " +
        `Set HASNA_${ENV_TOKEN}_STORAGE_MODE=cloud, or unset the DATABASE_URL.`,
    );
  }
  if (mode === "cloud" && !databaseUrlPresent(env)) {
    console.warn(
      `[holdings] cloud mode needs HASNA_${ENV_TOKEN}_DATABASE_URL (or *_FILE); ` +
        "PURE REMOTE reads/writes go to cloud Postgres.",
    );
  }
  return mode;
}

/** Canonical local SQLite path: ~/.hasna/holdings/holdings.db */
export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", APP_NAME, `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_HOLDINGS_DB_PATH override (used by tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}

/**
 * Resolve the cloud DSN via a short-lived fetch (§2.4), preferring a 0400 file
 * mount over a broadcast env var. The Secrets Manager path is a placeholder for
 * the runtime task-role fetch (not wired in local mode). Returns undefined if no
 * source is available.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch {
      throw new Error(`Could not read HASNA_${ENV_TOKEN}_DATABASE_URL_FILE at ${filePath}`);
    }
  }
  return firstEnv(env, DB_URL_KEYS);
}

/** Scrub the DSN from process.env after the store connects so child processes cannot read it (§2.4). */
export function scrubDatabaseUrl(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) {
    if (key in env) delete env[key];
  }
}
