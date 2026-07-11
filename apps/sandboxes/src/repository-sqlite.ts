import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  assertDigest,
  assertOpaqueId,
  canonicalDigest,
  sha256,
  storageJson,
  parseStorageJson,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import type {
  RepositoryHealthV1,
  SandboxRepositoryTxV1,
  SandboxRepositoryV1,
} from "./repository.js";
import { assertExternalOperationAnchorRecordV1 } from "./repository.js";
import type {
  CheckpointDurabilityReceiptV1,
  ExecStreamStateV1,
  GitPromotionReceiptRefV1,
  OperationRecordV1,
  ExternalOperationAnchorRecordV1,
  SandboxEventV1,
  SandboxDestroyTombstoneV1,
  SandboxV1,
  SealedProviderHandleV1,
  StoredSafetyFenceObservationV1,
} from "./types.js";

const MIGRATIONS = [
  {
    version: 1,
    name: "runtime_core_v1",
    sql: `
      CREATE TABLE sandbox_records (
        resource_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        state TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE adapter_resources (
        resource_id TEXT PRIMARY KEY REFERENCES sandbox_records(resource_id),
        provider_handle_sha256 TEXT NOT NULL,
        sealed_handle TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE operations (
        operation_id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        actor_principal TEXT NOT NULL,
        idempotency_key_sha256 TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        state TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(actor_principal, operation, resource_id, idempotency_key_sha256)
      );
      CREATE TABLE capability_uses (
        use_sha256 TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id)
      );
      CREATE TABLE activation_grant_uses (
        use_sha256 TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id)
      );
      CREATE TABLE cleanup_grant_uses (
        use_sha256 TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id)
      );
      CREATE TABLE sandbox_events (
        resource_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,
        PRIMARY KEY(resource_id, sequence)
      );
      CREATE TABLE outbox (
        event_id TEXT PRIMARY KEY REFERENCES sandbox_events(event_id),
        payload_sha256 TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE TABLE checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        root_sha256 TEXT NOT NULL,
        receipt_sha256 TEXT UNIQUE,
        record_json TEXT NOT NULL
      );
      CREATE TABLE cleanup_requests (
        operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id),
        resource_id TEXT NOT NULL,
        basis_receipt_sha256 TEXT NOT NULL,
        destroy_receipt_sha256 TEXT,
        tombstone_json TEXT
      );
      CREATE TABLE fence_high_watermarks (
        resource_id TEXT PRIMARY KEY REFERENCES sandbox_records(resource_id),
        authority_epoch TEXT NOT NULL,
        route_epoch TEXT NOT NULL,
        lease_epoch TEXT NOT NULL,
        resource_lifecycle_generation TEXT NOT NULL,
        operation_execution_epoch TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "recoverable_effect_frontiers_v1",
    sql: `
      ALTER TABLE operations ADD COLUMN effect_phase TEXT NOT NULL DEFAULT 'intent_committed';
      ALTER TABLE operations ADD COLUMN operation_step_id TEXT;
      ALTER TABLE operations ADD COLUMN dispatch_anchor_sha256 TEXT;
      CREATE TABLE external_journal_frontiers (
        journal_sequence TEXT PRIMARY KEY,
        prior_frontier_digest TEXT NOT NULL,
        record_digest TEXT NOT NULL,
        frontier_digest TEXT NOT NULL UNIQUE,
        envelope_digest TEXT NOT NULL UNIQUE
      );
      CREATE TABLE external_read_probe_anchors (
        operation_id TEXT NOT NULL REFERENCES operations(operation_id),
        operation_step_id TEXT NOT NULL,
        operation_execution_epoch TEXT NOT NULL,
        journal_sequence TEXT NOT NULL REFERENCES external_journal_frontiers(journal_sequence),
        envelope_digest TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY(operation_id, operation_step_id, operation_execution_epoch, envelope_digest)
      );
      CREATE INDEX external_read_probe_anchors_frontier
        ON external_read_probe_anchors(journal_sequence);
    `,
  },
  {
    version: 3,
    name: "immutable_effect_execution_records_v1",
    sql: `
      CREATE TABLE effect_journal_records (
        operation_id TEXT NOT NULL REFERENCES operations(operation_id),
        operation_step_id TEXT NOT NULL,
        operation_execution_epoch TEXT NOT NULL,
        record_kind TEXT NOT NULL CHECK (record_kind IN ('DISPATCHED', 'OUTCOME')),
        outcome_kind TEXT CHECK (
          outcome_kind IS NULL OR outcome_kind IN (
            'succeeded', 'failed_effect', 'failed_no_effect', 'reconciliation_blocked'
          )
        ),
        journal_sequence TEXT NOT NULL REFERENCES external_journal_frontiers(journal_sequence),
        envelope_digest TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY(operation_id, operation_step_id, operation_execution_epoch, record_kind)
      );
      CREATE INDEX effect_journal_records_frontier
        ON effect_journal_records(journal_sequence);
    `,
  },
  {
    version: 4,
    name: "immutable_safety_and_destroy_evidence_v1",
    sql: `
      CREATE TABLE safety_fence_observations (
        observation_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL REFERENCES sandbox_records(resource_id),
        observation_sha256 TEXT NOT NULL UNIQUE,
        recorded_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE INDEX safety_fence_observations_resource
        ON safety_fence_observations(resource_id, recorded_at, observation_id);
      CREATE TABLE destroy_tombstones (
        resource_id TEXT PRIMARY KEY REFERENCES sandbox_records(resource_id),
        destroy_operation_id TEXT NOT NULL UNIQUE,
        tombstone_sha256 TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    name: "immutable_checkpoint_and_promotion_receipts_v1",
    sql: `
      CREATE TABLE immutable_checkpoint_receipts (
        receipt_sha256 TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL UNIQUE,
        resource_id TEXT NOT NULL REFERENCES sandbox_records(resource_id),
        record_json TEXT NOT NULL
      );
      CREATE INDEX immutable_checkpoint_receipts_resource
        ON immutable_checkpoint_receipts(resource_id, receipt_id);
      CREATE TABLE immutable_git_promotion_receipts (
        receipt_sha256 TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL UNIQUE,
        resource_id TEXT NOT NULL REFERENCES sandbox_records(resource_id),
        record_json TEXT NOT NULL
      );
      CREATE INDEX immutable_git_promotion_receipts_resource
        ON immutable_git_promotion_receipts(resource_id, receipt_id);
    `,
  },
  {
    version: 6,
    name: "durable_exec_stream_state_v1",
    sql: `
      CREATE TABLE exec_stream_states (
        resource_id TEXT NOT NULL REFERENCES sandbox_records(resource_id),
        exec_id TEXT NOT NULL,
        stream_root_sha256 TEXT NOT NULL,
        next_expected_sequence TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY(resource_id, exec_id)
      );
    `,
  },
] as const;

export interface SqliteRepositoryOptionsV1 {
  allow_in_memory?: boolean;
  allow_unsafe_test_path?: boolean;
  hermetic_test_database_time?: () => Date;
}

function ensureSecurePath(databasePath: string, allowUnsafe: boolean): string {
  if (databasePath === ":memory:") return databasePath;
  const absolute = resolve(databasePath);
  const parent = dirname(absolute);
  const assertAncestry = (start: string) => {
    let current = start;
    for (;;) {
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        throw new SandboxError("integrity_failed", "SQLite path ancestry cannot contain symlinks");
      }
      const next = dirname(current);
      if (next === current) break;
      current = next;
    }
  };
  assertAncestry(parent);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertAncestry(parent);
  const info = lstatSync(parent);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new SandboxError("integrity_failed", "SQLite parent must be a real directory");
  }
  if (!allowUnsafe) {
    const uid = typeof process.getuid === "function" ? process.getuid() : info.uid;
    if (info.uid !== uid || (info.mode & 0o077) !== 0) {
      throw new SandboxError("forbidden", "SQLite parent must be owner-controlled mode 0700");
    }
  }
  if (existsSync(absolute)) {
    const databaseInfo = lstatSync(absolute);
    if (databaseInfo.isSymbolicLink() || !databaseInfo.isFile()) {
      throw new SandboxError("integrity_failed", "SQLite database path must be a regular non-symlink file");
    }
  }
  return absolute;
}

