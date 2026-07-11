import { SQL } from "bun";
import {
  canonicalDigest,
  parseStorageJson,
  sha256,
  storageJson,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import {
  InMemorySandboxRepositoryV1,
  createSandboxRepositoryStateV1,
  operationIdempotencyKeyV1,
  type SandboxRepositoryStateV1,
} from "./repository-memory.js";
import {
  assertExecStreamStateTransitionV1,
  type RepositoryHealthV1,
  type SandboxRepositoryTxV1,
  type SandboxRepositoryV1,
} from "./repository.js";
import type {
  CheckpointDurabilityReceiptV1,
  ExecStreamStateV1,
  ExternalOperationAnchorRecordV1,
  GitPromotionReceiptRefV1,
  OperationRecordV1,
  SandboxDestroyTombstoneV1,
  SandboxEventV1,
  SandboxV1,
  SealedProviderHandleV1,
  StoredSafetyFenceObservationV1,
} from "./types.js";

export interface PostgresSessionV1 {
  query<Row extends Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<Row[]>;
}

export interface PostgresClientV1 extends PostgresSessionV1 {
  transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface BunSqlLike {
  unsafe(statement: string, parameters?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (transaction: BunSqlLike) => Promise<T>): Promise<T>;
  close(options?: { timeout?: number }): Promise<void>;
}

class BunPostgresSessionV1 implements PostgresSessionV1 {
  readonly #sql: BunSqlLike;

  constructor(sql: BunSqlLike) {
    this.#sql = sql;
  }

  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    return await this.#sql.unsafe(statement, [...parameters]) as Row[];
  }
}

class BunPostgresClientV1 extends BunPostgresSessionV1 implements PostgresClientV1 {
  readonly #sql: BunSqlLike;

  constructor(url: string, tlsCa: string | Uint8Array) {
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new SandboxError("validation_failed", "Postgres URL must use the postgres protocol");
    }
    if (parsed.searchParams.get("sslmode") !== "verify-full") {
      throw new SandboxError("forbidden", "Self-hosted Postgres requires sslmode=verify-full");
    }
    const sql = new SQL({
      url,
      // Every repository transaction is serialized by the advisory lock below.
      // Keep one connection so failed startup cannot strand parallel TLS
      // handshakes while readiness cleanup closes the pool.
      max: 1,
      connectionTimeout: 10,
      tls: {
        ca: tlsCa,
        serverName: parsed.hostname,
        rejectUnauthorized: true,
      },
    }) as unknown as BunSqlLike;
    super(sql);
    this.#sql = sql;
  }

  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await this.#sql.begin(async (transaction) =>
      await fn(new BunPostgresSessionV1(transaction))
    );
  }

  async close(): Promise<void> {
    await this.#sql.close({ timeout: 0 });
  }
}

