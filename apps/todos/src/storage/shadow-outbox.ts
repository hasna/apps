import type { Database } from "bun:sqlite";
import type { TaskHistory } from "../types/index.js";
import {
  createLocalSqliteTodosStorageAdapter,
} from "./local-sqlite.js";
import {
  createPostgresTodosSyncStore,
  type PostgresTodosSyncStore,
  type TodosPostgresQueryClient,
  type TodosPostgresSyncRecordType,
} from "./postgres-sync.js";
import { installShadowOutboxSchema } from "./shadow-outbox-schema.js";
import type {
  TodosStorageAdapter,
  TodosStorageSnapshot,
  TodosStorageTombstone,
} from "./interfaces.js";

/**
 * Durable, write-only dual-write shadow outbox.
 *
 * Unlike the in-memory {@link TodosShadowMirror}, this outbox persists pending
 * mirror operations in a local SQLite table (`shadow_outbox`) and captures
 * EVERY local write via SQLite AFTER INSERT/UPDATE/DELETE triggers — no matter
 * which code path performed it (CLI, MCP, HTTP serve, or raw `src/db/*` SQL).
 * That makes the shadow "real" for all write paths without refactoring the
 * hundreds of direct-SQL call sites onto the storage adapter.
 *
 * Semantics (sanctioned Amendment A1 shadow exception):
 *  - One-way, write-only. Reads are always served from local SQLite.
 *  - The remote store is never read on the runtime path.
 *  - Unreachable cloud DEFERS (rows stay pending with exponential backoff)
 *    instead of dropping — durability survives process kill/restart because the
 *    queue lives in the same SQLite file as the data it mirrors.
 *
 * This is NOT a sync engine: it never pulls, never reconciles remote->local,
 * and never mutates local state from the cloud.
 */

export { installShadowOutboxSchema, SHADOW_TRIGGER_TABLES } from "./shadow-outbox-schema.js";

export interface TodosShadowOutboxStats {
  enabled: true;
  durable: true;
  /** Rows still awaiting a successful mirror push. */
  pending: number;
  /** Rows that exhausted retries and are parked (divergence source). */
  failed: number;
  /** Total outbox depth (pending + failed). */
  depth: number;
  /** Ops confirmed mirrored to the cloud since this process started. */
  mirrored: number;
  /** Individual push attempts that failed since this process started. */
  retries: number;
  /** ISO timestamp of the last successful mirror write. */
  lastMirrorAt: string | null;
  /** Milliseconds between enqueue and confirmed mirror for the last op. */
  lastLagMs: number | null;
  /** Last mirror error message (never a DSN — callers redact if needed). */
  lastError: string | null;
  /** Whether the background drain loop is running in this process. */
  draining: boolean;
}

export interface CreateTodosShadowOutboxOptions {
  db: Database;
  /** Pre-built sync store, or provide `postgresClient` to build one. */
  syncStore?: PostgresTodosSyncStore;
  postgresClient?: TodosPostgresQueryClient;
  sourceMachineId?: string;
  /** Local adapter used to re-read the current row for upserts. */
  localAdapter?: TodosStorageAdapter;
  /** Retry attempts per op before it is parked as `failed`. Default 8. */
  maxRetries?: number;
  /** Base backoff in ms (exponential, capped at 5 min). Default 500ms. */
  retryBaseMs?: number;
  /** Rows processed per drain pass. Default 50. */
  batchSize?: number;
  /** Ensure the remote sync schema exists before the first push. Default true. */
  ensureSchema?: boolean;
  onEvent?: (event: TodosShadowOutboxEvent) => void;
}

export type TodosShadowOutboxEvent =
  | { type: "mirrored"; objectType: string; id: string; lagMs: number }
  | { type: "retry"; objectType: string; id: string; attempt: number; error: string }
  | { type: "parked"; objectType: string; id: string; error: string };

interface OutboxRow {
  seq: number;
  object_type: TodosPostgresSyncRecordType;
  object_id: string;
  op: "upsert" | "delete";
  enqueued_at: number;
  attempts: number;
}

const MAX_BACKOFF_MS = 5 * 60_000;

export class TodosShadowOutbox {
  private readonly db: Database;
  private readonly syncStore: PostgresTodosSyncStore;
  private readonly local: TodosStorageAdapter;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly batchSize: number;
  private readonly onEvent?: (event: TodosShadowOutboxEvent) => void;
  private schemaReady: Promise<void> | null;

  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;

