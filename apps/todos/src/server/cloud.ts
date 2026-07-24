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
import { PrGroupLedger } from "../pr-groups/ledger.js";
import {
  PostgresPrGroupLedgerPersistence,
  postgresPrGroupSchemaSql,
} from "../pr-groups/postgres.js";
import {
  ensurePostgresScopedSlugUniqueIndexes,
  postgresTodosCommentCursorIndexSql,
  postgresTodosTaskShortIdIndexSql,
  postgresTodosTaskObjectIdIndexSql,
  postgresTodosSyncSchemaSql,
} from "../storage/postgres-sync.js";
import {
  backfillPostgresCommentRedaction,
  type CommentRedactionBackfillOptions,
  type CommentRedactionBackfillResult,
} from "../storage/comment-redaction-backfill.js";

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
let cachedPrGroupLedger: PrGroupLedger | null = null;
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
    for (const sql of postgresPrGroupSchemaSql()) {
      await client.query(sql);
    }
    await getApiKeyStore().ensureSchema();
  })();
  return schemaEnsured;
}

/**
 * Prebuild the task-comment cursor index without blocking writes. This is a
 * deployment migration, not request-path schema work; PostgreSQL requires
 * `CREATE INDEX CONCURRENTLY` to execute outside an explicit transaction.
 */
export async function ensureCloudCommentCursorIndex(): Promise<void> {
  await getClient().query(postgresTodosCommentCursorIndexSql());
}

/**
 * Optional latency index for case-insensitive short_id resolution. CONCURRENTLY,
 * outside a transaction — a deployment migration, not request-path schema work.
 */
export async function ensureCloudTaskShortIdIndex(): Promise<void> {
  await getClient().query(postgresTodosTaskShortIdIndexSql());
}

/**
 * Optional byte-order index for the id-prefix branch of short-reference
 * resolution. CONCURRENTLY, outside a transaction — a deployment migration.
 */
export async function ensureCloudTaskObjectIdIndex(): Promise<void> {
  await getClient().query(postgresTodosTaskObjectIdIndexSql());
}

/** Audit duplicates, then establish project/task-list slug invariants concurrently. */
export async function ensureCloudScopedSlugUniqueIndexes(): Promise<void> {
  await ensurePostgresScopedSlugUniqueIndexes(getClient());
}

/**
 * Repair legacy double-encoded payloads. Earlier writes bound `JSON.stringify(value)`
 * to a `$::jsonb` param, which Bun.SQL stores as a jsonb STRING scalar rather than
 * an object — so every server-side `payload->>'field'` filter (and jsonb_set for the
 * short-id counter) silently failed. This converts those rows back to real jsonb
 * objects. Idempotent: only touches rows where `jsonb_typeof(payload) = 'string'`,
 * so it is safe to run repeatedly and a no-op once migrated. Returns the row count
 * that was normalized.
 */
export async function normalizeCloudPayloads(): Promise<number> {
  const client = getClient();
  const res = await client.query<{ id: string }>(
    `UPDATE todos_sync_records
       SET payload = (payload #>> '{}')::jsonb
     WHERE jsonb_typeof(payload) = 'string'
     RETURNING object_id AS id`,
  );
  return res.rows.length;
}

/**
 * Preview or explicitly apply the historical comment redaction backfill using
 * the service's existing Postgres pool. The underlying operation defaults to a
 * dry run and independently enforces its apply confirmation gate.
 */
export function backfillCloudCommentRedaction(
  options: CommentRedactionBackfillOptions = {},
): Promise<CommentRedactionBackfillResult> {
  return backfillPostgresCommentRedaction(getClient(), { ...options, service: TODOS_APP_SLUG });
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
  schemaEnsured = null;
}
