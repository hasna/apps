import { existsSync, readFileSync } from "node:fs";
import { getDefaultDbPath } from "./core/app-home.js";

/**
 * Canonical Hasna Service Contract v1 storage config for iapp-access.
 *
 * The server storage backend is `sqlite | postgresql` only (owner directive
 * 2026-07-29): SQLite at the effective access home — the legacy
 * `~/.hasna/access/access.db` default, resolved through `@hasna/paths`, until
 * the XDG data home is adopted (store migrated there or `HASNA_DATA_HOME` set);
 * Postgres (the app-owned cloud store) when one is. The retired
 * HASNA_ACCESS_STORAGE_MODE variable is no longer read.
 */
export const APP_NAME = "access";
export const ENV_TOKEN = "ACCESS";

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

/** Resolve the storage backend from the environment: Postgres when a DATABASE_URL is present, otherwise SQLite. */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  return databaseUrlPresent(env) ? "cloud" : "local";
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

/** Canonical local SQLite path at the root of the effective access home. */
export function defaultSqlitePath(): string {
  return getDefaultDbPath();
}

/** Resolve the SQLite path, honoring the HASNA_ACCESS_DB_PATH override (used by tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
