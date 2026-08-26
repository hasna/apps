import { existsSync, readFileSync } from "node:fs";
import { getDefaultBillingDbPath } from "./core/app-home.js";
import { assertNoLegacyStorageMode } from "./generated/storage-kit/backend.js";

/**
 * Canonical Hasna Service Contract v1 storage config for @hasna/billing.
 *
 * The server has one technical switch:
 *   - no DATABASE_URL: SQLite at the effective billing data home's
 *     `data/billing.db` (resolved via @hasna/paths; legacy `~/.hasna/billing`
 *     default until the XDG data home is adopted);
 *   - DATABASE_URL or DATABASE_URL_FILE: PostgreSQL.
 *
 * Removed storage variables are rejected by the vendored contract helper.
 * This module does not import @hasna/contracts at runtime.
 */
export const APP_NAME = "billing";
export const ENV_TOKEN = "BILLING";

export type StorageBackend = "sqlite" | "postgresql";

const DB_URL_KEYS = [`HASNA_${ENV_TOKEN}_DATABASE_URL`, `${ENV_TOKEN}_DATABASE_URL`] as const;
const DB_URL_FILE_KEYS = [`HASNA_${ENV_TOKEN}_DATABASE_URL_FILE`, `${ENV_TOKEN}_DATABASE_URL_FILE`] as const;
const DB_PATH_KEYS = [`HASNA_${ENV_TOKEN}_DB_PATH`, `${ENV_TOKEN}_DB_PATH`] as const;

export type Env = Record<string, string | undefined>;

function firstEnv(env: Env, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Whether a PostgreSQL database URL or mounted URL file is present. */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_FILE_KEYS) !== undefined || firstEnv(env, DB_URL_KEYS) !== undefined;
}

/** Resolve the server data backend without exposing the configured URL. */
export function resolveStorageBackend(env: Env = process.env): StorageBackend {
  assertNoLegacyStorageMode(APP_NAME, env);
  return databaseUrlPresent(env) ? "postgresql" : "sqlite";
}

/**
 * Resolve the PostgreSQL URL for connecting. Order: a `0400` file mount
 * (`*_DATABASE_URL_FILE`), then the environment variable.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  assertNoLegacyStorageMode(APP_NAME, env);
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) {
    const contents = readFileSync(filePath, "utf8").trim();
    if (contents) return contents;
  }
  return firstEnv(env, DB_URL_KEYS) ?? null;
}

/** Canonical local SQLite path: the effective data home's `data/billing.db` (resolved via @hasna/paths). */
export function defaultSqlitePath(): string {
  return getDefaultBillingDbPath();
}

/** Resolve the SQLite path, honoring the HASNA_BILLING_DB_PATH override (tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
