/**
 * Cloud (A1 pure-remote) service wiring for `todos-serve`.
 *
 * This module powers the versioned `/v1` API and its API-key auth. Per Amendment
 * A1 the serve process reads and writes the shared RDS Postgres DIRECTLY through
 * the repo-native Postgres storage adapter — there is NO local sync/cache in the
 * service. Everything here is lazy: nothing touches Postgres or crypto until the
 * first `/v1` (or `/ready`) request, so the local-first CLI/HTTP paths keep
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
  createPostgresTodosProjectRegistrationAuthority,
  postgresTodosProjectRegistrationSchemaSql,
  type TodosProjectRegistrationAuthority,
} from "../project-registration/index.js";
import {
  createPostgresTodosTaskManifestAuthority,
  postgresTodosTaskManifestSchemaSql,
  type TodosTaskManifestAuthority,
} from "../task-manifest/index.js";
import {
  createPostgresTodosTaskSubtreeTransferAuthority,
  postgresTodosTaskSubtreeTransferSchemaSql,
  type TodosTaskSubtreeTransferAuthority,
} from "../task-subtree-transfer/index.js";
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
import {
  backfillMissingTimestamps,
  type TimestampBackfillOptions,
  type TimestampBackfillResult,
} from "../storage/timestamp-backfill.js";

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

/**
 * True when this process is configured with the PostgreSQL backend (a database
 * URL is present), i.e. it serves the authenticated `/v1` API. This is the
 * server's single data-backend switch: sqlite (no DSN) or postgres (DSN) —
 * there is no deployment-mode axis.
 */
export function isPostgresBackendConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveCloudDatabaseUrl(env));
}

let cachedClient: TodosCloudQueryClient | null = null;
let cachedAdapter: TodosStorageAdapter | null = null;
let cachedStore: ApiKeyStore | null = null;
let cachedVerifier: ApiKeyVerifier | null = null;
let cachedPrGroupLedger: PrGroupLedger | null = null;
let cachedProjectRegistrationAuthority: TodosProjectRegistrationAuthority | null = null;
let cachedTaskManifestAuthority: TodosTaskManifestAuthority | null = null;
let cachedTaskSubtreeTransferAuthority: TodosTaskSubtreeTransferAuthority | null = null;
let schemaEnsured: Promise<void> | null = null;
let lastSchemaAttemptAtMs = 0;
let lastSchemaFailure: unknown = null;

/**
 * Minimum interval between schema-retry attempts after a failed run (P2 from
 * PR #931 review, todos O15-00479). A SUSTAINED schema failure must not
 * re-run the whole idempotent DDL sequence on every /v1 request — under lock
 * contention that saturates the 6-connection pool. Calls inside the window
 * rethrow the recorded failure; the first call after the interval makes a
 * fresh attempt. Overridable for tests/ops via
 * HASNA_TODOS_SCHEMA_RETRY_MIN_MS (ms).
 */
const DEFAULT_SCHEMA_RETRY_MIN_MS = 10_000;

function schemaRetryMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HASNA_TODOS_SCHEMA_RETRY_MIN_MS;
  if (!raw) return DEFAULT_SCHEMA_RETRY_MIN_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SCHEMA_RETRY_MIN_MS;
}

function getCloudTenantId(): string {
  return process.env.HASNA_TODOS_TENANT_ID ?? "default";
}

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

/** Conditional singleton Projects → Todos registration authority on Postgres. */
export function getCloudProjectRegistrationAuthority(): TodosProjectRegistrationAuthority {
  if (cachedProjectRegistrationAuthority) return cachedProjectRegistrationAuthority;
  cachedProjectRegistrationAuthority = createPostgresTodosProjectRegistrationAuthority(
    getClient(),
    {
      service: TODOS_APP_SLUG,
      authorityId: TODOS_APP_SLUG,
      tenantId: getCloudTenantId(),
      corpusId: process.env.HASNA_TODOS_CORPUS_ID ?? `${TODOS_APP_SLUG}:postgresql`,
    },
  );
  return cachedProjectRegistrationAuthority;
}