  private metrics = {
    mirrored: 0,
    retries: 0,
    lastMirrorAt: null as string | null,
    lastLagMs: null as number | null,
    lastError: null as string | null,
  };

  constructor(options: CreateTodosShadowOutboxOptions) {
    this.db = options.db;
    const syncStore = options.syncStore
      ?? (options.postgresClient
        ? createPostgresTodosSyncStore(options.postgresClient, {
            ...(options.sourceMachineId ? { sourceMachineId: options.sourceMachineId } : {}),
          })
        : null);
    if (!syncStore) {
      throw new Error("shadow outbox requires a Postgres sync store or query client");
    }
    this.syncStore = syncStore;
    this.local = options.localAdapter ?? createLocalSqliteTodosStorageAdapter({ db: options.db });
    this.maxRetries = Math.max(0, options.maxRetries ?? 8);
    this.retryBaseMs = Math.max(1, options.retryBaseMs ?? 500);
    this.batchSize = Math.max(1, options.batchSize ?? 50);
    if (options.onEvent) this.onEvent = options.onEvent;
    this.schemaReady = options.ensureSchema === false ? Promise.resolve() : null;
  }

  /**
   * Create the durable outbox table and install capture triggers. Idempotent —
   * safe to call on every process start. Only touches SQLite (no network).
   */
  install(): void {
    installShadowOutboxSchema(this.db);
  }

  getStats(): TodosShadowOutboxStats {
    const pending = this.countByStatus("pending");
    const failed = this.countByStatus("failed");
    return {
      enabled: true,
      durable: true,
      pending,
      failed,
      depth: pending + failed,
      mirrored: this.metrics.mirrored,
      retries: this.metrics.retries,
      lastMirrorAt: this.metrics.lastMirrorAt,
      lastLagMs: this.metrics.lastLagMs,
      lastError: this.metrics.lastError,
      draining: this.loopTimer !== null,
    };
  }

  private countByStatus(status: string): number {
    const row = this.db
      .query<{ n: number }, [string]>(`SELECT count(*) AS n FROM shadow_outbox WHERE status=?`)
      .get(status);
    return row?.n ?? 0;
  }

