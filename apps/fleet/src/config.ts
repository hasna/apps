import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for @hasna/fleet.
 *
 * Runtime storage modes are `local | cloud` ONLY (Amendment A1, PURE REMOTE):
 *   - local: SQLite at ~/.hasna/fleet/fleet.db is authoritative.
 *   - cloud: reads AND writes to fleet's OWN config tables go directly to the
 *     app-owned cloud Postgres. No sync engine, no hybrid, no cache-as-mode.
 *
 * The legacy words `remote`, `hybrid`, and `self_hosted` are accepted only as
 * deprecated aliases that normalize to `cloud` (with a warning).
 *
 * IMPORTANT: fleet is read-only w.r.t. upstream monitor/logs/sessions/economy/evals
 * data — this store owns only fleet's config tables (SLOs, budgets, saved views,
 * alert thresholds, annotations). Fused observability is never persisted here.
 */
export const APP_NAME = "fleet";
export const ENV_TOKEN = "FLEET";

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
 * Whether a cloud DATABASE_URL is *present* (presence only — the value is never
 * read to choose a mode). Presence = a `*_DATABASE_URL_FILE` path exists OR a
 * `*_DATABASE_URL` env var is set.
 */
export function databaseUrlPresent(env: Env = process.env): boolean {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) return true;
  return firstEnv(env, DB_URL_KEYS) !== undefined;
}

/**
 * Resolve the storage mode from the environment; defaults to `local`.
 *
 * Fail-closed guard (v2): a DATABASE_URL present while mode resolves to `local`
 * is almost certainly a mis-deploy that would silently write to SQLite while a
 * cloud DB is configured — treat it as a hard startup error.
 */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  const raw = firstEnv(env, MODE_KEYS);
  const mode = normalizeMode(raw);

  if (mode === "cloud" && !databaseUrlPresent(env)) {
    console.warn(
      `[fleet] cloud mode needs HASNA_${ENV_TOKEN}_DATABASE_URL (or _FILE); PURE REMOTE reads/writes go to cloud Postgres.`,
    );
  }
  if (mode === "local" && databaseUrlPresent(env)) {
    throw new Error(
      `[fleet] misconfiguration: a DATABASE_URL is present but storage mode resolved to 'local'. ` +
        `Set HASNA_${ENV_TOKEN}_STORAGE_MODE=cloud, or remove the DATABASE_URL. Refusing to silently write to SQLite.`,
    );
  }
  return mode;
}

function normalizeMode(raw: string | undefined): StorageMode {
  if (!raw) return "local";
  const normalized = raw.toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return "local";
  if (normalized === "cloud") return "cloud";
  if (DEPRECATED_CLOUD_ALIASES.has(normalized)) {
    console.warn(`[fleet] deprecated storage-mode alias '${raw}' normalizes to 'cloud'.`);
    return "cloud";
  }
  throw new Error(`Unknown storage mode: ${raw}. Use local or cloud.`);
}

/**
 * Resolve the cloud DSN at startup, preferring the short-lived file-mounted
 * secret (0400) over the broadcast env var. Returns undefined in local mode or
 * when nothing is configured. The value is opaque until the store connects.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) {
    return readFileSync(filePath, "utf8").trim();
  }
  return firstEnv(env, DB_URL_KEYS);
}

/**
 * Scrub the broadcast DSN env var from process.env after the store has connected,
 * so child processes / `/proc/<pid>/environ` / `docker inspect` cannot read it.
 * (File-mounted secrets are 0400 and are not scrubbed.)
 */
export function scrubDatabaseUrlEnv(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) {
    if (env[key] !== undefined) delete env[key];
  }
}

/** Canonical local SQLite path: ~/.hasna/fleet/fleet.db */
export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", APP_NAME, `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_FLEET_DB_PATH override (used by tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