const POSTGRES_MIGRATIONS = [
  {
    version: 1,
    name: "runtime_core_v1",
    sql: `
      CREATE SCHEMA IF NOT EXISTS sandboxes;
      CREATE TABLE IF NOT EXISTS sandboxes.schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE sandboxes.sandbox_records (
        resource_id TEXT PRIMARY KEY,
        revision BIGINT NOT NULL CHECK (revision >= 1),
        state TEXT NOT NULL,
        record_json JSONB NOT NULL
      );
      CREATE TABLE sandboxes.adapter_resources (
        resource_id TEXT PRIMARY KEY REFERENCES sandboxes.sandbox_records(resource_id),
        provider_handle_sha256 TEXT NOT NULL
          CHECK (provider_handle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        record_json JSONB NOT NULL
      );
      CREATE TABLE sandboxes.operations (
        operation_id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        actor_principal TEXT NOT NULL,
        idempotency_key_sha256 TEXT NOT NULL
          CHECK (idempotency_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        request_sha256 TEXT NOT NULL
          CHECK (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        state TEXT NOT NULL,
        effect_phase TEXT NOT NULL,
        operation_step_id TEXT,
        dispatch_anchor_sha256 TEXT,
        expected_resource_lifecycle_generation BIGINT NOT NULL
          CHECK (expected_resource_lifecycle_generation >= 1),
        successor_resource_lifecycle_generation BIGINT NOT NULL
          CHECK (successor_resource_lifecycle_generation >= 1),
        operation_execution_epoch BIGINT NOT NULL CHECK (operation_execution_epoch >= 1),
        provider_idempotency_token_sha256 TEXT
          CHECK (provider_idempotency_token_sha256 IS NULL OR
            provider_idempotency_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        provider_creation_token_sha256 TEXT
          CHECK (provider_creation_token_sha256 IS NULL OR
            provider_creation_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        immutable_fingerprint_sha256 TEXT
          CHECK (immutable_fingerprint_sha256 IS NULL OR
            immutable_fingerprint_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        authorization_consumption_receipt_sha256 TEXT
          CHECK (authorization_consumption_receipt_sha256 IS NULL OR
            authorization_consumption_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        record_json JSONB NOT NULL,
        CHECK (
          (provider_idempotency_token_sha256 IS NULL AND
           provider_creation_token_sha256 IS NULL AND
           immutable_fingerprint_sha256 IS NULL AND
           authorization_consumption_receipt_sha256 IS NULL) OR
          (provider_idempotency_token_sha256 IS NOT NULL AND
           provider_creation_token_sha256 IS NOT NULL AND
           immutable_fingerprint_sha256 IS NOT NULL AND
           authorization_consumption_receipt_sha256 IS NOT NULL)
        ),
        UNIQUE(actor_principal, operation, resource_id, idempotency_key_sha256)
      );
      CREATE TABLE sandboxes.capability_uses (
        use_sha256 TEXT PRIMARY KEY CHECK (use_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        operation_id TEXT NOT NULL REFERENCES sandboxes.operations(operation_id)
      );
      CREATE TABLE sandboxes.activation_grant_uses (
        use_sha256 TEXT PRIMARY KEY CHECK (use_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        operation_id TEXT NOT NULL REFERENCES sandboxes.operations(operation_id)
      );
      CREATE TABLE sandboxes.cleanup_grant_uses (
        use_sha256 TEXT PRIMARY KEY CHECK (use_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        operation_id TEXT NOT NULL REFERENCES sandboxes.operations(operation_id)
      );
      CREATE TABLE sandboxes.sandbox_events (
        resource_id TEXT NOT NULL,
        sequence BIGINT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        record_json JSONB NOT NULL,
        PRIMARY KEY(resource_id, sequence)
      );
      CREATE TABLE sandboxes.outbox (
        event_id TEXT PRIMARY KEY REFERENCES sandboxes.sandbox_events(event_id),
        payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        delivered_at TIMESTAMPTZ
      );
      CREATE TABLE sandboxes.fence_high_watermarks (
        resource_id TEXT PRIMARY KEY REFERENCES sandboxes.sandbox_records(resource_id),
        authority_epoch BIGINT NOT NULL CHECK (authority_epoch >= 1),
        route_epoch BIGINT NOT NULL CHECK (route_epoch >= 1),
        lease_epoch BIGINT NOT NULL CHECK (lease_epoch >= 1),
        resource_lifecycle_generation BIGINT NOT NULL CHECK (resource_lifecycle_generation >= 1),
        operation_execution_epoch BIGINT NOT NULL CHECK (operation_execution_epoch >= 1)
      );
      CREATE TABLE sandboxes.checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        root_sha256 TEXT NOT NULL CHECK (root_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        receipt_sha256 TEXT UNIQUE
          CHECK (receipt_sha256 IS NULL OR receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        record_json JSONB NOT NULL
      );
      CREATE TABLE sandboxes.checkpoint_blobs (
        checkpoint_id TEXT NOT NULL REFERENCES sandboxes.checkpoints(checkpoint_id),
        blob_sha256 TEXT NOT NULL CHECK (blob_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        object_version TEXT NOT NULL,
        size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
        record_json JSONB NOT NULL,
        PRIMARY KEY(checkpoint_id, blob_sha256)
      );
      CREATE TABLE sandboxes.cleanup_requests (
        operation_id TEXT PRIMARY KEY REFERENCES sandboxes.operations(operation_id),
        resource_id TEXT NOT NULL,
        basis_receipt_sha256 TEXT NOT NULL
          CHECK (basis_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        destroy_receipt_sha256 TEXT
          CHECK (destroy_receipt_sha256 IS NULL OR destroy_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        record_json JSONB NOT NULL
      );
      CREATE TABLE sandboxes.execs (
        exec_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES sandboxes.sandbox_records(resource_id),
        revision BIGINT NOT NULL,
        record_json JSONB NOT NULL
      );
      CREATE TABLE sandboxes.exec_frames (
        exec_id TEXT NOT NULL REFERENCES sandboxes.execs(exec_id),
        sequence BIGINT NOT NULL,
        payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        object_version TEXT,
        record_json JSONB NOT NULL,
        PRIMARY KEY(exec_id, sequence)
      );
    `,
  },
  {
    version: 2,
    name: "external_read_probe_frontiers_v1",
    sql: `
      CREATE TABLE sandboxes.external_journal_frontiers (
        journal_sequence BIGINT PRIMARY KEY CHECK (journal_sequence >= 1),
        prior_frontier_digest TEXT NOT NULL UNIQUE
          CHECK (prior_frontier_digest ~ '^sha256:[0-9a-f]{64}$'),
        record_digest TEXT NOT NULL UNIQUE
          CHECK (record_digest ~ '^sha256:[0-9a-f]{64}$'),
        frontier_digest TEXT NOT NULL UNIQUE
          CHECK (frontier_digest ~ '^sha256:[0-9a-f]{64}$'),
        envelope_digest TEXT NOT NULL UNIQUE
          CHECK (envelope_digest ~ '^sha256:[0-9a-f]{64}$'),
        envelope_kind TEXT NOT NULL
          CHECK (envelope_kind IN ('DISPATCHED', 'OUTCOME', 'READ_PROBE')),
        recorded_at TIMESTAMPTZ NOT NULL,
        UNIQUE(journal_sequence, envelope_digest),
        UNIQUE(journal_sequence, envelope_digest, envelope_kind)
      );
      CREATE TABLE sandboxes.external_read_probe_anchors (
        operation_id TEXT NOT NULL REFERENCES sandboxes.operations(operation_id),
        operation_step_id TEXT NOT NULL,
        operation_execution_epoch BIGINT NOT NULL CHECK (operation_execution_epoch >= 1),
        journal_sequence BIGINT NOT NULL,
        envelope_digest TEXT NOT NULL,
        anchor_kind TEXT NOT NULL CHECK (anchor_kind = 'READ_PROBE'),
        record_json JSONB NOT NULL,
        PRIMARY KEY(operation_id, operation_step_id, operation_execution_epoch, envelope_digest),
        UNIQUE(journal_sequence),
        FOREIGN KEY(journal_sequence, envelope_digest, anchor_kind)
          REFERENCES sandboxes.external_journal_frontiers(
            journal_sequence, envelope_digest, envelope_kind
          )
      );
      CREATE INDEX external_journal_frontier
        ON sandboxes.external_journal_frontiers(frontier_digest);
    `,
  },
  {
    version: 3,
    name: "immutable_effect_execution_records_v1",
    sql: `
      CREATE TABLE sandboxes.effect_journal_records (
        operation_id TEXT NOT NULL REFERENCES sandboxes.operations(operation_id),
        operation_step_id TEXT NOT NULL,
        operation_execution_epoch BIGINT NOT NULL CHECK (operation_execution_epoch >= 1),
        record_kind TEXT NOT NULL CHECK (record_kind IN ('DISPATCHED', 'OUTCOME')),
        outcome_kind TEXT,
        journal_sequence BIGINT NOT NULL,
        envelope_digest TEXT NOT NULL,
        record_json JSONB NOT NULL,
        PRIMARY KEY(operation_id, operation_step_id, operation_execution_epoch, record_kind),
        UNIQUE(journal_sequence),
        FOREIGN KEY(journal_sequence, envelope_digest, record_kind)
          REFERENCES sandboxes.external_journal_frontiers(
            journal_sequence, envelope_digest, envelope_kind
          ),
        CHECK (
          (record_kind = 'DISPATCHED' AND outcome_kind IS NULL) OR
          (record_kind = 'OUTCOME' AND outcome_kind IN (
            'succeeded', 'failed_effect', 'failed_no_effect', 'reconciliation_blocked'
          ))
        )
      );
    `,
  },
  {
    version: 4,
    name: "immutable_safety_and_destroy_evidence_v1",
    sql: `
      CREATE TABLE sandboxes.safety_fence_observations (
        observation_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES sandboxes.sandbox_records(resource_id),
        observation_sha256 TEXT NOT NULL UNIQUE
          CHECK (observation_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        recorded_at TIMESTAMPTZ NOT NULL,
        record_json JSONB NOT NULL
      );
      CREATE INDEX safety_fence_observations_resource
        ON sandboxes.safety_fence_observations(resource_id, recorded_at, observation_id);
      CREATE TABLE sandboxes.destroy_tombstones (
        resource_id TEXT PRIMARY KEY REFERENCES sandboxes.sandbox_records(resource_id),
        tombstone_id TEXT NOT NULL UNIQUE,
        destroy_operation_id TEXT NOT NULL UNIQUE,
        tombstone_sha256 TEXT NOT NULL UNIQUE
          CHECK (tombstone_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        record_json JSONB NOT NULL
      );
    `,
  },
  {
    version: 5,
    name: "immutable_checkpoint_and_promotion_receipts_v1",
    sql: `
      CREATE TABLE sandboxes.immutable_checkpoint_receipts (
        receipt_sha256 TEXT PRIMARY KEY
          CHECK (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        receipt_id TEXT NOT NULL UNIQUE,
        resource_id TEXT NOT NULL REFERENCES sandboxes.sandbox_records(resource_id),
        record_json JSONB NOT NULL
      );
      CREATE INDEX immutable_checkpoint_receipts_resource
        ON sandboxes.immutable_checkpoint_receipts(resource_id, receipt_id);
      CREATE TABLE sandboxes.immutable_git_promotion_receipts (
        receipt_sha256 TEXT PRIMARY KEY
          CHECK (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        receipt_id TEXT NOT NULL UNIQUE,
        resource_id TEXT NOT NULL REFERENCES sandboxes.sandbox_records(resource_id),
        record_json JSONB NOT NULL
      );
      CREATE INDEX immutable_git_promotion_receipts_resource
        ON sandboxes.immutable_git_promotion_receipts(resource_id, receipt_id);
    `,
  },
  {
    version: 6,
    name: "durable_exec_stream_state_v1",
    sql: `
      CREATE TABLE sandboxes.exec_stream_states (
        resource_id TEXT NOT NULL REFERENCES sandboxes.sandbox_records(resource_id),
        exec_id TEXT NOT NULL,
        stream_root_sha256 TEXT NOT NULL
          CHECK (stream_root_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        next_expected_sequence BIGINT NOT NULL CHECK (next_expected_sequence >= 1),
        record_json JSONB NOT NULL,
        PRIMARY KEY(resource_id, exec_id)
      );
    `,
  },
  {
    version: 7,
    name: "exec_start_reservation_cas_v1",
    sql: `
      ALTER TABLE sandboxes.exec_stream_states
        ADD COLUMN start_operation_id TEXT,
        ADD COLUMN start_request_sha256 TEXT,
        ADD COLUMN phase TEXT NOT NULL DEFAULT 'started'
          CHECK (phase IN ('reserved', 'started')),
        ADD COLUMN terminal BOOLEAN NOT NULL DEFAULT false,
        ALTER COLUMN stream_root_sha256 DROP NOT NULL,
        ALTER COLUMN next_expected_sequence DROP NOT NULL;
      WITH matches AS (
        SELECT stream.resource_id, stream.exec_id,
               MIN(operation.operation_id) AS start_operation_id,
               MIN(operation.request_sha256) AS start_request_sha256
        FROM sandboxes.exec_stream_states AS stream
        JOIN sandboxes.operations AS operation
          ON operation.resource_id = stream.resource_id
         AND operation.operation = 'exec.start'
         AND operation.state = 'committed'
         AND operation.effect_phase = 'succeeded'
         AND operation.record_json #>> '{bounded_result,operation}' = 'exec.start'
         AND operation.record_json #>> '{bounded_result,result_document,exec_id}' = stream.exec_id
         AND operation.record_json #>> '{bounded_result,result_document,resource_id}' = stream.resource_id
         AND operation.record_json #>> '{bounded_result,result_document,request_sha256}' = operation.request_sha256
        GROUP BY stream.resource_id, stream.exec_id
        HAVING COUNT(operation.operation_id) = 1
      )
      UPDATE sandboxes.exec_stream_states AS stream
      SET start_operation_id = matches.start_operation_id,
          start_request_sha256 = matches.start_request_sha256,
          terminal = COALESCE((stream.record_json->>'terminal')::boolean, false),
          record_json = stream.record_json || jsonb_build_object(
            'start_operation_id', matches.start_operation_id,
            'start_request_sha256', matches.start_request_sha256,
            'phase', 'started'
          )
      FROM matches
      WHERE matches.resource_id = stream.resource_id
        AND matches.exec_id = stream.exec_id;
      ALTER TABLE sandboxes.exec_stream_states
        ALTER COLUMN start_operation_id SET NOT NULL,
        ALTER COLUMN start_request_sha256 SET NOT NULL,
        ALTER COLUMN phase DROP DEFAULT,
        ALTER COLUMN terminal DROP DEFAULT,
        ADD CONSTRAINT exec_stream_start_request_digest CHECK (
          start_request_sha256 ~ '^sha256:[0-9a-f]{64}$'
        );
    `,
  },
] as const;

