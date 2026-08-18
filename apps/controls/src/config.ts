import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for @hasna/controls.
 *
 * The server has exactly one technical switch: `sqlite | postgresql`.
 * A configured `HASNA_CONTROLS_DATABASE_URL` (or the `_FILE` variant, or the
 * short `CONTROLS_DATABASE_URL` alias) selects PostgreSQL; otherwise the
 * on-box SQLite file at ~/.hasna/controls/controls.db is authoritative.
 * There is no deployment concept and no client-side PostgreSQL path.
 *
 * The app NEVER reads a secret VALUE to select a backend — only the *presence*
 * of a DATABASE_URL / secret-ref (see the server-backend contract).
 */
export const APP_NAME = "controls";
/** Upper-snake env prefix, e.g. CONTROLS in HASNA_CONTROLS_DATABASE_URL. */
export const ENV_PREFIX = "CONTROLS";

export type ServerBackend = "sqlite" | "postgresql";

const DB_URL_KEYS = [`HASNA_${ENV_PREFIX}_DATABASE_URL`, `${ENV_PREFIX}_DATABASE_URL`] as const;
const DB_URL_FILE_KEYS = [`HASNA_${ENV_PREFIX}_DATABASE_URL_FILE`] as const;
const DB_PATH_KEYS = [`HASNA_${ENV_PREFIX}_DB_PATH`, `${ENV_PREFIX}_DB_PATH`] as const;

type Env = Record<string, string | undefined>;

function firstEnv(env: Env, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * The server data backend, selected by environment: a DATABASE_URL (or the
 * `_FILE` variant) selects PostgreSQL; otherwise SQLite is authoritative.
 */
export function serverBackend(env: Env = process.env): ServerBackend {
  return databaseUrlPresent(env) ? "postgresql" : "sqlite";
}

/**
 * Whether a PostgreSQL database URL is present (presence only — the value is
 * never inspected). Presence is signalled by a `*_DATABASE_URL_FILE` path or
 * an inline `*_DATABASE_URL` env var.
 */
export function databaseUrlPresent(env: Env = process.env): boolean {
  if (firstEnv(env, DB_URL_FILE_KEYS) !== undefined) return true;
  if (firstEnv(env, DB_URL_KEYS) !== undefined) return true;
  return false;
}

/**
 * Resolve the PostgreSQL DSN at startup. Order:
 *   1. `HASNA_CONTROLS_DATABASE_URL_FILE` (a 0400 path),
 *   2. inline `HASNA_CONTROLS_DATABASE_URL` (local/dev only),
 * The secret-ref (`hasna/oss/controls/database-url`) is fetched by the runtime
 * task role out-of-band and surfaced as the FILE path in production.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) {
    return readFileSync(filePath, "utf-8").trim();
  }
  return firstEnv(env, DB_URL_KEYS);
}

/**
 * Scrub the inline DSN from process.env after the store has connected so that
 * child processes and later introspection (`/proc/<pid>/environ`) cannot read
 * it. The FILE path is a 0400 mount and is left intact.
 */
export function scrubDatabaseUrl(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) {
    if (env[key] !== undefined) delete env[key];
  }
}

/** Canonical local SQLite path: ~/.hasna/controls/controls.db */
export function defaultSqlitePath(): string {
  return join(homedir(), ".hasna", APP_NAME, `${APP_NAME}.db`);
}

/** Resolve the SQLite path, honoring the HASNA_CONTROLS_DB_PATH override (tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
