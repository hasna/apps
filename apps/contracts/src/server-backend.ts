// Server data-backend resolution for the Hasna Service Contract v1.
//
// A Hasna server has one authoritative backend: PostgreSQL. A configured,
// valid `HASNA_<NAME>_DATABASE_URL` (or the short alias) is required. Missing,
// blank, invalid, or conflicting declarations fail closed; they never select
// SQLite. Retired storage/mode variables are inert and never select anything.

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

function definedDatabaseUrlEntries(
  env: Env,
  keys: readonly string[],
): Array<{ key: string; value: string }> {
  return keys
    .filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined)
    .map((key) => ({ key, value: String(env[key]) }));
}

function assertPostgresqlDatabaseUrl(
  name: string,
  entries: Array<{ key: string; value: string }>,
): { key: string; value: string } {
  const canonicalKey = serverDataBackendEnvKeys(name).databaseUrlKeys[0];
  if (entries.length === 0) {
    throw new Error(
      `${canonicalKey} is required; Hasna servers use authoritative PostgreSQL and never default to SQLite.`,
    );
  }
  const blank = entries.filter((entry) => entry.value.trim().length === 0);
  if (blank.length > 0) {
    throw new Error(
      `${blank.map((entry) => entry.key).join(" and ")} is set but blank; a PostgreSQL database URL is required.`,
    );
  }
  const controlled = entries.find((entry) => /[\u0000-\u001f\u007f]/.test(entry.value));
  if (controlled) throw new Error(`${controlled.key} must not contain ASCII control characters.`);
  const normalized = entries.map((entry) => ({ key: entry.key, value: entry.value.trim() }));
  if (normalized.length > 1 && new Set(normalized.map((entry) => entry.value)).size > 1) {
    throw new Error(
      `${normalized.map((entry) => entry.key).join(" and ")} disagree; database URL aliases must be identical or only one may be set.`,
    );
  }
  const selected = normalized[0]!;
  let parsed: URL;
  try {
    parsed = new URL(selected.value);
  } catch {
    throw new Error(`${selected.key} must be an absolute PostgreSQL connection URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${selected.key} must use the postgres or postgresql scheme.`);
  }
  if (!parsed.hostname || parsed.pathname.length <= 1) {
    throw new Error(`${selected.key} must name a PostgreSQL host and database.`);
  }
  return selected;
}

export interface ServerDataBackendResolution {
  backend: ServerDataBackend;
  /** Env key that configured PostgreSQL. */
  source: string;
  databaseUrlPresent: boolean;
  /** Env key the database URL came from. */
  databaseUrlSource: string | null;
}

/**
 * Resolve the server backend from database configuration only.
 * Never returns or logs the database URL value.
 */
export function resolveServerDataBackend(
  name: string,
  env: Env = process.env,
): ServerDataBackendResolution {
  const { databaseUrlKeys } = serverDataBackendEnvKeys(name);
  const databaseUrl = assertPostgresqlDatabaseUrl(
    name,
    definedDatabaseUrlEntries(env, databaseUrlKeys),
  );
  return {
    backend: "postgresql",
    source: databaseUrl.key,
    databaseUrlPresent: true,
    databaseUrlSource: databaseUrl.key,
  };
}

/** Resolve the required PostgreSQL URL without logging it. */
export function resolveDatabaseUrl(name: string, env: Env = process.env): string {
  const keys = serverDataBackendEnvKeys(name).databaseUrlKeys;
  return assertPostgresqlDatabaseUrl(name, definedDatabaseUrlEntries(env, keys)).value;
}
