import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for @hasna/fleet.
 *
 * The server storage backend is `sqlite | postgresql` only (owner directive
 * 2026-07-29): SQLite at ~/.hasna/fleet/fleet.db when no DATABASE_URL is
 * configured; Postgres (the app-owned cloud store) when one is.
 * Legacy storage env variables are no longer read.
 *
 * IMPORTANT: fleet is read-only w.r.t. upstream monitor/logs/sessions/economy/evals
 * data — this store owns only fleet's config tables (SLOs, budgets, saved views,
 * alert thresholds, annotations). Fused observability is never persisted here.
 */
export const APP_NAME = "fleet";
export const ENV_TOKEN = "FLEET";

export type ServerDataBackend = "sqlite" | "postgresql";

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
 * read to choose a backend). Presence = a `*_DATABASE_URL_FILE` path exists OR a
 * `*_DATABASE_URL` env var is set.
 */
export function databaseUrlPresent(env: Env = process.env): boolean {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) return true;
  return firstEnv(env, DB_URL_KEYS) !== undefined;
}

/** Resolve the server data backend from the environment: PostgreSQL when a DATABASE_URL is present, otherwise SQLite. */
export function resolveServerBackend(env: Env = process.env): ServerDataBackend {
  return databaseUrlPresent(env) ? "postgresql" : "sqlite";
}

/**
 * Resolve the cloud DSN at startup, preferring the short-lived file-mounted
 * secret (0400) over the broadcast env var. Returns undefined on the sqlite backend or
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
