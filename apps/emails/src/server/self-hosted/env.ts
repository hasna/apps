import { createPgPool, createQueryClient, type PoolQueryClient } from "../../storage-kit/index.js";
import {
  SERVER_DATABASE_URL_SETTING,
  resolveServerStorageBackend,
} from "../storage-backend.js";

// API-key app slug. "emails" is canonical and matches the published package,
// the deployed bin, and hasna.contract.json. The unreleased "mailery" rename
// minted keys under that slug for as long as it was deployed, so the verifier
// still accepts it as an alias (see SELF_HOSTED_APP_ALIASES + serve.ts) and
// `keys list`/`keys revoke` still find those keys.
export const SELF_HOSTED_APP = "emails";
export const SELF_HOSTED_APP_ALIASES = ["mailery"] as const;
/**
 * The setting that selects operator-owned PostgreSQL, re-exported under this module's
 * historical name so its callers keep one import site.
 *
 * It is DEFINED in src/server/storage-backend.ts, which is the only place the server
 * decides its internal store. There used to be a second constant here naming a
 * deployment word; it is gone, along with the branch that read it.
 */
export const SELF_HOSTED_DATABASE_ENV = SERVER_DATABASE_URL_SETTING;
export const SELF_HOSTED_SIGNING_ENV = "EMAILS_API_SIGNING_KEY";

// Removed hosted-runtime vars kept rejected. The deployment-mode words
// (EMAILS_MODE / HASNA_EMAILS_MODE / *STORAGE_MODE) are DELETED, not listed here:
// nothing anywhere in the client reads them any more (hasna/apps#1720), so the
// server does not police them either. The array is named LEGACY_HOSTED_ENV_KEYS so
// the no-cloud boundary stripper erases the retired runtime literals exactly as it
// did for the removed guard module.
const LEGACY_HOSTED_ENV_KEYS = [
  "MAILERY_MODE",
  "HASNA_MAILERY_MODE",
  "MAILERY_STORAGE_MODE",
  "HASNA_MAILERY_STORAGE_MODE",
  "MAILERY_API_URL",
  "MAILERY_API_KEY",
  "MAILERY_CLOUD_API_URL",
  "MAILERY_CLOUD_TOKEN",
  "HASNA_MAILERY_API_URL",
  "HASNA_MAILERY_API_KEY",
  "HASNA_MAILERY_ENV_FILE",
  "HASNA_MAILERY_DATABASE_URL",
  "HASNA_MAILERY_API_SIGNING_KEY",
] as const;

export interface SelfHostedPool {
  client: PoolQueryClient;
  connectionSource: string;
}

export function assertSelfHostedEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of LEGACY_HOSTED_ENV_KEYS) {
    if (env[key]?.trim()) {
      throw new Error(
        `${key} belongs to the removed Mailery/cloud runtime. ` +
          `Use ${SELF_HOSTED_DATABASE_ENV} and ${SELF_HOSTED_SIGNING_ENV}.`,
      );
    }
  }
  // The deployment word is REFUSED here rather than merely unread, and the refusal comes
  // from the one module that owns the decision — so an operator who carried the retired
  // variable forward is told to delete it instead of watching it do nothing.
  if (resolveServerStorageBackend(env) !== "postgresql") {
    throw new Error(
      `Emails operator API requires ${SELF_HOSTED_DATABASE_ENV}. ` +
        "Leave it unset only to run the local SQLite dashboard, which needs no PostgreSQL.",
    );
  }
}

/** True when this process is configured to serve its own PostgreSQL. */
export function usesPostgresBackend(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveServerStorageBackend(env) === "postgresql";
}

export function requireSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  assertSelfHostedEnvironment(env);
  const secret = env[SELF_HOSTED_SIGNING_ENV]?.trim();
  if (!secret) throw new Error(`Emails self-hosted service requires ${SELF_HOSTED_SIGNING_ENV}.`);
  if (secret.length < 32) throw new Error(`${SELF_HOSTED_SIGNING_ENV} must contain at least 32 characters.`);
  return secret;
}

let cachedPool: SelfHostedPool | null = null;

export function getSelfHostedPool(env: NodeJS.ProcessEnv = process.env): SelfHostedPool {
  assertSelfHostedEnvironment(env);
  if (!cachedPool) {
    const connectionString = env[SELF_HOSTED_DATABASE_ENV]!.trim();
    const pool = createPgPool({
      connectionString,
      env,
      applicationName: "emails-serve",
      max: Number(env["EMAILS_PG_POOL_MAX"] ?? "10") || 10,
    });
    cachedPool = { client: createQueryClient(pool), connectionSource: SELF_HOSTED_DATABASE_ENV };
  }
  return cachedPool;
}

export async function closeSelfHostedPool(): Promise<void> {
  if (cachedPool) {
    await cachedPool.client.close();
    cachedPool = null;
  }
}
