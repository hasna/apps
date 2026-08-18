// Server data-backend resolution for the vendored Hasna storage kit.
//
// A server has exactly one technical switch: `sqlite | postgresql`.
// A configured DATABASE_URL selects PostgreSQL; otherwise SQLite is
// authoritative. The environment contract alone selects the backend (owner
// directive 2026-07-29).

import { ownProp, ownString } from "./own.js";

export const SERVER_DATA_BACKENDS = ["sqlite", "postgresql"] as const;
export type ServerDataBackend = (typeof SERVER_DATA_BACKENDS)[number];

export type Env = Record<string, string | undefined>;

/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

/**
 * The removed storage-mode keys, in the same order as src/server-backend.ts.
 * The migration guard below MUST stay in step with the canonical copy.
 */
function legacyModeKeys(name: string): string[] {
  const token = envToken(name);
  return [
    `HASNA_${token}_STORAGE_MODE`,
    `HASNA_${token}_MODE`,
    `${token}_STORAGE_MODE`,
    `${token}_MODE`,
  ];
}

/**
 * Fail closed when an old mode variable survives deployment.
 *
 * This is a bounded migration guard, not a compatibility mode: the old value
 * is never parsed or mapped. The message names the replacement configuration.
 * Prototype-safe: a POLLUTED legacy key must NOT fabricate a throw (the
 * polluted-key tests below rely on that); an OWN legacy key MUST throw.
 */
export function assertNoLegacyStorageMode(name: string, env: Env = process.env): void {
  const legacyKey = legacyModeKeys(name).find((key) => ownProp<unknown>(env, key) !== undefined);
  if (!legacyKey) return;
  const canonicalDatabaseUrl = serverDataBackendEnvKeys(name).databaseUrlKeys[0];
  throw new Error(
    `${legacyKey} was removed. Delete the storage-mode variable; ` +
      `set ${canonicalDatabaseUrl} to select the postgresql server backend, ` +
      `or leave it unset for sqlite.`,
  );
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
  assertNoLegacyStorageMode(name, env);
  const databaseUrl = firstEnv(env, serverDataBackendEnvKeys(name).databaseUrlKeys);
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
  const hit = firstEnv(env, serverDataBackendEnvKeys(name).databaseUrlKeys);
  return hit?.value ?? null;
}
