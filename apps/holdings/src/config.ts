import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical Hasna Service Contract v1 storage config for the holdings app.
 *
 * The server storage backend is `sqlite | postgresql` only (owner directive
 * 2026-07-29): SQLite at ~/.hasna/holdings/holdings.db when no DATABASE_URL is
 * configured; Postgres (the app-owned cloud store) when one is. The retired
 * HASNA_HOLDINGS_STORAGE_MODE variable is no longer read.
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

/** Resolve the storage backend from the environment: Postgres when a DATABASE_URL is present, otherwise SQLite. */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  return databaseUrlPresent(env) ? "cloud" : "local";
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