export class SqliteSandboxRepositoryV1 implements SandboxRepositoryV1 {
  readonly backend = "sqlite" as const;
  readonly #db: Database;
  readonly #path: string;
  readonly #testDatabaseTime: (() => Date) | undefined;

  constructor(databasePath: string, options: SqliteRepositoryOptionsV1 = {}) {
    if (databasePath === ":memory:" && options.allow_in_memory !== true) {
      throw new SandboxError("forbidden", "In-memory SQLite requires explicit test authorization");
    }
    this.#path = ensureSecurePath(databasePath, options.allow_unsafe_test_path === true);
    if (options.hermetic_test_database_time !== undefined && options.allow_unsafe_test_path !== true) {
      throw new SandboxError("forbidden", "A synthetic database clock is hermetic-test-only");
    }
    this.#testDatabaseTime = options.hermetic_test_database_time;
    this.#db = new Database(this.#path, { create: true, strict: true });
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (this.#path !== ":memory:") {
      this.#db.exec("PRAGMA journal_mode = WAL;");
      chmodSync(this.#path, 0o600);
    }
  }

  migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    const apply = this.#db.transaction(() => {
      for (const migration of MIGRATIONS) {
        const checksum = sha256(migration.sql);
        const existing = this.#db
          .query<{ checksum_sha256: string }, [number]>(
            "SELECT checksum_sha256 FROM schema_migrations WHERE version = ?",
          )
          .get(migration.version);
        if (existing !== null) {
          if (existing.checksum_sha256 !== checksum) {
            throw new SandboxError("integrity_failed", "Migration checksum mismatch", {
              migration: migration.version,
            });
          }
          continue;
        }
        this.#db.exec(migration.sql);
        this.#db
          .query("INSERT INTO schema_migrations(version, name, checksum_sha256) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, checksum);
      }
    });
    apply.immediate();
  }

  async databaseTime(): Promise<Date> {
    if (this.#testDatabaseTime !== undefined) return new Date(this.#testDatabaseTime().getTime());
    const row = this.#db
      .query<{ now: string }, []>("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")
      .get();
    if (row === null) throw new SandboxError("dependency_unavailable", "SQLite database time is unavailable");
    return new Date(row.now);
  }

  async transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): Promise<T> {
    const transaction = this.#db.transaction(() => {
      const result = fn(this.#tx());
      if (
        result !== null &&
        typeof result === "object" &&
        "then" in result &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        throw new SandboxError("validation_failed", "Repository transaction callbacks must be synchronous");
      }
      return result;
    });
    return transaction.immediate();
  }

  async health(): Promise<RepositoryHealthV1> {
    const integrity = this.#db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") {
      throw new SandboxError("integrity_failed", "SQLite integrity check failed");
    }
    const schema = this.#db
      .query<{ version: number }, []>("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get()?.version ?? 0;
    const sandboxCount = this.#db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sandbox_records").get()?.count ?? 0;
    const operationCount = this.#db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM operations").get()?.count ?? 0;
    if (this.#path !== ":memory:" && (statSync(this.#path).mode & 0o077) !== 0) {
      throw new SandboxError("forbidden", "SQLite database permissions are too broad");
    }
    return {
      backend: "sqlite",
      schema_version: schema,
      integrity: "ok",
      sandbox_count: sandboxCount,
      operation_count: operationCount,
    };
  }

  async close(): Promise<void> {
    this.#db.close();
  }

  #tx(): SandboxRepositoryTxV1 {
    const db = this.#db;
    const testDatabaseTime = this.#testDatabaseTime;
    const parseSandbox = (row: { record_json: string } | null): SandboxV1 | undefined =>
      row === null ? undefined : parseStorageJson<SandboxV1>(row.record_json);
    type OperationRow = {
      record_json: string;
      effect_phase: string;
      operation_step_id: string | null;
      dispatch_anchor_sha256: string | null;
    };
    const parseOperation = (row: OperationRow | null): OperationRecordV1 | undefined => {
      if (row === null) return undefined;
      const record = parseStorageJson<OperationRecordV1>(row.record_json);
      if (
        record.effect_phase !== row.effect_phase ||
        (record.operation_step_id ?? null) !== row.operation_step_id ||
        (record.dispatch_journal_anchor_sha256 ?? null) !== row.dispatch_anchor_sha256
      ) {
        throw new SandboxError("integrity_failed", "Operation protected phase columns disagree with record bytes");
      }
      return record;
    };

    return {
      databaseTime() {
        if (testDatabaseTime !== undefined) return new Date(testDatabaseTime().getTime());
        const row = db.query<{ now: string }, []>(
          "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now",
        ).get();
        if (row === null) throw new SandboxError("dependency_unavailable", "SQLite database time is unavailable");
        return new Date(row.now);
      },
      getSandbox(resourceId) {
        return parseSandbox(
          db.query<{ record_json: string }, [string]>("SELECT record_json FROM sandbox_records WHERE resource_id = ?")
            .get(resourceId),
        );
      },
      listSandboxes() {
        return db
          .query<{ record_json: string }, []>("SELECT record_json FROM sandbox_records ORDER BY resource_id ASC")
          .all()
          .map((row) => parseStorageJson<SandboxV1>(row.record_json));
      },
      putSandbox(record, expectedRevision) {
        const persistHighWater = () => {
          const result = db.query(`
            INSERT INTO fence_high_watermarks(
              resource_id, authority_epoch, route_epoch, lease_epoch,
              resource_lifecycle_generation, operation_execution_epoch
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(resource_id) DO UPDATE SET
              authority_epoch = excluded.authority_epoch,
              route_epoch = excluded.route_epoch,
              lease_epoch = excluded.lease_epoch,
              resource_lifecycle_generation = excluded.resource_lifecycle_generation,
              operation_execution_epoch = excluded.operation_execution_epoch
            WHERE CAST(excluded.authority_epoch AS INTEGER) >= CAST(authority_epoch AS INTEGER)
              AND CAST(excluded.route_epoch AS INTEGER) >= CAST(route_epoch AS INTEGER)
              AND CAST(excluded.lease_epoch AS INTEGER) >= CAST(lease_epoch AS INTEGER)
              AND CAST(excluded.resource_lifecycle_generation AS INTEGER) >= CAST(resource_lifecycle_generation AS INTEGER)
              AND CAST(excluded.operation_execution_epoch AS INTEGER) >= CAST(operation_execution_epoch AS INTEGER)
          `).run(
            record.id,
            record.authority_epoch.toString(10),
            record.route_epoch.toString(10),
            record.lease_epoch.toString(10),
            record.resource_lifecycle_generation.toString(10),
            record.operation_execution_epoch.toString(10),
          );
          if (result.changes !== 1) {
            throw new SandboxError("stale_lease_epoch", "Fence high-watermark regression was rejected");
          }
        };
        if (expectedRevision === null) {
          if (record.revision !== 1) throw new SandboxError("stale_revision", "Initial revision must be one");
          try {
            db.query("INSERT INTO sandbox_records(resource_id, revision, state, record_json) VALUES (?, ?, ?, ?)")
              .run(record.id, record.revision, record.state, storageJson(record));
            persistHighWater();
          } catch {
            throw new SandboxError("stale_revision", "Sandbox already exists");
          }
          return;
        }
        if (record.revision !== expectedRevision + 1) {
          throw new SandboxError("stale_revision", "Sandbox revision must advance by one");
        }
        const result = db
          .query(
            "UPDATE sandbox_records SET revision = ?, state = ?, record_json = ? WHERE resource_id = ? AND revision = ?",
          )
          .run(record.revision, record.state, storageJson(record), record.id, expectedRevision);
        if (result.changes !== 1) throw new SandboxError("stale_revision", "Sandbox revision compare-and-swap failed");
        persistHighWater();
      },
      getHandle(resourceId) {
        const row = db
          .query<{ record_json: string }, [string]>("SELECT record_json FROM adapter_resources WHERE resource_id = ?")
          .get(resourceId);
        return row === null ? undefined : parseStorageJson<SealedProviderHandleV1>(row.record_json);
      },
      putHandle(handle) {
        db.query(`
          INSERT INTO adapter_resources(resource_id, provider_handle_sha256, sealed_handle, record_json)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(resource_id) DO UPDATE SET
            provider_handle_sha256 = excluded.provider_handle_sha256,
            sealed_handle = excluded.sealed_handle,
            record_json = excluded.record_json
        `).run(handle.resource_id, handle.provider_handle_sha256, handle.sealed_handle, storageJson(handle));
      },
      getOperation(operationId) {
        return parseOperation(
          db.query<OperationRow, [string]>(`
            SELECT record_json, effect_phase, operation_step_id, dispatch_anchor_sha256
            FROM operations WHERE operation_id = ?
          `)
            .get(operationId),
        );
      },
      getExecStreamState(resourceId, execId) {
        const row = db.query<{
          stream_root_sha256: string;
          next_expected_sequence: string;
          record_json: string;
        }, [string, string]>(`
          SELECT stream_root_sha256, next_expected_sequence, record_json
          FROM exec_stream_states WHERE resource_id = ? AND exec_id = ?
        `).get(resourceId, execId);
        if (row === null) return undefined;
        const streamState = parseStorageJson<ExecStreamStateV1>(row.record_json);
        if (
          streamState.resource_id !== resourceId || streamState.exec_id !== execId ||
          streamState.stream_root_sha256 !== row.stream_root_sha256 ||
          streamState.next_expected_sequence !== BigInt(row.next_expected_sequence)
        ) {
          throw new SandboxError("integrity_failed", "SQLite exec stream protected columns differ");
        }
        return streamState;
      },
      putExecStreamState(streamState) {
        db.query(`
          INSERT INTO exec_stream_states(
            resource_id, exec_id, stream_root_sha256, next_expected_sequence, record_json
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(resource_id, exec_id) DO UPDATE SET
            stream_root_sha256 = excluded.stream_root_sha256,
            next_expected_sequence = excluded.next_expected_sequence,
            record_json = excluded.record_json
        `).run(
          streamState.resource_id,
          streamState.exec_id,
          streamState.stream_root_sha256,
          streamState.next_expected_sequence.toString(10),
          storageJson(streamState),
        );
      },
      findIdempotentOperation(actorPrincipal, operation, resourceId, idempotencyKeySha256) {
        return parseOperation(
          db.query<OperationRow, [string, string, string, string]>(`
            SELECT record_json, effect_phase, operation_step_id, dispatch_anchor_sha256 FROM operations
            WHERE actor_principal = ? AND operation = ? AND resource_id = ? AND idempotency_key_sha256 = ?
          `).get(actorPrincipal, operation, resourceId, idempotencyKeySha256),
        );
      },
      insertOperation(record) {
        try {
          db.query(`
            INSERT INTO operations(
              operation_id, operation, resource_id, actor_principal,
              idempotency_key_sha256, request_sha256, state, effect_phase,
              operation_step_id, dispatch_anchor_sha256, record_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
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
            storageJson(record),
          );
        } catch {
          throw new SandboxError("idempotency_key_reused", "Operation ID or idempotency key already exists");
        }
      },
      updateOperation(record) {
        const result = db
          .query(`
            UPDATE operations
            SET state = ?, effect_phase = ?, operation_step_id = ?,
                dispatch_anchor_sha256 = ?, record_json = ?
            WHERE operation_id = ?
          `)
          .run(
            record.state,
            record.effect_phase,
            record.operation_step_id ?? null,
            record.dispatch_journal_anchor_sha256 ?? null,
            storageJson(record),
            record.operation_id,
          );
        if (result.changes !== 1) throw new SandboxError("not_found", "Operation does not exist");
      },
      compareAndSwapOperationPhase(operationId, expectedPhases, nextPhase, updatedAt) {
        const current = parseOperation(
          db.query<OperationRow, [string]>(
            `SELECT record_json, effect_phase, operation_step_id, dispatch_anchor_sha256
             FROM operations WHERE operation_id = ?`,
          ).get(operationId),
        );
        if (current === undefined) throw new SandboxError("not_found", "Operation does not exist");
        if (!expectedPhases.includes(current.effect_phase)) {
          throw new SandboxError("stale_revision", "Operation effect phase compare-and-swap failed");
        }
        const next: OperationRecordV1 = { ...current, effect_phase: nextPhase, updated_at: updatedAt };
        const result = db.query(`
          UPDATE operations SET effect_phase = ?, record_json = ?
          WHERE operation_id = ? AND effect_phase = ?
        `).run(nextPhase, storageJson(next), operationId, current.effect_phase);
        if (result.changes !== 1) {
          throw new SandboxError("stale_revision", "Operation effect phase compare-and-swap failed");
        }
        return next;
      },
      appendExternalAnchor(record) {
        assertExternalOperationAnchorRecordV1(record);
        const sequence = record.journal_sequence.toString(10);
        const frontier = db.query<{
          prior_frontier_digest: string;
          record_digest: string;
          frontier_digest: string;
          envelope_digest: string;
        }, [string]>(`
          SELECT prior_frontier_digest, record_digest, frontier_digest, envelope_digest
          FROM external_journal_frontiers WHERE journal_sequence = ?
        `).get(sequence);
        if (frontier === null) {
          db.query(`
            INSERT INTO external_journal_frontiers(
              journal_sequence, prior_frontier_digest, record_digest,
              frontier_digest, envelope_digest
            ) VALUES (?, ?, ?, ?, ?)
          `).run(
            sequence,
            record.prior_frontier_digest,
            record.record_digest,
            record.frontier_digest,
            record.envelope_digest,
          );
        } else if (
          frontier.prior_frontier_digest !== record.prior_frontier_digest ||
          frontier.record_digest !== record.record_digest ||
          frontier.frontier_digest !== record.frontier_digest ||
          frontier.envelope_digest !== record.envelope_digest
        ) {
          throw new SandboxError("integrity_failed", "External journal sequence or frontier changed bytes");
        }
        if ("anchor_kind" in record) {
          const existing = db.query<{ record_json: string }, [string, string, string, string]>(`
            SELECT record_json FROM external_read_probe_anchors
            WHERE operation_id = ? AND operation_step_id = ?
              AND operation_execution_epoch = ? AND envelope_digest = ?
          `).get(
            record.operation_id,
            record.operation_step_id,
            record.operation_execution_epoch.toString(10),
            record.envelope_digest,
          );
          if (existing !== null) {
            const prior = parseStorageJson<ExternalOperationAnchorRecordV1>(existing.record_json);
            if (canonicalDigest(prior) !== canonicalDigest(record)) {
              throw new SandboxError("integrity_failed", "Immutable READ_PROBE identity changed bytes");
            }
            return;
          }
          db.query(`
            INSERT INTO external_read_probe_anchors(
              operation_id, operation_step_id, operation_execution_epoch,
              journal_sequence, envelope_digest, recorded_at, record_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.operation_id,
            record.operation_step_id,
            record.operation_execution_epoch.toString(10),
            sequence,
            record.envelope_digest,
            record.recorded_at,
            storageJson(record),
          );
          return;
        }
        const epoch = record.operation_execution_epoch.toString(10);
        const existing = db.query<{ record_json: string }, [string, string, string, string]>(`
          SELECT record_json FROM effect_journal_records
          WHERE operation_id = ? AND operation_step_id = ?
            AND operation_execution_epoch = ? AND record_kind = ?
        `).get(record.operation_id, record.operation_step_id, epoch, record.record_kind);
        if (existing !== null) {
          const prior = parseStorageJson<ExternalOperationAnchorRecordV1>(existing.record_json);
          if (canonicalDigest(prior) !== canonicalDigest(record)) {
            throw new SandboxError("integrity_failed", "Immutable effect journal identity changed bytes");
          }
          return;
        }
        if (record.record_kind === "OUTCOME") {
          const dispatched = db.query<{ present: number }, [string, string, string]>(`
            SELECT 1 AS present FROM effect_journal_records
            WHERE operation_id = ? AND operation_step_id = ?
              AND operation_execution_epoch = ? AND record_kind = 'DISPATCHED'
          `).get(record.operation_id, record.operation_step_id, epoch);
          if (dispatched === null) {
            throw new SandboxError("integrity_failed", "OUTCOME has no matching immutable DISPATCHED record");
          }
        } else {
          const prior = db.query<{ operation_execution_epoch: string }, [string, string]>(`
            SELECT operation_execution_epoch FROM effect_journal_records
            WHERE operation_id = ? AND operation_step_id = ? AND record_kind = 'DISPATCHED'
            ORDER BY CAST(operation_execution_epoch AS INTEGER) DESC LIMIT 1
          `).get(record.operation_id, record.operation_step_id);
          if (prior !== null) {
            const priorEpoch = BigInt(prior.operation_execution_epoch);
            if (record.operation_execution_epoch !== priorEpoch + 1n) {
              throw new SandboxError("integrity_failed", "Effect execution epoch must advance by exactly one");
            }
            const priorOutcome = db.query<{ outcome_kind: string | null }, [string, string, string]>(`
              SELECT outcome_kind FROM effect_journal_records
              WHERE operation_id = ? AND operation_step_id = ?
                AND operation_execution_epoch = ? AND record_kind = 'OUTCOME'
            `).get(record.operation_id, record.operation_step_id, prior.operation_execution_epoch);
            if (priorOutcome?.outcome_kind !== "failed_no_effect") {
              throw new SandboxError("provider_state_unknown", "Higher execution epoch requires authoritative failed_no_effect");
            }
          }
        }
        db.query(`
          INSERT INTO effect_journal_records(
            operation_id, operation_step_id, operation_execution_epoch, record_kind,
            outcome_kind, journal_sequence, envelope_digest, recorded_at, record_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.operation_id,
          record.operation_step_id,
          epoch,
          record.record_kind,
          record.record_kind === "OUTCOME" ? record.outcome_kind : null,
          sequence,
          record.envelope_digest,
          record.recorded_at,
          storageJson(record),
        );
      },
      listExternalAnchors(operationId) {
        const mutations = db.query<{ record_json: string }, [string]>(`
          SELECT record_json FROM effect_journal_records WHERE operation_id = ?
        `).all(operationId);
        const probes = db.query<{ record_json: string }, [string]>(`
          SELECT record_json FROM external_read_probe_anchors WHERE operation_id = ?
        `).all(operationId);
        return [...mutations, ...probes]
          .map((row) => parseStorageJson<ExternalOperationAnchorRecordV1>(row.record_json))
          .sort((a, b) =>
            a.recorded_at.localeCompare(b.recorded_at) ||
            ("record_kind" in a ? a.record_kind : a.anchor_kind).localeCompare(
              "record_kind" in b ? b.record_kind : b.anchor_kind,
            )
          );
      },
      consumeCapabilityUse(capabilityUseSha256, operationId) {
        try {
          db.query("INSERT INTO capability_uses(use_sha256, operation_id) VALUES (?, ?)")
            .run(capabilityUseSha256, operationId);
        } catch {
          const prior = db.query<{ operation_id: string }, [string]>(
            "SELECT operation_id FROM capability_uses WHERE use_sha256 = ?",
          ).get(capabilityUseSha256);
          if (prior?.operation_id !== operationId) {
            throw new SandboxError("capability_replayed", "Capability nonce was already consumed");
          }
        }
      },
      getCapabilityUseOperation(capabilityUseSha256) {
        return db.query<{ operation_id: string }, [string]>(
          "SELECT operation_id FROM capability_uses WHERE use_sha256 = ?",
        ).get(capabilityUseSha256)?.operation_id;
      },
      consumeActivationGrant(grantUseSha256, operationId) {
        try {
          db.query("INSERT INTO activation_grant_uses(use_sha256, operation_id) VALUES (?, ?)")
            .run(grantUseSha256, operationId);
        } catch {
          const prior = db.query<{ operation_id: string }, [string]>(
            "SELECT operation_id FROM activation_grant_uses WHERE use_sha256 = ?",
          ).get(grantUseSha256);
          if (prior?.operation_id !== operationId) {
            throw new SandboxError("capability_replayed", "Activation grant was already consumed");
          }
        }
      },
      getActivationGrantUseOperation(grantUseSha256) {
        return db.query<{ operation_id: string }, [string]>(
          "SELECT operation_id FROM activation_grant_uses WHERE use_sha256 = ?",
        ).get(grantUseSha256)?.operation_id;
      },
      consumeCleanupGrant(grantUseSha256, operationId) {
        try {
          db.query("INSERT INTO cleanup_grant_uses(use_sha256, operation_id) VALUES (?, ?)")
            .run(grantUseSha256, operationId);
        } catch {
          const prior = db.query<{ operation_id: string }, [string]>(
            "SELECT operation_id FROM cleanup_grant_uses WHERE use_sha256 = ?",
          ).get(grantUseSha256);
          if (prior?.operation_id !== operationId) {
            throw new SandboxError("cleanup_grant_mismatch", "Cleanup grant was already consumed");
          }
        }
      },
      getCleanupGrantUseOperation(grantUseSha256) {
        return db.query<{ operation_id: string }, [string]>(
          "SELECT operation_id FROM cleanup_grant_uses WHERE use_sha256 = ?",
        ).get(grantUseSha256)?.operation_id;
      },
      putCheckpointReceipt(receipt) {
        assertDigest(receipt.receipt_sha256, "checkpoint_receipt.receipt_sha256");
        const existing = db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM immutable_checkpoint_receipts WHERE receipt_sha256 = ?",
        ).get(receipt.receipt_sha256);
        if (existing !== null) {
          const prior = parseStorageJson<CheckpointDurabilityReceiptV1>(existing.record_json);
          if (canonicalDigest(prior) !== canonicalDigest(receipt)) {
            throw new SandboxError("integrity_failed", "Immutable checkpoint receipt changed bytes");
          }
          return;
        }
        try {
          db.query(`
            INSERT INTO immutable_checkpoint_receipts(
              receipt_sha256, receipt_id, resource_id, record_json
            ) VALUES (?, ?, ?, ?)
          `).run(receipt.receipt_sha256, receipt.receipt_id, receipt.resource_id, storageJson(receipt));
        } catch {
          throw new SandboxError("integrity_failed", "Checkpoint receipt identity conflicts with stored bytes");
        }
      },
      getCheckpointReceipt(receiptSha256) {
        const row = db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM immutable_checkpoint_receipts WHERE receipt_sha256 = ?",
        ).get(receiptSha256);
        return row === null ? undefined : parseStorageJson<CheckpointDurabilityReceiptV1>(row.record_json);
      },
      putGitPromotionReceipt(receipt) {
        assertDigest(receipt.receipt_sha256, "promotion_receipt.receipt_sha256");
        const existing = db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM immutable_git_promotion_receipts WHERE receipt_sha256 = ?",
        ).get(receipt.receipt_sha256);
        if (existing !== null) {
          const prior = parseStorageJson<GitPromotionReceiptRefV1>(existing.record_json);
          if (canonicalDigest(prior) !== canonicalDigest(receipt)) {
            throw new SandboxError("integrity_failed", "Immutable promotion receipt changed bytes");
          }
          return;
        }
        try {
          db.query(`
            INSERT INTO immutable_git_promotion_receipts(
              receipt_sha256, receipt_id, resource_id, record_json
            ) VALUES (?, ?, ?, ?)
          `).run(receipt.receipt_sha256, receipt.receipt_id, receipt.resource_id, storageJson(receipt));
        } catch {
          throw new SandboxError("integrity_failed", "Promotion receipt identity conflicts with stored bytes");
        }
      },
      getGitPromotionReceipt(receiptSha256) {
        const row = db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM immutable_git_promotion_receipts WHERE receipt_sha256 = ?",
        ).get(receiptSha256);
        return row === null ? undefined : parseStorageJson<GitPromotionReceiptRefV1>(row.record_json);
      },
      appendSafetyFenceObservation(record) {
        assertOpaqueId(record.observation_id, "safety_observation.observation_id", "observation");
        assertOpaqueId(record.resource_id, "safety_observation.resource_id", "sbx");
        assertDigest(record.observation_sha256, "safety_observation.observation_sha256");
        if (
          record.resource_id !== record.observation.resource_id ||
          record.observation_sha256 !== canonicalDigest(record.observation)
        ) {
          throw new SandboxError("integrity_failed", "Safety observation record bytes do not match their digest");
        }
        const existing = db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM safety_fence_observations WHERE observation_id = ?",
        ).get(record.observation_id);
        if (existing !== null) {
          const prior = parseStorageJson<StoredSafetyFenceObservationV1>(existing.record_json);
          if (canonicalDigest(prior) !== canonicalDigest(record)) {
            throw new SandboxError("integrity_failed", "Immutable safety observation changed bytes");
          }
          return;
        }
        db.query(`
          INSERT INTO safety_fence_observations(
            observation_id, resource_id, observation_sha256, recorded_at, record_json
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          record.observation_id,
          record.resource_id,
          record.observation_sha256,
          record.recorded_at,
          storageJson(record),
        );
      },
      listSafetyFenceObservations(resourceId) {
        return db.query<{ record_json: string }, [string]>(`
          SELECT record_json FROM safety_fence_observations
          WHERE resource_id = ? ORDER BY recorded_at, observation_id
        `).all(resourceId).map((row) =>
          parseStorageJson<StoredSafetyFenceObservationV1>(row.record_json)
        );
      },
      putDestroyTombstone(record) {
        assertOpaqueId(record.tombstone_id, "destroy_tombstone.tombstone_id", "tombstone");
        assertOpaqueId(record.resource_id, "destroy_tombstone.resource_id", "sbx");
        assertDigest(record.tombstone_sha256, "destroy_tombstone.tombstone_sha256");
        const { tombstone_sha256: _digest, ...protectedBytes } = record;
        if (record.tombstone_sha256 !== canonicalDigest(protectedBytes)) {
          throw new SandboxError("integrity_failed", "Destroy tombstone digest does not match its protected bytes");
        }
        const sandbox = parseSandbox(db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM sandbox_records WHERE resource_id = ?",
        ).get(record.resource_id));
        if (sandbox?.state !== "destroyed") {
          throw new SandboxError("integrity_failed", "Destroy tombstone requires a terminal sandbox record");
        }
        const existing = db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM destroy_tombstones WHERE resource_id = ?",
        ).get(record.resource_id);
        if (existing !== null) {
          const prior = parseStorageJson<SandboxDestroyTombstoneV1>(existing.record_json);
          if (canonicalDigest(prior) !== canonicalDigest(record)) {
            throw new SandboxError("integrity_failed", "Immutable destroy tombstone changed bytes");
          }
          return;
        }
        db.query(`
          INSERT INTO destroy_tombstones(
            resource_id, destroy_operation_id, tombstone_sha256, record_json
          ) VALUES (?, ?, ?, ?)
        `).run(
          record.resource_id,
          record.destroy_operation_id,
          record.tombstone_sha256,
          storageJson(record),
        );
      },
      getDestroyTombstone(resourceId) {
        const row = db.query<{ record_json: string }, [string]>(
          "SELECT record_json FROM destroy_tombstones WHERE resource_id = ?",
        ).get(resourceId);
        return row === null ? undefined : parseStorageJson<SandboxDestroyTombstoneV1>(row.record_json);
      },
      appendEvent(event) {
        const next = (db.query<{ sequence: number }, [string]>(
          "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM sandbox_events WHERE resource_id = ?",
        ).get(event.resource_id)?.sequence ?? 1);
        const complete: SandboxEventV1 = { ...event, sequence: next };
        db.query("INSERT INTO sandbox_events(resource_id, sequence, event_id, record_json) VALUES (?, ?, ?, ?)")
          .run(event.resource_id, next, event.event_id, storageJson(complete));
        db.query("INSERT INTO outbox(event_id, payload_sha256) VALUES (?, ?)")
          .run(event.event_id, event.payload_sha256);
        return complete;
      },
      listEvents(resourceId) {
        return db
          .query<{ record_json: string }, [string]>(
            "SELECT record_json FROM sandbox_events WHERE resource_id = ? ORDER BY sequence ASC",
          )
          .all(resourceId)
          .map((row) => parseStorageJson<SandboxEventV1>(row.record_json));
      },
    };
  }
}
