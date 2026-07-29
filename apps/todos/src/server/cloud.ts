/**
 * Cloud service wiring for `todos-serve`.
 *
 * This module powers the versioned `/v1` API and its API-key auth. Per Amendment
 * The process reads and writes Postgres through the server adapter. Everything
 * is lazy so selecting cloud mode never imports SQLite.
 */
import { verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import { ApiKeyStore, type AuthQueryClient } from "@hasna/contracts/auth";
import { createTodosPostgresClient, type TodosPostgresClient } from "../storage/postgres-client.js";
import { createPostgresTodosStorageAdapter } from "../storage/postgres-adapter.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { PrGroupLedger } from "../pr-groups/ledger.js";
import { PostgresPrGroupLedgerPersistence } from "../pr-groups/postgres.js";
import {
  DEFAULT_TODOS_POSTGRES_RECORD_TABLE,
} from "../storage/postgres-store.js";

export const TODOS_APP_SLUG = "todos";

/** Resolve the one supported server database setting. */
export function resolveCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HASNA_TODOS_DATABASE_URL?.trim() || undefined;
}

/** Resolve the HMAC signing secret used to verify API keys. */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HASNA_TODOS_API_SIGNING_KEY?.trim() || undefined;
}

let cachedClient: TodosPostgresClient | null = null;
let cachedAdapter: TodosStorageAdapter | null = null;
let cachedStore: ApiKeyStore | null = null;
let cachedVerifier: ApiKeyVerifier | null = null;
let cachedPrGroupLedger: PrGroupLedger | null = null;

function getClient(): TodosPostgresClient {
  if (cachedClient) return cachedClient;
  const url = resolveCloudDatabaseUrl();
  if (!url) {
    throw new Error(
      "Cloud /v1 requires HASNA_TODOS_DATABASE_URL.",
    );
  }
  cachedClient = createTodosPostgresClient(url, { max: 6, idleTimeout: 30, connectionTimeout: 15 });
  return cachedClient;
}

/** The Postgres storage adapter backing every cloud `/v1` handler. */
export function getCloudStorageAdapter(): TodosStorageAdapter {
  if (cachedAdapter) return cachedAdapter;
  const client = getClient();
  cachedAdapter = createPostgresTodosStorageAdapter({ client, service: TODOS_APP_SLUG });
  return cachedAdapter;
}

/** Transactionally fenced PR-group ledger backed by dedicated Postgres rows. */
export function getCloudPrGroupLedger(): PrGroupLedger {
  if (cachedPrGroupLedger) return cachedPrGroupLedger;
  cachedPrGroupLedger = new PrGroupLedger(new PostgresPrGroupLedgerPersistence(getClient()));
  return cachedPrGroupLedger;
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
      "Cloud /v1 auth requires HASNA_TODOS_API_SIGNING_KEY.",
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

/** Read-only startup check. Schema changes are deployment operations. */
export async function ensureCloudSchema(): Promise<void> {
  await getClient().query(`SELECT 1 FROM ${DEFAULT_TODOS_POSTGRES_RECORD_TABLE} LIMIT 0`);
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
  cachedPrGroupLedger = null;
}