/** Package-owned task-manifest authority backed by the shared Postgres pool. */
export function getCloudTaskManifestAuthority(): TodosTaskManifestAuthority {
  if (cachedTaskManifestAuthority) return cachedTaskManifestAuthority;
  cachedTaskManifestAuthority = createPostgresTodosTaskManifestAuthority(getClient(), {
    service: TODOS_APP_SLUG,
    tenantId: getCloudTenantId(),
  });
  return cachedTaskManifestAuthority;
}

/** Package-owned task-subtree-transfer authority backed by the shared Postgres pool. */
export function getCloudTaskSubtreeTransferAuthority(): TodosTaskSubtreeTransferAuthority {
  if (cachedTaskSubtreeTransferAuthority) return cachedTaskSubtreeTransferAuthority;
  cachedTaskSubtreeTransferAuthority = createPostgresTodosTaskSubtreeTransferAuthority(getClient(), {
    service: TODOS_APP_SLUG,
    tenantId: getCloudTenantId(),
  });
  return cachedTaskSubtreeTransferAuthority;
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
    // Strict key-status hook: anything other than "active" (unknown, revoked,
    // expired) denies. The contract refuses the deprecated `isRevoked`-only
    // wiring eagerly at construction (contracts #62, 0.8.7+) — the 0.15.38
    // /v1 503 incident (row ae34a051, incident 720366) was exactly that throw
    // surfacing as 503 on every business route.
    keyStatus: store.keyStatus,
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
  if (
    lastSchemaFailure !== null
    && Date.now() - lastSchemaAttemptAtMs < schemaRetryMinIntervalMs()
  ) {
    // Cooldown (P2 from PR #931 review): a sustained schema failure must not
    // re-run the idempotent DDL sequence on every request — under lock
    // contention that saturates the pool. Rethrow the recorded failure without
    // a fresh attempt; the memo stays cleared, so the first call after the
    // min-interval makes a fresh attempt.
    throw lastSchemaFailure;
  }
  lastSchemaAttemptAtMs = Date.now();
  schemaEnsured = (async () => {
    const client = getClient();
    for (const sql of postgresTodosSyncSchemaSql()) {
      await client.query(sql);
    }
    for (const sql of postgresPrGroupSchemaSql()) {
      await client.query(sql);
    }
    for (const sql of postgresTodosProjectRegistrationSchemaSql()) {
      await client.query(sql);
    }
    for (const sql of postgresTodosTaskManifestSchemaSql(getCloudTenantId())) {
      await client.query(sql);
    }
    for (const sql of postgresTodosTaskSubtreeTransferSchemaSql()) {
      await client.query(sql);
    }
    await getApiKeyStore().ensureSchema();
  })().catch((error) => {
    // A transient DDL failure MUST NOT be memoized. Measured 2026-08-22
    // (todos 724397): a single `canceling statement due to lock timeout`
    // (55P03) on `CREATE INDEX IF NOT EXISTS todos_sync_records_updated_idx`
    // at process start made the cached promise reject forever, so EVERY later
    // /v1 request on that process failed (v1.ts awaits this OUTSIDE its
    // handler try/catch, surfacing Bun's bare `Something went wrong!` 500).
    // With two ECS tasks one poisoned process read as a ~50% "intermittent"
    // outage. Clear the memo so the next request retries the idempotent
    // (IF NOT EXISTS / OR REPLACE) schema DDL. The failure is recorded so the
    // cooldown can rethrow it without re-running the DDL (P2 from PR #931
    // review, todos O15-00479).
    schemaEnsured = null;
    lastSchemaFailure = error;
    throw error;
  });
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

/**
 * Preview or explicitly apply the terminal-status timestamp backfill using the
 * service's existing Postgres pool. The underlying operation defaults to a dry
 * run, requires an explicit confirmation AND an evidence path for --apply, and
 * only ever fills NULL timestamp columns (never overwrites a concurrent
 * writer). See ../storage/timestamp-backfill.js.
 */
export function backfillCloudTimestamps(
  options: TimestampBackfillOptions = {},
): Promise<TimestampBackfillResult> {
  return backfillMissingTimestamps(getClient(), { ...options, service: TODOS_APP_SLUG });
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
  cachedProjectRegistrationAuthority = null;
  cachedTaskManifestAuthority = null;
  cachedTaskSubtreeTransferAuthority = null;
  schemaEnsured = null;
  lastSchemaAttemptAtMs = 0;
  lastSchemaFailure = null;
}
