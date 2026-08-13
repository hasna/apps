import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for iapp-access.
 *
 * Runtime storage modes are `local | cloud` ONLY (Amendment A1, PURE REMOTE):
 *   - local: SQLite at ~/.hasna/access/access.db is authoritative.
 *   - cloud: reads AND writes go to the app-owned cloud Postgres.
 *
 * The legacy words `remote`, `hybrid`, and `self_hosted` are accepted only as
 * deprecated aliases that normalize to `cloud`.
 */
export const APP_NAME = "access";
export const ENV_TOKEN = "ACCESS";

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
  const mode = normalizeMode(raw);
  // Fail-closed misconfig guard (v2): a DATABASE_URL present but mode=local is
  // almost certainly a mis-deploy that would silently write to SQLite while a
  // cloud DB is configured. We only detect PRESENCE of a DSN, never its value.
  if (mode === "local" && databaseUrlPresent(env)) {
    throw new Error(
      `A DATABASE_URL is configured but storage mode resolved to 'local'. ` +
        `Set HASNA_${ENV_TOKEN}_STORAGE_MODE=cloud, or remove the DATABASE_URL for local mode.`,
    );
  }
  return mode;
}

function normalizeMode(raw: string | undefined): StorageMode {
  if (!raw) return "local";
  const normalized = raw.toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return "local";
  if (normalized === "cloud" || DEPRECATED_CLOUD_ALIASES.has(normalized)) return "cloud";
  throw new Error(`Unknown storage mode: ${raw}. Use local or cloud.`);
}

/** Whether a cloud database URL is present (presence only — the value is never read to choose mode). */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_FILE_KEYS) !== undefined || firstEnv(env, DB_URL_KEYS) !== undefined;
}

/**
 * Resolve the cloud DSN value (only when actually connecting a cloud store).
 * Precedence: *_DATABASE_URL_FILE (a 0400 mount) > *_DATABASE_URL env.
 * The Secrets Manager fetch path is a cloud-runtime concern handled by infra;
 * in local/dev the env/file forms are accepted. Returns undefined if none.
 */
export function resolveDatabaseDsn(env: Env = process.env): string | undefined {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) {
    const contents = readFileSync(filePath, "utf8").trim();
    if (contents) return contents;
  }
  return firstEnv(env, DB_URL_KEYS);
}

/**
 * Scrub the DSN from process.env after the store has connected so child
 * processes and later introspection cannot read it.
 */
export function scrubDatabaseDsn(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) delete env[key];
}

/** Canonical local SQLite path: ~/.hasna/access/access.db */
export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", APP_NAME, `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_ACCESS_DB_PATH override (used by tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
