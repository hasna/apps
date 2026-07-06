import { existsSync, readFileSync } from "node:fs";
import { getDefaultBillingDbPath } from "./core/app-home.js";

/**
 * Canonical Hasna Service Contract v1 storage config for @hasna/billing.
 *
 * Runtime storage modes are `local | cloud` ONLY (Amendment A1, PURE REMOTE):
 *   - local: SQLite at ~/.hasna/billing/billing.db is authoritative.
 *   - cloud: reads AND writes go directly to the app-owned cloud Postgres.
 *
 * `remote`, `hybrid`, `self_hosted` are deprecated aliases that normalize to
 * `cloud`. This module is a faithful, dependency-free copy of the contract's
 * mode.ts logic (BUILD-SPEC §2.3) plus the fail-closed DSN guard (§2.4). It
 * MUST NOT import @hasna/contracts (no_cloud_guard, §4.2).
 */
export const APP_NAME = "billing";
export const ENV_TOKEN = "BILLING";

export type StorageMode = "local" | "cloud";

const DEPRECATED_CLOUD_ALIASES = new Set(["remote", "hybrid", "self_hosted"]);

const MODE_KEYS = [`HASNA_${ENV_TOKEN}_STORAGE_MODE`, `${ENV_TOKEN}_STORAGE_MODE`] as const;
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

/** Resolve the storage mode from the environment; defaults to `local`. */
export function resolveStorageMode(env: Env = process.env): StorageMode {
  const raw = firstEnv(env, MODE_KEYS);
  if (!raw) return "local";
  const normalized = raw.toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return "local";
  if (normalized === "cloud" || DEPRECATED_CLOUD_ALIASES.has(normalized)) return "cloud";
  throw new Error(`Unknown storage mode: ${raw}. Use local or cloud.`);
}

/**
 * Whether a cloud database URL is present. Presence only — the value is never
 * read to select a mode (BUILD-SPEC §2.3). Checks the `*_FILE` mount and the
 * plain env var.
 */
export function databaseUrlPresent(env: Env = process.env): boolean {
  return firstEnv(env, DB_URL_FILE_KEYS) !== undefined || firstEnv(env, DB_URL_KEYS) !== undefined;
}

/**
 * Fail-closed misconfig guard (BUILD-SPEC §2.3): a DSN present while mode
 * resolves to `local` is almost certainly a mis-deploy that would silently
 * write to SQLite while a cloud DB is configured. Throw instead of falling
 * back. Never reads the secret value — only its presence.
 */
export function assertModeConsistency(env: Env = process.env): StorageMode {
  const mode = resolveStorageMode(env);
  if (mode === "local" && databaseUrlPresent(env)) {
    throw new Error(
      `A ${ENV_TOKEN} DATABASE_URL is configured but storage mode resolved to 'local'. ` +
        `This is almost certainly a mis-deploy that would silently write to SQLite while a cloud DB is set. ` +
        `Set HASNA_${ENV_TOKEN}_STORAGE_MODE=cloud, or remove the DATABASE_URL for local mode.`,
    );
  }
  return mode;
}

/**
 * Resolve the cloud DSN for connecting (BUILD-SPEC §2.4). Order: a `0400` file
 * mount (`*_DATABASE_URL_FILE`), else the env var (accepted for local/dev). In
 * a real cloud runtime a Secrets Manager fetch would slot in ahead of the env
 * var; the presence-only mode selection never depends on this value.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  const filePath = firstEnv(env, DB_URL_FILE_KEYS);
  if (filePath && existsSync(filePath)) {
    const contents = readFileSync(filePath, "utf8").trim();
    if (contents) return contents;
  }
  return firstEnv(env, DB_URL_KEYS) ?? null;
}

/**
 * Scrub the DSN from process.env after the store has connected so child
 * processes and later introspection (/proc, docker inspect) cannot read it
 * (BUILD-SPEC §2.4).
 */
export function scrubDatabaseUrl(env: Env = process.env): void {
  for (const key of DB_URL_KEYS) {
    if (key in env) delete env[key];
  }
}

/** Canonical local SQLite path: ~/.hasna/billing/billing.db */
export function defaultSqlitePath(): string {
  return getDefaultBillingDbPath();
}

/** Resolve the SQLite path, honoring the HASNA_BILLING_DB_PATH override (tests). */
export function resolveDbPath(env: Env = process.env): string {
  return firstEnv(env, DB_PATH_KEYS) ?? defaultSqlitePath();
}
