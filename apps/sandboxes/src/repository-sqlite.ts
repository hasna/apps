import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sha256, storageJson, parseStorageJson } from "./canonical.js";
import { SandboxError } from "./errors.js";
import type {
  RepositoryHealthV1,
  SandboxRepositoryTxV1,
  SandboxRepositoryV1,
} from "./repository.js";
import type {
  OperationRecordV1,
  SandboxEventV1,
  SandboxV1,
  SealedProviderHandleV1,
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
] as const;

export interface SqliteRepositoryOptionsV1 {
  allow_in_memory?: boolean;
  allow_unsafe_test_path?: boolean;
}

function ensureSecurePath(databasePath: string, allowUnsafe: boolean): string {
  if (databasePath === ":memory:") return databasePath;
  const absolute = resolve(databasePath);
  const parent = dirname(absolute);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
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
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new SandboxError("integrity_failed", "SQLite database path cannot be a symlink");
  }
  return absolute;
}

export class SqliteSandboxRepositoryV1 implements SandboxRepositoryV1 {
  readonly backend = "sqlite" as const;
  readonly #db: Database;
  readonly #path: string;

  constructor(databasePath: string, options: SqliteRepositoryOptionsV1 = {}) {
    if (databasePath === ":memory:" && options.allow_in_memory !== true) {
      throw new SandboxError("forbidden", "In-memory SQLite requires explicit test authorization");
    }
    this.#path = ensureSecurePath(databasePath, options.allow_unsafe_test_path === true);
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

  transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): T {
    const transaction = this.#db.transaction(() => fn(this.#tx()));
    return transaction.immediate();
  }

  health(): RepositoryHealthV1 {
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

  close(): void {
    this.#db.close();
  }

  #tx(): SandboxRepositoryTxV1 {
    const db = this.#db;
    const parseSandbox = (row: { record_json: string } | null): SandboxV1 | undefined =>
      row === null ? undefined : parseStorageJson<SandboxV1>(row.record_json);
    const parseOperation = (row: { record_json: string } | null): OperationRecordV1 | undefined =>
      row === null ? undefined : parseStorageJson<OperationRecordV1>(row.record_json);

    return {
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
          db.query(`
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
          `).run(
            record.id,
            record.authority_epoch.toString(10),
            record.route_epoch.toString(10),
            record.lease_epoch.toString(10),
            record.resource_lifecycle_generation.toString(10),
            record.operation_execution_epoch.toString(10),
          );
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
          db.query<{ record_json: string }, [string]>("SELECT record_json FROM operations WHERE operation_id = ?")
            .get(operationId),
        );
      },
      findIdempotentOperation(actorPrincipal, operation, resourceId, idempotencyKeySha256) {
        return parseOperation(
          db.query<{ record_json: string }, [string, string, string, string]>(`
            SELECT record_json FROM operations
            WHERE actor_principal = ? AND operation = ? AND resource_id = ? AND idempotency_key_sha256 = ?
          `).get(actorPrincipal, operation, resourceId, idempotencyKeySha256),
        );
      },
      insertOperation(record) {
        try {
          db.query(`
            INSERT INTO operations(
              operation_id, operation, resource_id, actor_principal,
              idempotency_key_sha256, request_sha256, state, record_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.operation_id,
            record.operation,
            record.resource_id,
            record.actor_principal,
            record.idempotency_key_sha256,
            record.request_sha256,
            record.state,
            storageJson(record),
          );
        } catch {
          throw new SandboxError("idempotency_key_reused", "Operation ID or idempotency key already exists");
        }
      },
      updateOperation(record) {
        const result = db
          .query("UPDATE operations SET state = ?, record_json = ? WHERE operation_id = ?")
          .run(record.state, storageJson(record), record.operation_id);
        if (result.changes !== 1) throw new SandboxError("not_found", "Operation does not exist");
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
