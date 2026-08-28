import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoLegacyStorageMode } from "./generated/storage-kit/backend.js";
import { getTreasuryAppHome } from "./core/app-home.js";

/**
 * Canonical Hasna Service Contract v1 storage config for treasury.
 *
 * The server data backend is the ONLY technical switch: a configured
 * `HASNA_TREASURY_DATABASE_URL` (or the `*_DATABASE_URL_FILE` mount) selects
 * the PostgreSQL backend; otherwise SQLite at the effective treasury data home
 * (resolved via @hasna/paths — `~/.local/share/hasna/treasury/treasury.db`
 * once the XDG home is adopted; the legacy `~/.hasna/treasury/treasury.db`
 * default until then) is authoritative. Removed legacy storage-mode variables
 * are rejected by the kit's `assertNoLegacyStorageMode` — never interpreted,
 * never mapped.
 */
export const APP_NAME = "treasury";
export const ENV_TOKEN = "TREASURY";

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
 * The active server data backend, selected by the environment: a DATABASE_URL
 * (or *_DATABASE_URL_FILE mount) present selects `postgresql`; otherwise
 * `sqlite`. Legacy storage-mode variables are rejected (migration guidance),
 * never interpreted.
 */
export function resolveServerBackend(env: Env = process.env): "sqlite" | "postgresql" {
  assertNoLegacyStorageMode(APP_NAME, env);
  return databaseUrlPresent(env) ? "postgresql" : "sqlite";
}

/** Whether a database URL is present (presence only — the value is never read to pick a backend). */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_KEYS) !== undefined || firstEnv(env, DB_URL_FILE_KEYS) !== undefined;
}

/**
 * Resolve the DSN value: prefer a `0400` file mount (`*_DATABASE_URL_FILE`),
 * else the env var. Never logs the value. Legacy storage-mode variables are
 * rejected before any DSN read.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  assertNoLegacyStorageMode(APP_NAME, env);
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) return readFileSync(filePath, "utf8").trim();
  return firstEnv(env, DB_URL_KEYS) ?? null;
}

/**
 * Scrub the DSN from process.env after the store has connected so child
 * processes and `/proc/<pid>/environ` introspection cannot read it.
 */
export function scrubDatabaseUrl(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) delete env[key];
}

/**
 * Canonical local SQLite path: at the root of the effective treasury data home
 * — `~/.local/share/hasna/treasury/treasury.db` once the XDG home is adopted
 * (via @hasna/paths), the legacy `~/.hasna/treasury/treasury.db` default until
 * then. An existing local store never becomes invisible on upgrade.
 */
export function defaultSqlitePath(env: Env = process.env): string {
  return join(getTreasuryAppHome(env), `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_TREASURY_DB_PATH override (used by tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath(env);
}