  /** Start a background drain loop. Safe to call once per long-running process. */
  startLoop(intervalMs = 2_000): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      void this.drainOnce().catch(() => {});
    }, Math.max(250, intervalMs));
    if (typeof this.loopTimer.unref === "function") this.loopTimer.unref();
  }

  stopLoop(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /**
   * Drain the queue until it is empty (no due rows) or a deadline elapses. Used
   * on CLI exit and by `todos storage shadow-drain`.
   */
  async flush(timeoutMs = 15_000): Promise<TodosShadowOutboxStats> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      const processed = await this.drainOnce();
      if (this.countByStatus("pending") === 0) break;
      if (processed === 0) {
        // Rows remain but none are due yet (backoff) — wait briefly, bounded by
        // the deadline, then re-check. This lets deferred rows drain in-band.
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
      }
    }
    return this.getStats();
  }

  /**
   * Process one batch of due rows. Returns the number of rows attempted. Never
   * throws — push failures defer the row with backoff.
   */
  async drainOnce(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      await this.ensureSchema();
      const now = Date.now();
      const rows = this.db
        .query<OutboxRow, [number, number]>(
          `SELECT seq, object_type, object_id, op, enqueued_at, attempts
             FROM shadow_outbox
            WHERE status='pending' AND next_attempt_at <= ?
            ORDER BY seq ASC
            LIMIT ?`,
        )
        .all(now, this.batchSize);
      if (rows.length === 0) return 0;
      for (const row of rows) {
        await this.processRow(row);
      }
      return rows.length;
    } catch {
      // ensureSchema (network) failed — leave rows pending for the next pass.
      return 0;
    } finally {
      this.draining = false;
    }
  }

  private async processRow(row: OutboxRow): Promise<void> {
    try {
      const snapshot = await this.buildSnapshot(row);
      await this.syncStore.pushSnapshot(snapshot, {});
      const lagMs = Date.now() - row.enqueued_at;
      this.db.run(`DELETE FROM shadow_outbox WHERE seq=?`, [row.seq]);
      this.metrics.mirrored += 1;
      this.metrics.lastMirrorAt = new Date().toISOString();
      this.metrics.lastLagMs = lagMs;
      this.onEvent?.({ type: "mirrored", objectType: row.object_type, id: row.object_id, lagMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metrics.retries += 1;
      this.metrics.lastError = message;
      const attempts = row.attempts + 1;
      if (attempts > this.maxRetries) {
        this.db.run(
          `UPDATE shadow_outbox SET attempts=?, last_error=?, status='failed' WHERE seq=?`,
          [attempts, message, row.seq],
        );
        this.onEvent?.({ type: "parked", objectType: row.object_type, id: row.object_id, error: message });
        return;
      }
      const delay = Math.min(MAX_BACKOFF_MS, this.retryBaseMs * 2 ** (attempts - 1));
      this.db.run(
        `UPDATE shadow_outbox SET attempts=?, next_attempt_at=?, last_error=? WHERE seq=?`,
        [attempts, Date.now() + delay, message, row.seq],
      );
      this.onEvent?.({ type: "retry", objectType: row.object_type, id: row.object_id, attempt: attempts, error: message });
    }
  }

  private async buildSnapshot(row: OutboxRow): Promise<TodosStorageSnapshot> {
    const snapshot = emptySnapshot();
    if (row.op === "delete") {
      snapshot.tombstones = [this.tombstone(row.object_type, row.object_id)];
      return snapshot;
    }
    const record = await this.readCurrent(row.object_type, row.object_id);
    if (!record) {
      // Row vanished between capture and drain (e.g. deleted). Mirror a
      // tombstone so the cloud converges to the current local truth.
      snapshot.tombstones = [this.tombstone(row.object_type, row.object_id)];
      return snapshot;
    }
    switch (row.object_type) {
      case "tasks": snapshot.tasks.push(record as unknown as TodosStorageSnapshot["tasks"][number]); break;
      case "projects": snapshot.projects.push(record as unknown as TodosStorageSnapshot["projects"][number]); break;
      case "plans": snapshot.plans.push(record as unknown as TodosStorageSnapshot["plans"][number]); break;
      case "agents": snapshot.agents.push(record as unknown as TodosStorageSnapshot["agents"][number]); break;
      case "task_lists": snapshot.taskLists.push(record as unknown as TodosStorageSnapshot["taskLists"][number]); break;
      case "templates": snapshot.templates.push(record as unknown as TodosStorageSnapshot["templates"][number]); break;
      case "audit_history": snapshot.auditHistory.push(record as unknown as TaskHistory); break;
      default: break;
    }
    return snapshot;
  }

  private async readCurrent(
    objectType: TodosPostgresSyncRecordType,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    switch (objectType) {
      case "tasks": return (await this.local.tasks.get(id)) as Record<string, unknown> | null;
      case "projects": return (await this.local.projects.get(id)) as Record<string, unknown> | null;
      case "plans": return (await this.local.plans.get(id)) as Record<string, unknown> | null;
      case "agents": return (await this.local.agents.get(id)) as Record<string, unknown> | null;
      case "task_lists": return (await this.local.taskLists.get(id)) as Record<string, unknown> | null;
      case "templates": return (await this.local.templates.get(id)) as Record<string, unknown> | null;
      case "audit_history": {
        // Append-only history has no adapter getter — read the raw row.
        const raw = this.db
          .query<Record<string, unknown>, [string]>(`SELECT * FROM task_history WHERE id=?`)
          .get(id);
        return raw ?? null;
      }
      default:
        return null;
    }
  }

  private tombstone(objectType: TodosPostgresSyncRecordType, id: string): TodosStorageTombstone {
    const now = new Date().toISOString();
    return {
      object_type: objectType,
      object_id: id,
      deleted_at: now,
      updated_at: now,
      payload: { id, deleted_at: now },
      version: null,
    };
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.syncStore.ensureSchema().catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }
    return this.schemaReady;
  }
}

function emptySnapshot(): TodosStorageSnapshot {
  return {
    exportedAt: new Date().toISOString(),
    source: "sqlite",
    tasks: [],
    projects: [],
    projectMachinePaths: [],
    plans: [],
    agents: [],
    taskLists: [],
    templates: [],
    auditHistory: [],
    tombstones: [],
  };
}

export interface CreateTodosShadowOutboxResult {
  outbox: TodosShadowOutbox;
}

export function createTodosShadowOutbox(options: CreateTodosShadowOutboxOptions): TodosShadowOutbox {
  const outbox = new TodosShadowOutbox(options);
  outbox.install();
  return outbox;
}
