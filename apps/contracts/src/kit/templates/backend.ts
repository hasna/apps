// Server data-backend resolution for the vendored Hasna storage kit.
//
// A server has exactly one technical switch: `sqlite | postgresql`.
// A configured DATABASE_URL selects PostgreSQL; otherwise SQLite is
// authoritative. The environment contract alone selects the backend (owner
// directive 2026-07-29).

import { ownString } from "./own.js";

export const SERVER_DATA_BACKENDS = ["sqlite", "postgresql"] as const;
export type ServerDataBackend = (typeof SERVER_DATA_BACKENDS)[number];

export type Env = Record<string, string | undefined>;

/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

export interface ServerDataBackendEnvKeys {
  databaseUrlKeys: string[];
}

export function serverDataBackendEnvKeys(name: string): ServerDataBackendEnvKeys {
  const token = envToken(name);
  return {
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`, `${token}_DATABASE_URL`],
  };
}

// The resolver reads the env as OWN properties. `env` is caller-supplied and
// `process.env` is itself prototype-pollutable, so an unguarded `env[key]` let a
// polluted `HASNA_<APP>_DATABASE_URL` flip the backend to postgresql and hand
// back a connection string the operator never configured.
function firstEnv(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = ownString(env, key)?.trim();
    if (value) return { key, value };
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
function definedDatabaseUrlEntries(env: Env, keys: readonly string[]): Array<{ key: string; value: string }> {
  return keys
    .filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined)
    .map((key) => ({ key, value: String(env[key]) }));
}

/**
 * Reject blank declarations and conflicting aliases. Names the KEYS only —
 * a connection string can embed credentials and is never rendered.
 */
function assertUsableDatabaseUrl(entries: Array<{ key: string; value: string }>): void {
  const blank = entries.filter((entry) => isBlankDatabaseUrlValue(entry.value));
  if (blank.length > 0) {
    throw new Error(
      `${blank.map((entry) => entry.key).join(" and ")} is set but blank. ` +
        `A defined database URL must be a real PostgreSQL connection string. ` +
        `Unset it to select the on-box sqlite store.`,
    );
  }
  const usable = entries
    .map((entry) => ({ key: entry.key, value: entry.value.trim() }))
    .filter((entry) => entry.value.length > 0);
  if (usable.length > 1 && new Set(usable.map((entry) => entry.value)).size > 1) {
    throw new Error(
      `${usable.map((entry) => entry.key).join(" and ")} are both set with different values. ` +
        `The aliases are ambiguous; set exactly one of them to select the postgresql server backend.`,
    );
  }
}

export interface ServerDataBackendResolution {
  backend: ServerDataBackend;
  source: string;
  databaseUrlPresent: boolean;
  databaseUrlSource: string | null;
}

export function resolveServerDataBackend(
  name: string,
  env: Env = process.env,
): ServerDataBackendResolution {
  const databaseUrlKeys = serverDataBackendEnvKeys(name).databaseUrlKeys;
  assertUsableDatabaseUrl(definedDatabaseUrlEntries(env, databaseUrlKeys));
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
  const databaseUrlKeys = serverDataBackendEnvKeys(name).databaseUrlKeys;
  assertUsableDatabaseUrl(definedDatabaseUrlEntries(env, databaseUrlKeys));
  const hit = firstEnv(env, databaseUrlKeys);
  return hit?.value ?? null;
}
