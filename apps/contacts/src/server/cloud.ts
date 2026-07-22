/**
 * Cloud (A1 pure-remote) service wiring for `contacts-serve`.
 *
 * This module powers the versioned `/v1` API and its API-key auth. Per Amendment
 * A1 the serve process reads and writes the shared RDS Postgres DIRECTLY through
 * the vendored @hasna/contracts storage kit — there is NO local sync/cache in
 * the service. Everything is lazy: nothing touches Postgres or crypto until the
 * first `/v1` / `/ready` request, so the local-first CLI/dashboard SQLite paths
 * keep ZERO cloud dependencies.
 */
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier, type AuthQueryClient } from "@hasna/contracts/auth";
import { createCloudPoolFromEnv } from "../generated/storage-kit/pool.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import { checkHealth } from "../generated/storage-kit/health.js";
import { PG_MIGRATIONS } from "../db/pg-migrations.js";

export const CONTACTS_APP_SLUG = "contacts";

/** Resolve the remote DATABASE_URL from the supported env vars (priority order). */
export function resolveCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_CONTACTS_DATABASE_URL ||
    env.CONTACTS_DATABASE_URL ||
    env.DATABASE_URL ||
    undefined
  );
}

/** Resolve the HMAC signing secret used to verify API keys. */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_CONTACTS_API_SIGNING_KEY ||
    env.HASNA_API_SIGNING_KEY ||
    env.API_KEY_SIGNING_SECRET ||
    undefined
  );
}

/** True when this process is configured to serve the cloud `/v1` API.
 * Explicit remote mode remains cloud even when its DSN is missing so readiness
 * fails closed instead of presenting the process as a healthy local server. */
export function isCloudModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.HASNA_CONTACTS_STORAGE_MODE || env.CONTACTS_STORAGE_MODE;
  return Boolean(resolveCloudDatabaseUrl(env)) || mode === "cloud" || mode === "self_hosted";
}

let cachedClient: PoolQueryClient | null = null;
let cachedStore: ApiKeyStore | null = null;
let cachedVerifier: ApiKeyVerifier | null = null;
let schemaEnsured: Promise<void> | null = null;
let runtimeSchemaChecked = false;

/** The vendored-kit Postgres pool client backing every `/v1` handler. */
export function getCloudClient(): PoolQueryClient {
  if (cachedClient) return cachedClient;
  const url = resolveCloudDatabaseUrl();
  if (!url) {
    throw new Error(
      "Cloud /v1 requires a remote database URL (HASNA_CONTACTS_DATABASE_URL / CONTACTS_DATABASE_URL / DATABASE_URL).",
    );
  }
  // The vendored kit resolves its DSN from `HASNA_CONTACTS_DATABASE_URL` (or the
  // `CONTACTS_DATABASE_URL` alias) ONLY — it does not read the generic
  // `DATABASE_URL` that the ECS hasna-app module injects. We resolve the DSN
  // ourselves (accepting DATABASE_URL too) and bridge it into the kit's expected
  // key, and force cloud mode, so any supported env-var spelling works.
  const env = { ...process.env } as Record<string, string | undefined>;
  env.HASNA_CONTACTS_DATABASE_URL = url;
  if (!env.HASNA_CONTACTS_STORAGE_MODE && !env.CONTACTS_STORAGE_MODE) {
    env.HASNA_CONTACTS_STORAGE_MODE = "cloud";
  }
  const { client } = createCloudPoolFromEnv(CONTACTS_APP_SLUG, {
    env,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    applicationName: "contacts-serve",
  });
  cachedClient = client;
  return cachedClient;
}

/** Bridge the kit's PoolQueryClient to the contracts auth `AuthQueryClient`. */
function authClient(): AuthQueryClient {
  const client = getCloudClient();
  return {
    many: (sql, params = []) => client.many(sql, params) as never,
    get: (sql, params = []) => client.get(sql, params) as never,
    execute: (sql, params = []) => client.execute(sql, params),
  };
}

export function getApiKeyStore(): ApiKeyStore {
  if (cachedStore) return cachedStore;
  cachedStore = new ApiKeyStore(authClient());
  return cachedStore;
}

/**
 * The framework-agnostic API-key verifier for `/v1`. Tokens are stateless,
 * HMAC-signed by the contracts issuer; revocation is checked against the RDS
 * `api_keys` table. Fails closed when no signing secret is configured.
 */
export function getCloudVerifier(): ApiKeyVerifier {
  if (cachedVerifier) return cachedVerifier;
  const signingSecret = resolveSigningSecret();
  if (!signingSecret) {
    throw new Error(
      "Cloud /v1 auth requires a signing secret (HASNA_CONTACTS_API_SIGNING_KEY / HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  const store = getApiKeyStore();
  cachedVerifier = verifyApiKey({
    app: CONTACTS_APP_SLUG,
    signingSecret,
    isRevoked: store.isRevoked,
  });
  return cachedVerifier;
}

/**
 * Ensure the remote schema exists: the relational contacts schema (translated
 * for Postgres in PG_MIGRATIONS) plus the contracts api-keys table. Idempotent —
 * every statement is CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
 * ON CONFLICT DO NOTHING. NEVER drops or rewrites existing tables.
 */
export async function ensureCloudSchema(): Promise<void> {
  if (schemaEnsured) return schemaEnsured;
  schemaEnsured = (async () => {
    const client = getCloudClient();
    for (const sql of PG_MIGRATIONS) {
      await client.execute(sql);
    }
    await getApiKeyStore().ensureSchema();
  })();
  return schemaEnsured;
}

/**
 * Runtime schema check for the request path. The `contacts-serve` service runs
 * as the LEAST-PRIVILEGE app role (DML only, no DDL) per the RDS isolation
 * model; the one-shot migration task owns all schema DDL as the OWNER role.
 * So here we attempt the ensure exactly ONCE and, if the app role lacks DDL
 * privileges (the expected steady state), log a single line and proceed — the
 * schema is already present, applied by the migration task. This NEVER throws,
 * so a permission boundary can't take the API down. In local/dev where serve
 * runs with a privileged role, this self-heals the schema on first request.
 */
export async function ensureCloudSchemaBestEffort(): Promise<void> {
  if (runtimeSchemaChecked) return;
  runtimeSchemaChecked = true;
  try {
    await ensureCloudSchema();
  } catch (e) {
    // Clear the poisoned cached promise so a privileged path (migrate) can retry.
    schemaEnsured = null;
    console.warn(
      `[contacts-serve] runtime schema ensure skipped (expected for the least-privilege app role — the migration task owns DDL): ${(e as Error).message}`,
    );
  }
}

/** Cheap readiness probe: round-trips a trivial query to RDS. */
export async function pingCloud(): Promise<boolean> {
  const result = await checkHealth(getCloudClient());
  return result.ok;
}

/** Test/shutdown helper. */
export async function closeCloud(): Promise<void> {
  if (cachedClient) await cachedClient.close();
  cachedClient = null;
  cachedStore = null;
  cachedVerifier = null;
  schemaEnsured = null;
  runtimeSchemaChecked = false;
}