export interface PostgresRepositoryConnectOptionsV1 {
  expected_runtime_role: string;
  expected_database: string;
  tls_ca: string | Uint8Array;
}

export interface PostgresMigrationOptionsV1 {
  expected_migration_role: string;
  expected_database: string;
}

function decodeRecord<T>(value: unknown): T {
  if (typeof value === "string") return parseStorageJson<T>(value);
  return parseStorageJson<T>(JSON.stringify(value));
}

function encoded(value: unknown): string {
  return storageJson(value);
}

function assertRoleName(value: string, field: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new SandboxError("validation_failed", `${field} is not a safe Postgres role name`);
  }
}

function assertExpectedDatabase(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SandboxError(
      "validation_failed",
      "expected_database is required for exact Postgres identity binding",
    );
  }
}

function stateDigest(value: unknown): string {
  return canonicalDigest(value);
}

function mapChanged<T>(before: Map<string, T>, after: Map<string, T>, key: string): boolean {
  const prior = before.get(key);
  const next = after.get(key);
  return prior === undefined || next === undefined || stateDigest(prior) !== stateDigest(next);
}

function assertNoDeletion<T>(before: Map<string, T>, after: Map<string, T>, domain: string): void {
  for (const key of before.keys()) {
    if (!after.has(key)) {
      throw new SandboxError("integrity_failed", `${domain} records cannot be physically deleted`);
    }
  }
}

function assertProtectedColumns(condition: boolean, domain: string): void {
  if (!condition) {
    throw new SandboxError(
      "integrity_failed",
      `Postgres ${domain} protected columns disagree with record bytes`,
    );
  }
}

function databaseBigInt(value: unknown, field: string): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  } catch {
    // Fall through to the integrity error below.
  }
  throw new SandboxError("integrity_failed", `Postgres ${field} is not an integer`);
}

function databaseNumber(value: unknown, field: string): number {
  const parsed = databaseBigInt(value, field);
  const number = Number(parsed);
  if (!Number.isSafeInteger(number)) {
    throw new SandboxError("integrity_failed", `Postgres ${field} exceeds safe integer range`);
  }
  return number;
}

function databaseIso(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new SandboxError("integrity_failed", `Postgres ${field} is not a timestamp`);
  }
  return date.toISOString();
}

function retryablePostgresTransaction(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const state = (error as { errno?: unknown }).errno;
  return state === "40001" || state === "40P01";
}

export class PostgresSandboxRepositoryV1 implements SandboxRepositoryV1 {
  readonly backend = "postgres" as const;
  readonly #client: PostgresClientV1;
  readonly #expectedRole: string;
  readonly #expectedDatabase: string;
  #ready = false;

  private constructor(client: PostgresClientV1, options: PostgresRepositoryConnectOptionsV1) {
    assertRoleName(options.expected_runtime_role, "expected_runtime_role");
    assertExpectedDatabase(options.expected_database);
    this.#client = client;
    this.#expectedRole = options.expected_runtime_role;
    this.#expectedDatabase = options.expected_database;
  }

