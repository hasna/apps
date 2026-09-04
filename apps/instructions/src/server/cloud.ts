/**
 * Cloud (A1 pure-remote) service wiring for `instructions-serve`.
 *
 * Powers the versioned `/v1` API and its API-key auth. Per Amendment A1 the
 * serve process reads and writes the shared RDS Postgres DIRECTLY through the
 * vendored storage kit — there is NO local sync/cache in the service.
 * Everything is lazy: nothing touches Postgres or crypto until the first `/v1`
 * (or `/ready`) request, so the local-first CLI/MCP paths keep ZERO cloud deps.
 */
import { verifyApiKey, honoApiKey, type ApiKeyVerifier, ApiKeyStore, type AuthQueryClient } from "@hasna/contracts/auth";
import { createPgPool, createQueryClient, type PoolQueryClient } from "../generated/storage-kit/index.js";
import { instructionsSchemaSql } from "../storage/schema.js";
import { assertNoLegacyStorageMode } from "../lib/retired-storage-mode.js";

export const INSTRUCTIONS_APP_SLUG = "instructions";

/** Resolve the remote DATABASE_URL from the supported env vars (priority order). */
export function resolveCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  assertNoLegacyStorageMode(env);
  return (
    env.HASNA_INSTRUCTIONS_DATABASE_URL ||
    env.INSTRUCTIONS_DATABASE_URL ||
    env.DATABASE_URL ||
    undefined
  );
}

/** Resolve the HMAC signing secret used to verify API keys. */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_INSTRUCTIONS_API_SIGNING_KEY ||
    env.HASNA_API_SIGNING_KEY ||
    env.API_KEY_SIGNING_SECRET ||
    undefined
  );
}

/** True when this process is configured to serve the `/v1` API (postgresql backend). */
export function isPostgresBackendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveCloudDatabaseUrl(env));
}

let cachedClient: PoolQueryClient | null = null;
let cachedStore: ApiKeyStore | null = null;
let cachedVerifier: ApiKeyVerifier | null = null;
let schemaEnsured: Promise<void> | null = null;

function getClient(): PoolQueryClient {
  if (cachedClient) return cachedClient;
  const url = resolveCloudDatabaseUrl();
  if (!url) {
    throw new Error(
      "Cloud /v1 requires a remote database URL (HASNA_INSTRUCTIONS_DATABASE_URL / INSTRUCTIONS_DATABASE_URL / DATABASE_URL).",
    );
  }
  const pool = createPgPool({
    connectionString: url,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    applicationName: "instructions-serve",
  });
  cachedClient = createQueryClient(pool);
  return cachedClient;
}

/** The vendored-kit query client backing every `/v1` handler (pure remote). */
export function getCloudClient(): PoolQueryClient {
  return getClient();
}

/** Bridge the kit's typed client to the contracts auth `AuthQueryClient`. */
function authClient(): AuthQueryClient {
  const client = getClient();
  return {
    async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return client.many<T>(sql, params);
    },
    async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      return client.get<T>(sql, params);
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      await client.execute(sql, params);
    },
  };
}

export function getApiKeyStore(): ApiKeyStore {
  if (cachedStore) return cachedStore;
  cachedStore = new ApiKeyStore(authClient());
  return cachedStore;
}

/**
 * The framework-agnostic API-key verifier for `/v1`. Tokens are stateless,
 * HMAC-signed by the contracts issuer; lifecycle status is checked against the
 * RDS `api_keys` table through the contracts `keyStatus` hook — the recommended
 * wiring, which refuses unknown, revoked AND expired kids (the deprecated
 * `isRevoked`-only form cannot refuse a key this service has no record of).
 * Fails closed when no signing secret is configured.
 */
export function getCloudVerifier(): ApiKeyVerifier {
  if (cachedVerifier) return cachedVerifier;
  const signingSecret = resolveSigningSecret();
  if (!signingSecret) {
    throw new Error(
      "Cloud /v1 auth requires a signing secret (HASNA_INSTRUCTIONS_API_SIGNING_KEY / HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  const store = getApiKeyStore();
  cachedVerifier = verifyApiKey({
    app: INSTRUCTIONS_APP_SLUG,
    signingSecret,
    keyStatus: store.keyStatus,
  });
  return cachedVerifier;
}

/**
 * Ensure the remote schema exists: the instructions domain tables plus the
 * contracts api-keys table. Idempotent, run once per process and by the
 * migration runner. NEVER drops or rewrites existing tables.
 */
export async function ensureCloudSchema(): Promise<void> {
  if (schemaEnsured) return schemaEnsured;
  schemaEnsured = (async () => {
    const client = getClient();
    for (const sql of instructionsSchemaSql()) {
      await client.execute(sql);
    }
    await getApiKeyStore().ensureSchema();
  })().catch((e) => {
    // One transient Postgres failure must not poison every later /v1 request:
    // the serving process never calls closeCloud(), so a cached REJECTED
    // promise would replay forever (503 on every request until restart).
    // Clear the cache so the next call re-attempts; this caller still
    // receives the rejection (surfaced as a 503 by the /v1 handler).
    schemaEnsured = null;
    throw e;
  });
  return schemaEnsured;
}

/**
 * Build the contracts Hono API-key middleware for `/v1`, gated to the given
 * scopes. Cached per scope-set. Fails closed (throws) when unconfigured; the
 * caller converts that into a 503 so `/v1` is never an unauthenticated backdoor.
 */
const honoMiddlewareCache = new Map<string, ReturnType<typeof honoApiKey>>();
export function getHonoAuthMiddleware(requiredScopes: string[]): ReturnType<typeof honoApiKey> {
  const key = requiredScopes.join(",");
  const cached = honoMiddlewareCache.get(key);
  if (cached) return cached;
  const signingSecret = resolveSigningSecret();
  if (!signingSecret) {
    throw new Error(
      "Cloud /v1 auth requires a signing secret (HASNA_INSTRUCTIONS_API_SIGNING_KEY / HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  const store = getApiKeyStore();
  const mw = honoApiKey({
    app: INSTRUCTIONS_APP_SLUG,
    signingSecret,
    keyStatus: store.keyStatus,
    requiredScopes,
  });
  honoMiddlewareCache.set(key, mw);
  return mw;
}

/** Cheap readiness probe: round-trips a trivial query to RDS. */
export async function pingCloud(): Promise<boolean> {
  const client = getClient();
  const row = await client.get<{ ok: number }>("SELECT 1 AS ok");
  return row?.ok === 1;
}

/** Test/shutdown helper. */
export async function closeCloud(): Promise<void> {
  if (cachedClient) await cachedClient.close();
  cachedClient = null;
  cachedStore = null;
  cachedVerifier = null;
  // The Hono middleware cache captures keyStatus + signing secret at
  // construction; a stale entry from an earlier test file in the same worker
  // would keep the pre-patch verifier (cloud-auth.test.ts 401 flake).
  honoMiddlewareCache.clear();
  schemaEnsured = null;
  // The middleware cache is module state like the fields above: it closes over
  // the signing secret and keyStatus hook in force when it was built. A later
  // closeCloud() (e.g. another test file re-pointing the signing secret) must
  // not leave stale middleware keyed by scope-set answering requests — that
  // 401s every token minted under the new secret. Cleared here with the rest.
  honoMiddlewareCache.clear();
}
