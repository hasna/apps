import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for @hasna/workforce.
 *
 * The server storage backend is `sqlite | postgresql` only (owner directive
 * 2026-07-29): SQLite at ~/.hasna/workforce/workforce.db when no DATABASE_URL
 * is configured; Postgres (the app-owned cloud store) when one is. The retired
 * HASNA_WORKFORCE_STORAGE_MODE variable is no longer read.
 */
export const APP_NAME = "workforce";
export const ENV_TOKEN = "WORKFORCE";

export type StorageMode = "local" | "cloud";

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

/** Resolve the storage backend from the environment: Postgres when a DATABASE_URL is present, otherwise SQLite. */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  return databaseUrlPresent(env) ? "cloud" : "local";
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