  static async connect(
    url: string,
    options: PostgresRepositoryConnectOptionsV1,
  ): Promise<PostgresSandboxRepositoryV1> {
    const client = new BunPostgresClientV1(url, options.tls_ca);
    try {
      const repository = new PostgresSandboxRepositoryV1(client, options);
      await repository.#assertReady();
      repository.#ready = true;
      return repository;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  static async fromClient(
    client: PostgresClientV1,
    options: PostgresRepositoryConnectOptionsV1,
  ): Promise<PostgresSandboxRepositoryV1> {
    const repository = new PostgresSandboxRepositoryV1(client, options);
    await repository.#assertReady();
    repository.#ready = true;
    return repository;
  }

  static async applyMigrations(
    client: PostgresClientV1,
    options: PostgresMigrationOptionsV1,
  ): Promise<void> {
    assertRoleName(options.expected_migration_role, "expected_migration_role");
    assertExpectedDatabase(options.expected_database);
    await client.transaction(async (session) => {
      const identity = await session.query<{
        current_user: string;
        current_database: string;
        ssl_in_use: boolean;
      }>(`
        SELECT
          current_user::text AS current_user,
          current_database()::text AS current_database,
          COALESCE(
            (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()),
            false
          ) AS ssl_in_use
      `);
      const current = identity[0];
      if (
        current?.current_user !== options.expected_migration_role ||
        current.current_database !== options.expected_database ||
        current.ssl_in_use !== true
      ) {
        throw new SandboxError(
          "forbidden",
          "Postgres migration TLS, database, or role mismatch",
        );
      }
      await session.query("SELECT pg_advisory_xact_lock(72459057320338294)");
      await session.query(`
        CREATE SCHEMA IF NOT EXISTS sandboxes;
        CREATE TABLE IF NOT EXISTS sandboxes.schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum_sha256 TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        )
      `);
      for (const migration of POSTGRES_MIGRATIONS) {
        const checksum = sha256(migration.sql);
        const existing = await session.query<{ checksum_sha256: string }>(
          "SELECT checksum_sha256 FROM sandboxes.schema_migrations WHERE version = $1",
          [migration.version],
        );
        if (existing.length > 0) {
          if (existing[0]?.checksum_sha256 !== checksum) {
            throw new SandboxError("integrity_failed", "Postgres migration checksum mismatch");
          }
          continue;
        }
        await session.query(migration.sql);
        await session.query(
          `INSERT INTO sandboxes.schema_migrations(version, name, checksum_sha256)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, checksum],
        );
      }
    });
  }

  migrate(): void {
    if (!this.#ready) {
      throw new SandboxError(
        "dependency_unavailable",
        "Postgres runtime repository must pass readiness before service construction",
      );
    }
  }

  async databaseTime(): Promise<Date> {
    this.#requireReady();
    const rows = await this.#client.query<{ database_time: string | Date }>(
      "SELECT clock_timestamp() AS database_time",
    );
    const value = rows[0]?.database_time;
    if (value === undefined) throw new SandboxError("dependency_unavailable", "Postgres database time is unavailable");
    const databaseTime = new Date(value);
    if (Number.isNaN(databaseTime.getTime())) {
      throw new SandboxError("dependency_unavailable", "Postgres database time is invalid");
    }
    return databaseTime;
  }

  async transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): Promise<T> {
    this.#requireReady();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.#client.transaction(async (session) => {
          await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
          await session.query("SELECT pg_advisory_xact_lock(72459057320338295)");
          const nowRows = await session.query<{ database_time: string | Date }>(
            "SELECT clock_timestamp() AS database_time",
          );
          const databaseTime = new Date(nowRows[0]?.database_time ?? Number.NaN);
          if (Number.isNaN(databaseTime.getTime())) {
            throw new SandboxError("dependency_unavailable", "Postgres transaction database time is unavailable");
          }
          const before = await this.#loadState(session);
          const memory = new InMemorySandboxRepositoryV1(() => databaseTime, before);
          const result = await memory.transaction(fn);
          const after = memory.exportPersistenceState();
          await this.#persistState(session, before, after);
          return result;
        });
      } catch (error) {
        if (!retryablePostgresTransaction(error)) throw error;
        if (attempt === 3) {
          throw new SandboxError(
            "dependency_unavailable",
            "Postgres serializable transaction retry budget was exhausted",
          );
        }
      }
    }
    throw new SandboxError("internal_failure", "Postgres transaction retry loop was unreachable");
  }

  async health(): Promise<RepositoryHealthV1> {
    this.#requireReady();
    await this.#assertReady();
    const counts = await this.#client.query<{ sandbox_count: string | number; operation_count: string | number }>(`
      SELECT
        (SELECT COUNT(*) FROM sandboxes.sandbox_records) AS sandbox_count,
        (SELECT COUNT(*) FROM sandboxes.operations) AS operation_count
    `);
    const row = counts[0];
    return {
      backend: "postgres",
      schema_version: POSTGRES_MIGRATIONS.length,
      integrity: "ok",
      sandbox_count: Number(row?.sandbox_count ?? 0),
      operation_count: Number(row?.operation_count ?? 0),
    };
  }

  async close(): Promise<void> {
    await this.#client.close();
  }

  #requireReady(): void {
    if (!this.#ready) throw new SandboxError("dependency_unavailable", "Postgres repository is not ready");
  }

  async #assertReady(): Promise<void> {
    const identity = await this.#client.query<{
      current_user: string;
      current_database: string;
      ssl_in_use: boolean;
      can_create_schema: boolean;
      can_create_database: boolean;
      can_create_temporary: boolean;
      member_of_schema_owner: boolean;
      can_mutate_migrations: boolean;
    }>(`
      SELECT
        current_user::text AS current_user,
        current_database()::text AS current_database,
        COALESCE(
          (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()),
          false
        ) AS ssl_in_use,
        has_schema_privilege(current_user, 'sandboxes', 'CREATE') AS can_create_schema,
        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
        has_database_privilege(current_user, current_database(), 'TEMPORARY') AS can_create_temporary,
        COALESCE((
          SELECT pg_has_role(current_user, namespace_owner.oid, 'MEMBER')
          FROM (
            SELECT nspowner AS oid
            FROM pg_catalog.pg_namespace
            WHERE nspname = 'sandboxes'
          ) AS namespace_owner
        ), true) AS member_of_schema_owner,
        (
          has_table_privilege(current_user, 'sandboxes.schema_migrations', 'INSERT') OR
          has_table_privilege(current_user, 'sandboxes.schema_migrations', 'UPDATE') OR
          has_table_privilege(current_user, 'sandboxes.schema_migrations', 'DELETE') OR
          has_table_privilege(current_user, 'sandboxes.schema_migrations', 'TRUNCATE') OR
          has_table_privilege(current_user, 'sandboxes.schema_migrations', 'TRIGGER')
        ) AS can_mutate_migrations
    `);
    const row = identity[0];
    if (
      row === undefined ||
      row.current_user !== this.#expectedRole ||
      row.current_database !== this.#expectedDatabase ||
      row.ssl_in_use !== true ||
      row.can_create_schema !== false ||
      row.can_create_database !== false ||
      row.can_create_temporary !== false ||
      row.member_of_schema_owner !== false ||
      row.can_mutate_migrations !== false
    ) {
      throw new SandboxError("forbidden", "Postgres TLS, database, or runtime-role readiness mismatch");
    }
    const migrations = await this.#client.query<{
      version: number;
      name: string;
      checksum_sha256: string;
    }>(`
      SELECT version, name, checksum_sha256
      FROM sandboxes.schema_migrations
      ORDER BY version ASC
    `);
    if (migrations.length !== POSTGRES_MIGRATIONS.length) {
      throw new SandboxError("integrity_failed", "Postgres migration set is incomplete");
    }
    for (const migration of POSTGRES_MIGRATIONS) {
      const stored = migrations.find((candidate) => Number(candidate.version) === migration.version);
      if (
        stored?.name !== migration.name ||
        stored.checksum_sha256 !== sha256(migration.sql)
      ) {
        throw new SandboxError("integrity_failed", "Postgres migration checksum mismatch");
      }
    }
  }

  async #loadState(session: PostgresSessionV1): Promise<SandboxRepositoryStateV1> {
    const state = createSandboxRepositoryStateV1();
    const sandboxes = await session.query<{
      resource_id: string;
      revision: string | number | bigint;
      state: string;
      record_json: unknown;
    }>(
      "SELECT resource_id, revision, state, record_json FROM sandboxes.sandbox_records ORDER BY resource_id",
    );
    for (const row of sandboxes) {
      const record = decodeRecord<SandboxV1>(row.record_json);
      assertProtectedColumns(
        record.id === row.resource_id &&
          record.resource_id === row.resource_id &&
          record.revision === databaseNumber(row.revision, "sandbox revision") &&
          record.state === row.state,
        "sandbox",
      );
      state.sandboxes.set(record.id, record);
    }
    const highWaterRows = await session.query<{
      resource_id: string;
      authority_epoch: string | number | bigint;
      route_epoch: string | number | bigint;
      lease_epoch: string | number | bigint;
      resource_lifecycle_generation: string | number | bigint;
      operation_execution_epoch: string | number | bigint;
    }>(`
      SELECT resource_id, authority_epoch, route_epoch, lease_epoch,
             resource_lifecycle_generation, operation_execution_epoch
      FROM sandboxes.fence_high_watermarks
      ORDER BY resource_id
    `);
    const highWaterByResource = new Map(
      highWaterRows.map((row) => [row.resource_id, row] as const),
    );
    assertProtectedColumns(
      highWaterByResource.size === state.sandboxes.size,
      "complete-fence high-water",
    );
    for (const record of state.sandboxes.values()) {
      const highWater = highWaterByResource.get(record.id);
      assertProtectedColumns(
        highWater !== undefined &&
          record.authority_epoch === databaseBigInt(highWater.authority_epoch, "authority epoch") &&
          record.route_epoch === databaseBigInt(highWater.route_epoch, "route epoch") &&
          record.lease_epoch === databaseBigInt(highWater.lease_epoch, "lease epoch") &&
          record.resource_lifecycle_generation === databaseBigInt(
            highWater.resource_lifecycle_generation,
            "resource lifecycle generation",
          ) &&
          record.operation_execution_epoch === databaseBigInt(
            highWater.operation_execution_epoch,
            "operation execution epoch",
          ),
        "complete-fence high-water",
      );
    }
    const handles = await session.query<{
      resource_id: string;
      provider_handle_sha256: string;
      record_json: unknown;
    }>(
      "SELECT resource_id, provider_handle_sha256, record_json FROM sandboxes.adapter_resources ORDER BY resource_id",
    );
    for (const row of handles) {
      const record = decodeRecord<SealedProviderHandleV1>(row.record_json);
      assertProtectedColumns(
        record.resource_id === row.resource_id &&
          record.provider_handle_sha256 === row.provider_handle_sha256,
        "adapter resource",
      );
      state.handles.set(record.resource_id, record);
    }
    const execStreams = await session.query<{
      resource_id: string;
      exec_id: string;
      start_operation_id: string;
      start_request_sha256: string;
      phase: string;
      terminal: boolean;
      stream_root_sha256: string | null;
      next_expected_sequence: string | number | bigint | null;
      record_json: unknown;
    }>(`
      SELECT resource_id, exec_id, start_operation_id, start_request_sha256,
             phase, terminal, stream_root_sha256, next_expected_sequence, record_json
      FROM sandboxes.exec_stream_states ORDER BY resource_id, exec_id
    `);
    for (const row of execStreams) {
      const record = decodeRecord<ExecStreamStateV1>(row.record_json);
      assertExecStreamStateTransitionV1(null, record);
      assertProtectedColumns(
        record.resource_id === row.resource_id && record.exec_id === row.exec_id &&
          record.start_operation_id === row.start_operation_id &&
          record.start_request_sha256 === row.start_request_sha256 &&
          record.phase === row.phase &&
          record.terminal === row.terminal &&
          record.stream_root_sha256 === row.stream_root_sha256 &&
          record.next_expected_sequence === (row.next_expected_sequence === null
            ? null
            : databaseBigInt(row.next_expected_sequence, "exec stream next expected sequence")),
        "exec stream state",
      );
      state.execStreamStates.set(`${record.resource_id}\u0000${record.exec_id}`, record);
    }
    const operations = await session.query<{
      operation_id: string;
      operation: string;
      resource_id: string;
      actor_principal: string;
      idempotency_key_sha256: string;
      request_sha256: string;
      state: string;
      effect_phase: string;
      operation_step_id: string | null;
      dispatch_anchor_sha256: string | null;
      expected_resource_lifecycle_generation: string | number | bigint;
      successor_resource_lifecycle_generation: string | number | bigint;
      operation_execution_epoch: string | number | bigint;
      provider_idempotency_token_sha256: string | null;
      provider_creation_token_sha256: string | null;
      immutable_fingerprint_sha256: string | null;
      authorization_consumption_receipt_sha256: string | null;
      record_json: unknown;
    }>(
      `SELECT operation_id, operation, resource_id, actor_principal,
              idempotency_key_sha256, request_sha256, state, effect_phase,
              operation_step_id, dispatch_anchor_sha256,
              expected_resource_lifecycle_generation,
              successor_resource_lifecycle_generation,
              operation_execution_epoch,
              provider_idempotency_token_sha256,
              provider_creation_token_sha256,
              immutable_fingerprint_sha256,
              authorization_consumption_receipt_sha256,
              record_json
       FROM sandboxes.operations ORDER BY operation_id`,
    );
    for (const row of operations) {
      const record = decodeRecord<OperationRecordV1>(row.record_json);
      assertProtectedColumns(
        record.operation_id === row.operation_id &&
          record.operation === row.operation &&
          record.resource_id === row.resource_id &&
          record.actor_principal === row.actor_principal &&
          record.idempotency_key_sha256 === row.idempotency_key_sha256 &&
          record.request_sha256 === row.request_sha256 &&
          record.state === row.state &&
          record.effect_phase === row.effect_phase &&
          (record.operation_step_id ?? null) === row.operation_step_id &&
          (record.dispatch_journal_anchor_sha256 ?? null) === row.dispatch_anchor_sha256 &&
          record.expected_resource_lifecycle_generation === databaseBigInt(
            row.expected_resource_lifecycle_generation,
            "operation expected resource lifecycle generation",
          ) &&
          record.successor_resource_lifecycle_generation === databaseBigInt(
            row.successor_resource_lifecycle_generation,
            "operation successor resource lifecycle generation",
          ) &&
          record.fence.operation_execution_epoch === databaseBigInt(
            row.operation_execution_epoch,
            "operation execution epoch",
          ) &&
          (record.provider_target?.provider_idempotency_token_sha256 ?? null) ===
            row.provider_idempotency_token_sha256 &&
          (record.provider_target?.provider_creation_token_sha256 ?? null) ===
            row.provider_creation_token_sha256 &&
          (record.provider_target?.immutable_fingerprint_sha256 ?? null) ===
            row.immutable_fingerprint_sha256 &&
          (record.provider_target?.authorization_consumption_receipt_sha256 ?? null) ===
            row.authorization_consumption_receipt_sha256,
        "operation",
      );
      state.operations.set(record.operation_id, record);
      state.idempotency.set(
        operationIdempotencyKeyV1(
          record.actor_principal,
          record.operation,
          record.resource_id,
          record.idempotency_key_sha256,
        ),
        record.operation_id,
      );
    }
    await this.#loadUses(session, "capability_uses", state.capabilityUses);
    await this.#loadUses(session, "activation_grant_uses", state.activationGrantUses);
    await this.#loadUses(session, "cleanup_grant_uses", state.cleanupGrantUses);
    const events = await session.query<{
      resource_id: string;
      sequence: string | number | bigint;
      event_id: string;
      outbox_event_id: string | null;
      outbox_payload_sha256: string | null;
      record_json: unknown;
    }>(
      `SELECT event.resource_id, event.sequence, event.event_id,
              outbox.event_id AS outbox_event_id,
              outbox.payload_sha256 AS outbox_payload_sha256,
              event.record_json
       FROM sandboxes.sandbox_events AS event
       LEFT JOIN sandboxes.outbox AS outbox ON outbox.event_id = event.event_id
       ORDER BY event.resource_id, event.sequence`,
    );
    for (const row of events) {
      const record = decodeRecord<SandboxEventV1>(row.record_json);
      assertProtectedColumns(
        record.resource_id === row.resource_id &&
          record.sequence === databaseNumber(row.sequence, "event sequence") &&
          record.event_id === row.event_id &&
          row.outbox_event_id === row.event_id &&
          row.outbox_payload_sha256 === record.payload_sha256,
        "event",
      );
      state.events.push(record);
    }
    // This database is a scoped projection of the authoritative Infinity journal.
    // Global sequence gaps are valid; conflicts for an observed mapping are not.
    const frontierRows = await session.query<{
      journal_sequence: string | number | bigint;
      prior_frontier_digest: string;
      record_digest: string;
      frontier_digest: string;
      envelope_digest: string;
      envelope_kind: string;
      recorded_at: string | Date;
    }>(`
      SELECT journal_sequence, prior_frontier_digest, record_digest,
             frontier_digest, envelope_digest, envelope_kind, recorded_at
      FROM sandboxes.external_journal_frontiers
      ORDER BY journal_sequence
    `);
    const mutations = await session.query<{
      operation_id: string;
      operation_step_id: string;
      operation_execution_epoch: string | number | bigint;
      record_kind: string;
      outcome_kind: string | null;
      journal_sequence: string | number | bigint;
      prior_frontier_digest: string;
      record_digest: string;
      frontier_digest: string;
      envelope_digest: string;
      envelope_kind: string;
      recorded_at: string | Date;
      record_json: unknown;
    }>(
      `SELECT journal.operation_id, journal.operation_step_id,
              journal.operation_execution_epoch, journal.record_kind,
              journal.outcome_kind, journal.journal_sequence,
              frontier.prior_frontier_digest, frontier.record_digest,
              frontier.frontier_digest, frontier.envelope_digest,
              frontier.envelope_kind, frontier.recorded_at,
              journal.record_json
       FROM sandboxes.effect_journal_records AS journal
       JOIN sandboxes.external_journal_frontiers AS frontier
         ON frontier.journal_sequence = journal.journal_sequence
        AND frontier.envelope_digest = journal.envelope_digest
       ORDER BY journal.operation_id, journal.operation_step_id,
                journal.operation_execution_epoch, journal.record_kind`,
    );
    const probes = await session.query<{
      operation_id: string;
      operation_step_id: string;
      operation_execution_epoch: string | number | bigint;
      journal_sequence: string | number | bigint;
      anchor_kind: string;
      prior_frontier_digest: string;
      record_digest: string;
      frontier_digest: string;
      envelope_digest: string;
      envelope_kind: string;
      recorded_at: string | Date;
      record_json: unknown;
    }>(
      `SELECT probe.operation_id, probe.operation_step_id,
              probe.operation_execution_epoch, probe.journal_sequence,
              probe.anchor_kind,
              frontier.prior_frontier_digest, frontier.record_digest,
              frontier.frontier_digest, frontier.envelope_digest,
              frontier.envelope_kind, frontier.recorded_at,
              probe.record_json
       FROM sandboxes.external_read_probe_anchors AS probe
       JOIN sandboxes.external_journal_frontiers AS frontier
         ON frontier.journal_sequence = probe.journal_sequence
        AND frontier.envelope_digest = probe.envelope_digest
       ORDER BY probe.operation_id, probe.operation_step_id,
                probe.operation_execution_epoch, frontier.envelope_digest`,
    );
    const loadedJournalSequences = new Set<string>();
    let loadedJournalReferenceCount = 0;
    for (const row of mutations) {
      const record = decodeRecord<ExternalOperationAnchorRecordV1>(row.record_json);
      loadedJournalReferenceCount += 1;
      loadedJournalSequences.add(databaseBigInt(row.journal_sequence, "journal sequence").toString(10));
      assertProtectedColumns(
        !("anchor_kind" in record) &&
          record.operation_id === row.operation_id &&
          record.operation_step_id === row.operation_step_id &&
          record.operation_execution_epoch === databaseBigInt(
            row.operation_execution_epoch,
            "effect journal execution epoch",
          ) &&
          record.record_kind === row.record_kind &&
          (record.record_kind === "OUTCOME" ? record.outcome_kind : null) === row.outcome_kind &&
          record.journal_sequence === databaseBigInt(row.journal_sequence, "journal sequence") &&
          record.prior_frontier_digest === row.prior_frontier_digest &&
          record.record_digest === row.record_digest &&
          record.frontier_digest === row.frontier_digest &&
          record.envelope_digest === row.envelope_digest &&
          row.envelope_kind === record.record_kind &&
          record.recorded_at === databaseIso(row.recorded_at, "journal recorded_at"),
        "effect journal",
      );
      state.externalAnchors.push(record);
    }
    for (const row of probes) {
      const record = decodeRecord<ExternalOperationAnchorRecordV1>(row.record_json);
      loadedJournalReferenceCount += 1;
      loadedJournalSequences.add(databaseBigInt(row.journal_sequence, "journal sequence").toString(10));
      assertProtectedColumns(
        "anchor_kind" in record &&
          record.anchor_kind === "READ_PROBE" &&
          row.anchor_kind === record.anchor_kind &&
          record.operation_id === row.operation_id &&
          record.operation_step_id === row.operation_step_id &&
          record.operation_execution_epoch === databaseBigInt(
            row.operation_execution_epoch,
            "read probe execution epoch",
          ) &&
          record.journal_sequence === databaseBigInt(row.journal_sequence, "journal sequence") &&
          record.prior_frontier_digest === row.prior_frontier_digest &&
          record.record_digest === row.record_digest &&
          record.frontier_digest === row.frontier_digest &&
          record.envelope_digest === row.envelope_digest &&
          row.envelope_kind === record.anchor_kind &&
          record.recorded_at === databaseIso(row.recorded_at, "read probe recorded_at"),
        "read probe",
      );
      state.externalAnchors.push(record);
    }
    assertProtectedColumns(
      loadedJournalSequences.size === frontierRows.length &&
        loadedJournalReferenceCount === frontierRows.length,
      "external journal frontier",
    );
    const checkpointReceipts = await session.query<{
      receipt_sha256: string;
      receipt_id: string;
      resource_id: string;
      record_json: unknown;
    }>(`
      SELECT receipt_sha256, receipt_id, resource_id, record_json
      FROM sandboxes.immutable_checkpoint_receipts
      ORDER BY resource_id, receipt_id
    `);
    for (const row of checkpointReceipts) {
      const record = decodeRecord<CheckpointDurabilityReceiptV1>(row.record_json);
      assertProtectedColumns(
        record.receipt_sha256 === row.receipt_sha256 &&
          record.receipt_id === row.receipt_id &&
          record.resource_id === row.resource_id,
        "checkpoint receipt",
      );
      state.checkpointReceipts.set(record.receipt_sha256, record);
    }
    const promotionReceipts = await session.query<{
      receipt_sha256: string;
      receipt_id: string;
      resource_id: string;
      record_json: unknown;
    }>(`
      SELECT receipt_sha256, receipt_id, resource_id, record_json
      FROM sandboxes.immutable_git_promotion_receipts
      ORDER BY resource_id, receipt_id
    `);
    for (const row of promotionReceipts) {
      const record = decodeRecord<GitPromotionReceiptRefV1>(row.record_json);
      assertProtectedColumns(
        record.receipt_sha256 === row.receipt_sha256 &&
          record.receipt_id === row.receipt_id &&
          record.resource_id === row.resource_id,
        "Git promotion receipt",
      );
      state.gitPromotionReceipts.set(record.receipt_sha256, record);
    }
    const observations = await session.query<{
      observation_id: string;
      resource_id: string;
      observation_sha256: string;
      recorded_at: string | Date;
      record_json: unknown;
    }>(`
      SELECT observation_id, resource_id, observation_sha256, recorded_at, record_json
      FROM sandboxes.safety_fence_observations
      ORDER BY resource_id, recorded_at, observation_id
    `);
    for (const row of observations) {
      const record = decodeRecord<StoredSafetyFenceObservationV1>(row.record_json);
      assertProtectedColumns(
        record.observation_id === row.observation_id &&
          record.resource_id === row.resource_id &&
          record.observation_sha256 === row.observation_sha256 &&
          record.recorded_at === databaseIso(row.recorded_at, "safety observation recorded_at"),
        "safety observation",
      );
      state.safetyObservations.set(record.observation_id, record);
    }
    const tombstones = await session.query<{
      resource_id: string;
      tombstone_id: string;
      destroy_operation_id: string;
      tombstone_sha256: string;
      record_json: unknown;
    }>(`
      SELECT resource_id, tombstone_id, destroy_operation_id, tombstone_sha256, record_json
      FROM sandboxes.destroy_tombstones
      ORDER BY resource_id
    `);
    for (const row of tombstones) {
      const record = decodeRecord<SandboxDestroyTombstoneV1>(row.record_json);
      assertProtectedColumns(
        record.resource_id === row.resource_id &&
          record.tombstone_id === row.tombstone_id &&
          record.destroy_operation_id === row.destroy_operation_id &&
          record.tombstone_sha256 === row.tombstone_sha256,
        "destroy tombstone",
      );
      state.destroyTombstones.set(record.resource_id, record);
    }
    return state;
  }

  async #loadUses(
    session: PostgresSessionV1,
    table: "capability_uses" | "activation_grant_uses" | "cleanup_grant_uses",
    output: Map<string, string>,
  ): Promise<void> {
    const rows = await session.query<{ use_sha256: string; operation_id: string }>(
      `SELECT use_sha256, operation_id FROM sandboxes.${table} ORDER BY use_sha256`,
    );
    for (const row of rows) output.set(row.use_sha256, row.operation_id);
  }

  async #persistState(
    session: PostgresSessionV1,
    before: SandboxRepositoryStateV1,
    after: SandboxRepositoryStateV1,
  ): Promise<void> {
    assertNoDeletion(before.sandboxes, after.sandboxes, "sandbox");
    assertNoDeletion(before.handles, after.handles, "adapter resource");
    assertNoDeletion(before.operations, after.operations, "operation");
    assertNoDeletion(before.execStreamStates, after.execStreamStates, "exec stream state");
    assertNoDeletion(before.capabilityUses, after.capabilityUses, "capability use");
    assertNoDeletion(before.activationGrantUses, after.activationGrantUses, "activation grant use");
    assertNoDeletion(before.cleanupGrantUses, after.cleanupGrantUses, "cleanup grant use");
    assertNoDeletion(before.checkpointReceipts, after.checkpointReceipts, "checkpoint receipt");
    assertNoDeletion(before.gitPromotionReceipts, after.gitPromotionReceipts, "Git promotion receipt");
    assertNoDeletion(before.safetyObservations, after.safetyObservations, "safety observation");
    assertNoDeletion(before.destroyTombstones, after.destroyTombstones, "destroy tombstone");

    for (const [resourceId, record] of after.sandboxes) {
      if (!mapChanged(before.sandboxes, after.sandboxes, resourceId)) continue;
      const prior = before.sandboxes.get(resourceId);
      if (prior === undefined) {
        await session.query(
          `INSERT INTO sandboxes.sandbox_records(resource_id, revision, state, record_json)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [record.id, record.revision, record.state, encoded(record)],
        );
      } else {
        const updated = await session.query<{ resource_id: string }>(
          `UPDATE sandboxes.sandbox_records
           SET revision = $2, state = $3, record_json = $4::jsonb
           WHERE resource_id = $1 AND revision = $5
           RETURNING resource_id`,
          [record.id, record.revision, record.state, encoded(record), prior.revision],
        );
        if (updated.length !== 1) throw new SandboxError("stale_revision", "Postgres sandbox CAS failed");
      }
      const highWater = await session.query<{ resource_id: string }>(
        `INSERT INTO sandboxes.fence_high_watermarks(
           resource_id, authority_epoch, route_epoch, lease_epoch,
           resource_lifecycle_generation, operation_execution_epoch
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(resource_id) DO UPDATE SET
           authority_epoch = EXCLUDED.authority_epoch,
           route_epoch = EXCLUDED.route_epoch,
           lease_epoch = EXCLUDED.lease_epoch,
           resource_lifecycle_generation = EXCLUDED.resource_lifecycle_generation,
           operation_execution_epoch = EXCLUDED.operation_execution_epoch
         WHERE EXCLUDED.authority_epoch >= sandboxes.fence_high_watermarks.authority_epoch
           AND EXCLUDED.route_epoch >= sandboxes.fence_high_watermarks.route_epoch
           AND EXCLUDED.lease_epoch >= sandboxes.fence_high_watermarks.lease_epoch
           AND EXCLUDED.resource_lifecycle_generation >= sandboxes.fence_high_watermarks.resource_lifecycle_generation
           AND EXCLUDED.operation_execution_epoch >= sandboxes.fence_high_watermarks.operation_execution_epoch
         RETURNING resource_id`,
        [
          record.id,
          record.authority_epoch.toString(10),
          record.route_epoch.toString(10),
          record.lease_epoch.toString(10),
          record.resource_lifecycle_generation.toString(10),
          record.operation_execution_epoch.toString(10),
        ],
      );
      if (highWater.length !== 1) {
        throw new SandboxError(
          "stale_resource_lifecycle_generation",
          "Postgres complete-fence high-water compare-and-swap failed",
        );
      }
    }

    for (const [resourceId, handle] of after.handles) {
      if (!mapChanged(before.handles, after.handles, resourceId)) continue;
      await session.query(
        `INSERT INTO sandboxes.adapter_resources(resource_id, provider_handle_sha256, record_json)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT(resource_id) DO UPDATE SET
           provider_handle_sha256 = EXCLUDED.provider_handle_sha256,
           record_json = EXCLUDED.record_json`,
        [resourceId, handle.provider_handle_sha256, encoded(handle)],
      );
    }

    for (const [identity, streamState] of after.execStreamStates) {
      if (!mapChanged(before.execStreamStates, after.execStreamStates, identity)) continue;
      const prior = before.execStreamStates.get(identity);
      if (prior === undefined) {
        await session.query(
          `INSERT INTO sandboxes.exec_stream_states(
             resource_id, exec_id, start_operation_id, start_request_sha256,
             phase, terminal, stream_root_sha256, next_expected_sequence, record_json
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
          [
            streamState.resource_id,
            streamState.exec_id,
            streamState.start_operation_id,
            streamState.start_request_sha256,
            streamState.phase,
            streamState.terminal,
            streamState.stream_root_sha256,
            streamState.next_expected_sequence?.toString(10) ?? null,
            encoded(streamState),
          ],
        );
      } else {
        const updated = await session.query<{ resource_id: string }>(
          `UPDATE sandboxes.exec_stream_states SET
             start_operation_id = $3, start_request_sha256 = $4,
             phase = $5, terminal = $6, stream_root_sha256 = $7,
             next_expected_sequence = $8, record_json = $9::jsonb
           WHERE resource_id = $1 AND exec_id = $2 AND record_json = $10::jsonb
           RETURNING resource_id`,
          [
            streamState.resource_id,
            streamState.exec_id,
            streamState.start_operation_id,
            streamState.start_request_sha256,
            streamState.phase,
            streamState.terminal,
            streamState.stream_root_sha256,
            streamState.next_expected_sequence?.toString(10) ?? null,
            encoded(streamState),
            encoded(prior),
          ],
        );
        if (updated.length !== 1) {
          throw new SandboxError("stale_revision", "Postgres exec stream CAS failed");
        }
      }
    }

    for (const [operationId, record] of after.operations) {
      if (!mapChanged(before.operations, after.operations, operationId)) continue;
      const prior = before.operations.get(operationId);
      if (prior === undefined) {
        await session.query(
          `INSERT INTO sandboxes.operations(
             operation_id, operation, resource_id, actor_principal,
             idempotency_key_sha256, request_sha256, state, effect_phase,
             operation_step_id, dispatch_anchor_sha256,
             expected_resource_lifecycle_generation,
             successor_resource_lifecycle_generation,
             operation_execution_epoch,
             provider_idempotency_token_sha256,
             provider_creation_token_sha256,
             immutable_fingerprint_sha256,
             authorization_consumption_receipt_sha256,
             record_json
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb
           )`,
          [
            record.operation_id,
            record.operation,
            record.resource_id,
            record.actor_principal,
            record.idempotency_key_sha256,
            record.request_sha256,
            record.state,
            record.effect_phase,
            record.operation_step_id ?? null,
            record.dispatch_journal_anchor_sha256 ?? null,
            record.expected_resource_lifecycle_generation.toString(10),
            record.successor_resource_lifecycle_generation.toString(10),
            record.fence.operation_execution_epoch.toString(10),
            record.provider_target?.provider_idempotency_token_sha256 ?? null,
            record.provider_target?.provider_creation_token_sha256 ?? null,
            record.provider_target?.immutable_fingerprint_sha256 ?? null,
            record.provider_target?.authorization_consumption_receipt_sha256 ?? null,
            encoded(record),
          ],
        );
      } else {
        if (canonicalDigest({
          operation: prior.operation,
          resource_id: prior.resource_id,
          actor_principal: prior.actor_principal,
          idempotency_key_sha256: prior.idempotency_key_sha256,
          request_sha256: prior.request_sha256,
          expected_resource_lifecycle_generation:
            prior.expected_resource_lifecycle_generation,
          successor_resource_lifecycle_generation:
            prior.successor_resource_lifecycle_generation,
          provider_target: prior.provider_target ?? null,
        }) !== canonicalDigest({
          operation: record.operation,
          resource_id: record.resource_id,
          actor_principal: record.actor_principal,
          idempotency_key_sha256: record.idempotency_key_sha256,
          request_sha256: record.request_sha256,
          expected_resource_lifecycle_generation:
            record.expected_resource_lifecycle_generation,
          successor_resource_lifecycle_generation:
            record.successor_resource_lifecycle_generation,
          provider_target: record.provider_target ?? null,
        })) {
          throw new SandboxError(
            "integrity_failed",
            "Postgres immutable operation intent changed bytes",
          );
        }
        const updated = await session.query<{ operation_id: string }>(
          `UPDATE sandboxes.operations SET
             state = $2, effect_phase = $3, operation_step_id = $4,
             dispatch_anchor_sha256 = $5, operation_execution_epoch = $6,
             record_json = $7::jsonb
           WHERE operation_id = $1
             AND record_json = $8::jsonb
             AND operation_execution_epoch = $9
           RETURNING operation_id`,
          [
            operationId,
            record.state,
            record.effect_phase,
            record.operation_step_id ?? null,
            record.dispatch_journal_anchor_sha256 ?? null,
            record.fence.operation_execution_epoch.toString(10),
            encoded(record),
            encoded(prior),
            prior.fence.operation_execution_epoch.toString(10),
          ],
        );
        if (updated.length !== 1) throw new SandboxError("stale_revision", "Postgres operation CAS failed");
      }
    }

    await this.#persistUses(session, "capability_uses", before.capabilityUses, after.capabilityUses);
    await this.#persistUses(session, "activation_grant_uses", before.activationGrantUses, after.activationGrantUses);
    await this.#persistUses(session, "cleanup_grant_uses", before.cleanupGrantUses, after.cleanupGrantUses);

    const eventKeys = new Set(before.events.map((event) => `${event.resource_id}\u0000${event.sequence}`));
    for (const event of after.events) {
      const key = `${event.resource_id}\u0000${event.sequence}`;
      if (eventKeys.has(key)) continue;
      await session.query(
        `INSERT INTO sandboxes.sandbox_events(resource_id, sequence, event_id, record_json)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [event.resource_id, event.sequence, event.event_id, encoded(event)],
      );
      await session.query(
        `INSERT INTO sandboxes.outbox(event_id, payload_sha256) VALUES ($1, $2)`,
        [event.event_id, event.payload_sha256],
      );
    }

    const anchorKeys = new Map(before.externalAnchors.map((record) => [
      this.#anchorIdentity(record),
      stateDigest(record),
    ]));
    for (const record of after.externalAnchors) {
      const identity = this.#anchorIdentity(record);
      const priorDigest = anchorKeys.get(identity);
      if (priorDigest !== undefined) {
        if (priorDigest !== stateDigest(record)) {
          throw new SandboxError("integrity_failed", "Postgres external anchor identity changed bytes");
        }
        continue;
      }
      await session.query(
        `INSERT INTO sandboxes.external_journal_frontiers(
           journal_sequence, prior_frontier_digest, record_digest,
           frontier_digest, envelope_digest, envelope_kind, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          record.journal_sequence.toString(10),
          record.prior_frontier_digest,
          record.record_digest,
          record.frontier_digest,
          record.envelope_digest,
          "anchor_kind" in record ? record.anchor_kind : record.record_kind,
          record.recorded_at,
        ],
      );
      if ("anchor_kind" in record) {
        await session.query(
          `INSERT INTO sandboxes.external_read_probe_anchors(
             operation_id, operation_step_id, operation_execution_epoch,
             journal_sequence, envelope_digest, anchor_kind, record_json
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            record.operation_id,
            record.operation_step_id,
            record.operation_execution_epoch.toString(10),
            record.journal_sequence.toString(10),
            record.envelope_digest,
            record.anchor_kind,
            encoded(record),
          ],
        );
      } else {
        await session.query(
          `INSERT INTO sandboxes.effect_journal_records(
             operation_id, operation_step_id, operation_execution_epoch,
             record_kind, outcome_kind, journal_sequence, envelope_digest,
             record_json
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            record.operation_id,
            record.operation_step_id,
            record.operation_execution_epoch.toString(10),
            record.record_kind,
            record.record_kind === "OUTCOME" ? record.outcome_kind : null,
            record.journal_sequence.toString(10),
            record.envelope_digest,
            encoded(record),
          ],
        );
      }
    }

    for (const [receiptSha256, record] of after.checkpointReceipts) {
      const prior = before.checkpointReceipts.get(receiptSha256);
      if (prior !== undefined) {
        if (stateDigest(prior) !== stateDigest(record)) {
          throw new SandboxError(
            "integrity_failed",
            "Postgres immutable checkpoint receipt changed bytes",
          );
        }
        continue;
      }
      const receiptIdConflict = [...after.checkpointReceipts.entries()].find(
        ([otherDigest, candidate]) =>
          otherDigest !== receiptSha256 && candidate.receipt_id === record.receipt_id,
      );
      if (receiptIdConflict !== undefined) {
        throw new SandboxError(
          "integrity_failed",
          "Postgres checkpoint receipt identity conflicts with stored bytes",
        );
      }
      await session.query(
        `INSERT INTO sandboxes.immutable_checkpoint_receipts(
           receipt_sha256, receipt_id, resource_id, record_json
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [record.receipt_sha256, record.receipt_id, record.resource_id, encoded(record)],
      );
    }

    for (const [receiptSha256, record] of after.gitPromotionReceipts) {
      const prior = before.gitPromotionReceipts.get(receiptSha256);
      if (prior !== undefined) {
        if (stateDigest(prior) !== stateDigest(record)) {
          throw new SandboxError(
            "integrity_failed",
            "Postgres immutable Git promotion receipt changed bytes",
          );
        }
        continue;
      }
      const receiptIdConflict = [...after.gitPromotionReceipts.entries()].find(
        ([otherDigest, candidate]) =>
          otherDigest !== receiptSha256 && candidate.receipt_id === record.receipt_id,
      );
      if (receiptIdConflict !== undefined) {
        throw new SandboxError(
          "integrity_failed",
          "Postgres Git promotion receipt identity conflicts with stored bytes",
        );
      }
      await session.query(
        `INSERT INTO sandboxes.immutable_git_promotion_receipts(
           receipt_sha256, receipt_id, resource_id, record_json
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [record.receipt_sha256, record.receipt_id, record.resource_id, encoded(record)],
      );
    }

    for (const [observationId, record] of after.safetyObservations) {
      const prior = before.safetyObservations.get(observationId);
      if (prior !== undefined) {
        if (stateDigest(prior) !== stateDigest(record)) {
          throw new SandboxError(
            "integrity_failed",
            "Postgres immutable safety observation changed bytes",
          );
        }
        continue;
      }
      await session.query(
        `INSERT INTO sandboxes.safety_fence_observations(
           observation_id, resource_id, observation_sha256, recorded_at, record_json
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          record.observation_id,
          record.resource_id,
          record.observation_sha256,
          record.recorded_at,
          encoded(record),
        ],
      );
    }

    for (const [resourceId, record] of after.destroyTombstones) {
      const prior = before.destroyTombstones.get(resourceId);
      if (prior !== undefined) {
        if (stateDigest(prior) !== stateDigest(record)) {
          throw new SandboxError(
            "integrity_failed",
            "Postgres immutable destroy tombstone changed bytes",
          );
        }
        continue;
      }
      await session.query(
        `INSERT INTO sandboxes.destroy_tombstones(
           resource_id, tombstone_id, destroy_operation_id, tombstone_sha256, record_json
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          record.resource_id,
          record.tombstone_id,
          record.destroy_operation_id,
          record.tombstone_sha256,
          encoded(record),
        ],
      );
    }
  }

  async #persistUses(
    session: PostgresSessionV1,
    table: "capability_uses" | "activation_grant_uses" | "cleanup_grant_uses",
    before: Map<string, string>,
    after: Map<string, string>,
  ): Promise<void> {
    for (const [useSha256, operationId] of after) {
      const prior = before.get(useSha256);
      if (prior === operationId) continue;
      if (prior !== undefined) throw new SandboxError("capability_replayed", "Postgres authorization use conflict");
      await session.query(
        `INSERT INTO sandboxes.${table}(use_sha256, operation_id) VALUES ($1, $2)`,
        [useSha256, operationId],
      );
    }
  }

  #anchorIdentity(record: ExternalOperationAnchorRecordV1): string {
    return "anchor_kind" in record
      ? `READ_PROBE\u0000${record.operation_id}\u0000${record.operation_step_id}\u0000${record.operation_execution_epoch}\u0000${record.envelope_digest}`
      : `${record.record_kind}\u0000${record.operation_id}\u0000${record.operation_step_id}\u0000${record.operation_execution_epoch}`;
  }
}

export const POSTGRES_SCHEMA_MIGRATIONS_V1 = POSTGRES_MIGRATIONS.map((migration) => ({
  version: migration.version,
  name: migration.name,
  checksum_sha256: sha256(migration.sql),
}));

export {
  POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V1,
  POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V2,
  PostgresDisposableTaskJournalV1,
  applyPostgresDisposableTaskJournalMigrationV1,
  applyPostgresDisposableTaskJournalMigrationV2,
  loadPostgresDisposableTaskJournalMigrationSourceV1,
  loadPostgresDisposableTaskJournalMigrationSourceV2,
  createEd25519DisposableTaskJournalCryptoV1,
  type DisposableTaskJournalSignatureVerifierV1,
  type DisposableTaskJournalSignerV1,
  type DisposableTaskWitnessReceiptVerifierV1,
  type PostgresDisposableTaskJournalMigrationOptionsV1,
  type PostgresDisposableTaskJournalMigrationOptionsV2,
  type PostgresDisposableTaskJournalOptionsV1,
} from "./adapters/managed/disposable-task-postgres.js";

export {
  PostgresDurableJournalWitnessV1,
  applyPostgresDurableJournalWitnessMigrationV1,
  createEd25519DurableJournalWitnessCryptoV1,
  type DurableJournalWitnessSignatureVerifierV1,
  type DurableJournalWitnessSignerV1,
  type PostgresDurableJournalWitnessMigrationOptionsV1,
  type PostgresDurableJournalWitnessOptionsV1,
} from "./adapters/managed/durable-journal-witness-postgres.js";
