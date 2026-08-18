import { createPgPool, createQueryClient, type PoolQueryClient } from "../../storage-kit/index.js";
import {
  SERVER_DATABASE_URL_SETTING,
  resolveServerStorageBackend,
} from "../storage-backend.js";

// API-key app slug. "emails" is canonical and matches the published package,
// the deployed bin, and hasna.contract.json. The unreleased "mailery" rename
// minted keys under that slug for as long as it was deployed, so the verifier
// still accepts it as an alias (see API_APP_ALIASES + serve.ts) and
// `keys list`/`keys revoke` still find those keys.
export const API_APP = "emails";
export const API_APP_ALIASES = ["mailery"] as const;
/**
 * The setting that selects operator-owned PostgreSQL, re-exported under this module's
 * historical name so its callers keep one import site.
 *
 * It is DEFINED in src/server/storage-backend.ts, which is the only place the server
 * decides its internal store. There used to be a second constant here naming a
 * deployment word; it is gone, along with the branch that read it.
 */
export const API_DATABASE_ENV = SERVER_DATABASE_URL_SETTING;
export const API_SIGNING_ENV = "EMAILS_API_SIGNING_KEY";

export interface ApiPool {
  client: PoolQueryClient;
  connectionSource: string;
}

export function assertApiEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  // The server's internal store follows HASNA_EMAILS_DATABASE_URL alone. A leftover
  // selector variable selects nothing and is never read here.
  if (resolveServerStorageBackend(env) !== "postgresql") {
    throw new Error(
      `Emails operator API requires ${API_DATABASE_ENV}. ` +
        "Leave it unset only to run the local SQLite dashboard, which needs no PostgreSQL.",
    );
  }
}

/** True when this process is configured to serve its own PostgreSQL. */
export function usesPostgresBackend(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveServerStorageBackend(env) === "postgresql";
}

export function requireSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  assertApiEnvironment(env);
  const secret = env[API_SIGNING_ENV]?.trim();
  if (!secret) throw new Error(`Emails api service requires ${API_SIGNING_ENV}.`);
  if (secret.length < 32) throw new Error(`${API_SIGNING_ENV} must contain at least 32 characters.`);
  return secret;
}

let cachedPool: ApiPool | null = null;

export function getApiPool(env: NodeJS.ProcessEnv = process.env): ApiPool {
  assertApiEnvironment(env);
  if (!cachedPool) {
    const connectionString = env[API_DATABASE_ENV]!.trim();
    const pool = createPgPool({
      connectionString,
      env,
      applicationName: "emails-serve",
      max: Number(env["EMAILS_PG_POOL_MAX"] ?? "10") || 10,
    });
    cachedPool = { client: createQueryClient(pool), connectionSource: API_DATABASE_ENV };
  }
  return cachedPool;
}

export async function closeApiPool(): Promise<void> {
  if (cachedPool) {
    await cachedPool.client.close();
    cachedPool = null;
  }
}
