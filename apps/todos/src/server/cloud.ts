/**
 * Cloud (A1 pure-remote) service wiring for `todos-serve`.
 *
 * This module powers the versioned `/v1` API and its API-key auth. Per Amendment
 * A1 the serve process reads and writes the shared RDS Postgres DIRECTLY through
 * the repo-native Postgres storage adapter — there is NO local sync/cache in the
 * service. Everything here is lazy: nothing touches Postgres or crypto until the
 * first `/v1` (or `/ready`) request, so the local-first CLI/dashboard paths keep
 * ZERO cloud dependencies.
 */
import { verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import { ApiKeyStore, type AuthQueryClient } from "@hasna/contracts/auth";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "../storage/cloud-client.js";
import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-sync.js";

export const TODOS_APP_SLUG = "todos";

/** Resolve the remote DATABASE_URL from the supported env vars (in priority order). */
export function resolveCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_TODOS_DATABASE_URL ||
    env.TODOS_DATABASE_URL ||
    env.DATABASE_URL ||
    undefined
  );
}

/** Resolve the HMAC signing secret used to verify API keys. */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_TODOS_API_SIGNING_KEY ||
    env.HASNA_API_SIGNING_KEY ||
    env.API_KEY_SIGNING_SECRET ||
    undefined
  );
}

/** True when this process is configured to serve the cloud `/v1` API. */
export function isCloudModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveCloudDatabaseUrl(env));
}

let cachedClient: TodosCloudQueryClient | null = null;
let cachedAdapter: TodosStorageAdapter | null = null;
let cachedStore: ApiKeyStore | null = null;
let cachedVerifier: ApiKeyVerifier | null = null;
let schemaEnsured: Promise<void> | null = null;

function getClient(): TodosCloudQueryClient {
  if (cachedClient) return cachedClient;
  const url = resolveCloudDatabaseUrl();
  if (!url) {
    throw new Error(
      "Cloud /v1 requires a remote database URL (HASNA_TODOS_DATABASE_URL / TODOS_DATABASE_URL / DATABASE_URL).",
    );
  }
  cachedClient = createTodosCloudQueryClient(url, { max: 6, idleTimeout: 30, connectionTimeout: 15 });
  return cachedClient;
}

/** The pure-remote Postgres storage adapter backing every `/v1` handler. */
export function getCloudStorageAdapter(): TodosStorageAdapter {
  if (cachedAdapter) return cachedAdapter;
  const client = getClient();
  cachedAdapter = createPostgresTodosStorageAdapter({ client, service: TODOS_APP_SLUG });
  return cachedAdapter;
}

/**
 * Bridge the repo-native `{ rows }` query client to the contracts kit's
 * `AuthQueryClient` ({ many, get, execute }). Keeps a single connection pool.
 */
function authClient(): AuthQueryClient {
  const client = getClient();
  return {
    async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await client.query<T>(sql, params);
      return res.rows;
    },
    async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      const res = await client.query<T>(sql, params);
      return res.rows[0] ?? null;
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      await client.query(sql, params);
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
 * HMAC-signed by the contracts issuer; revocation is checked against the RDS
 * `api_keys` table. Fails closed when no signing secret is configured.
 */
export function getCloudVerifier(): ApiKeyVerifier {
  if (cachedVerifier) return cachedVerifier;
  const signingSecret = resolveSigningSecret();
  if (!signingSecret) {
    throw new Error(
      "Cloud /v1 auth requires a signing secret (HASNA_TODOS_API_SIGNING_KEY / HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  const store = getApiKeyStore();
  cachedVerifier = verifyApiKey({
    app: TODOS_APP_SLUG,
    signingSecret,
    isRevoked: store.isRevoked,
  });
  return cachedVerifier;
}

/**
 * Ensure the remote schema exists: the JSONB sync tables the Postgres adapter
 * reads/writes, plus the api-keys table. Idempotent, run once per process and by
 * the migration runner. NEVER drops or rewrites existing tables.
 */
export async function ensureCloudSchema(): Promise<void> {
  if (schemaEnsured) return schemaEnsured;
  schemaEnsured = (async () => {
    const client = getClient();
    for (const sql of postgresTodosSyncSchemaSql()) {
      await client.query(sql);
    }
    await getApiKeyStore().ensureSchema();
  })();
  return schemaEnsured;
}

/** Cheap readiness probe: round-trips a trivial query to RDS. */
export async function pingCloud(): Promise<boolean> {
  const client = getClient();
  const res = await client.query<{ ok: number }>("select 1 as ok");
  return res.rows[0]?.ok === 1;
}

/** Test/shutdown helper. */
export async function closeCloud(): Promise<void> {
  if (cachedClient) await cachedClient.close();
  cachedClient = null;
  cachedAdapter = null;
  cachedStore = null;
  cachedVerifier = null;
  schemaEnsured = null;
}
