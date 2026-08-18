// Server data-backend resolution for the Hasna Service Contract v1.
//
// The server has exactly one technical switch: `sqlite | postgresql`.
// A configured `HASNA_<NAME>_DATABASE_URL` (or the short alias) selects
// PostgreSQL; otherwise the on-box SQLite file is authoritative. There is no
// deployment/storage mode and no client-side PostgreSQL path.

import { type ServerDataBackend } from "./schemas";
import { envToken, type Env } from "./env-token";

export { envToken };
export type { Env };

export interface ServerDataBackendEnvKeys {
  /** `HASNA_<NAME>_DATABASE_URL` then the optional `<NAME>_DATABASE_URL` alias. */
  databaseUrlKeys: string[];
}

/** Resolve the canonical environment keys for an app's server database. */
export function serverDataBackendEnvKeys(name: string): ServerDataBackendEnvKeys {
  const token = envToken(name);
  return {
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`, `${token}_DATABASE_URL`],
  };
}

function legacyModeKeys(name: string): string[] {
  const token = envToken(name);
  return [
    `HASNA_${token}_STORAGE_MODE`,
    `HASNA_${token}_MODE`,
    `${token}_STORAGE_MODE`,
    `${token}_MODE`,
  ];
}

function firstEnv(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

function firstDefinedEnvKey(env: Env, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) return key;
  }
  return null;
}

/**
 * A DEFINED-but-blank database URL: an empty value, whitespace, or a
 * quoted-whitespace value (`'"   "'`). The operator declared the variable and
 * denied it a value — a silent fallback to the on-box sqlite store is exactly
 * the failure this check exists to close, and neither is it a usable
 * connection string.
 */
function isBlankDatabaseUrlValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim().length === 0;
  }
  return false;
}

/**
 * The database URL keys that are DEFINED in the environment, with their
 * declared (untrimmed) values. Presence means the property exists, whatever
 * its value; the caller decides what a blank value means.
 */
function definedDatabaseUrlEntries(
  env: Env,
  keys: readonly string[],
): Array<{ key: string; value: string }> {
  return keys
    .filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined)
    .map((key) => ({ key, value: String(env[key]) }));
}

/**
 * Reject blank declarations and conflicting aliases. Names the KEYS only —
 * a connection string can embed credentials and is never rendered.
 *
 * - a defined-but-blank DATABASE_URL fails closed (it must not silently
 *   select sqlite, and it is not a usable connection string);
 * - canonical and short aliases both defined with DIFFERENT values are
 *   ambiguous and rejected — never silently first-wins;
 * - identical values in both aliases are redundant but coherent and accepted.
 */
function assertUsableDatabaseUrl(
  name: string,
  entries: Array<{ key: string; value: string }>,
): void {
  const blank = entries.filter((entry) => isBlankDatabaseUrlValue(entry.value));
  if (blank.length > 0) {
    throw new Error(
      `${blank.map((entry) => entry.key).join(" and ")} is set but blank. ` +
        `A defined database URL must be a real PostgreSQL connection string. ` +
        `Unset it to select the on-box sqlite store for '${name}'.`,
    );
  }
  const usable = entries
    .map((entry) => ({ key: entry.key, value: entry.value.trim() }))
    .filter((entry) => entry.value.length > 0);
  if (usable.length > 1 && new Set(usable.map((entry) => entry.value)).size > 1) {
    throw new Error(
      `${usable.map((entry) => entry.key).join(" and ")} are both set with different values. ` +
        `The aliases are ambiguous; set exactly one of them to select the postgresql server backend for '${name}'.`,
    );
  }
}

/**
 * Fail closed when an old mode variable survives deployment.
 *
 * This is a bounded migration guard, not a compatibility mode: the old value
 * is never parsed or mapped. The message names the replacement configuration.
 */
export function assertNoLegacyStorageMode(name: string, env: Env = process.env): void {
  const legacyKey = firstDefinedEnvKey(env, legacyModeKeys(name));
  if (!legacyKey) return;
  const canonicalDatabaseUrl = serverDataBackendEnvKeys(name).databaseUrlKeys[0];
  throw new Error(
    `${legacyKey} was removed. Delete the storage-mode variable; ` +
      `set ${canonicalDatabaseUrl} to select the postgresql server backend, ` +
      `or leave it unset for sqlite.`,
  );
}

export interface ServerDataBackendResolution {
  backend: ServerDataBackend;
  /** Env key that selected PostgreSQL, or `"default"` for SQLite. */
  source: string;
  databaseUrlPresent: boolean;
  /** Env key the database URL came from, or `null`. */
  databaseUrlSource: string | null;
}

/**
 * Resolve the server backend from database configuration only.
 * Never returns or logs the database URL value.
 *
 * A DEFINED-but-blank DATABASE_URL throws (fail closed) rather than silently
 * selecting sqlite, and canonical/short aliases with different values are
 * rejected rather than silently first-wins.
 */
export function resolveServerDataBackend(
  name: string,
  env: Env = process.env,
): ServerDataBackendResolution {
  assertNoLegacyStorageMode(name, env);
  const { databaseUrlKeys } = serverDataBackendEnvKeys(name);
  const defined = definedDatabaseUrlEntries(env, databaseUrlKeys);
  assertUsableDatabaseUrl(name, defined);
  const databaseUrl = firstEnv(env, databaseUrlKeys);
  if (!databaseUrl) {
    return {
      backend: "sqlite",
      source: "default",
      databaseUrlPresent: false,
      databaseUrlSource: null,
    };
  }
  return {
    backend: "postgresql",
    source: databaseUrl.key,
    databaseUrlPresent: true,
    databaseUrlSource: databaseUrl.key,
  };
}

/** Resolve the database URL without logging it. Returns `null` when unset. */
export function resolveDatabaseUrl(name: string, env: Env = process.env): string | null {
  assertNoLegacyStorageMode(name, env);
  const databaseUrlKeys = serverDataBackendEnvKeys(name).databaseUrlKeys;
  assertUsableDatabaseUrl(name, definedDatabaseUrlEntries(env, databaseUrlKeys));
  const hit = firstEnv(env, databaseUrlKeys);
  return hit?.value ?? null;
}
