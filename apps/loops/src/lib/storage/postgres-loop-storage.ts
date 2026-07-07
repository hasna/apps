// Postgres implementation of the LoopStorageContract.
//
// This is the self-hosted Postgres backend counterpart to SqliteLoopStorage. It
// speaks the exact same ~60-method surface as the local sqlite `Store`, but
// every method is async and every statement runs against a live `pg.Pool`
// through the vendored @hasna/contracts storage kit (direct Postgres, no cache,
// no local mirror).
//
// Row shape parity with sqlite is achieved by three pg type-parser overrides
// registered at module load (see below): JSONB/JSON come back as raw text and
// timestamps come back as normalized ISO-8601 strings, so the shared
// `rowToX` mappers from `../store.js` map pg rows exactly as they map sqlite
// rows.
//
// Concurrency-critical run claiming (runner claim/heartbeat) uses
// `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction — the same guarantee
// proven by `postgres-concurrency.test.ts`.
//
// Methods that require heavy multi-statement orchestration ported from the
// sqlite store (workflow-run / workflow-step / goal lifecycle) are NOT silently
// stubbed: they throw {@link NotImplementedError} with the method name so a
// caller hitting an unported path fails loudly instead of no-oping.

import pgLib from "pg";
import type {
  DaemonLease,
  PruneHistorySummary,
  RecoverExpiredRunLeasesResult,
} from "../store.js";
import { Store } from "../store.js";
import {
  persistedRunOutput,
  rowToGoal,
  rowToGoalPlanNode,
  rowToGoalRun,
  rowToLease,
  rowToLoop,
  rowToRun,
  rowToRunReceipt,
  rowToWorkflow,
  rowToWorkflowEvent,
  rowToWorkflowInvocation,
  rowToWorkflowRun,
  rowToWorkflowStepRun,
  rowToWorkflowWorkItem,
  scrubbedOrNull,
  workItemStatusForLoopRun,
  type GoalPlanNodeRow,
  type GoalRow,
  type GoalRunRow,
  type LeaseRow,
  type LoopRow,
  type RunReceiptRow,
  type RunRow,
  type WorkflowEventRow,
  type WorkflowInvocationRow,
  type WorkflowRow,
  type WorkflowRunRow,
  type WorkflowStepRunRow,
  type WorkflowWorkItemRow,
} from "../store.js";
import { LoopArchivedError, LoopNotFoundError, ValidationError } from "../errors.js";
import { genId, nowIso } from "../ids.js";
import { initialNextRun } from "../recurrence.js";
import { normalizeCreateWorkflowInput } from "../workflow-spec.js";
import type {
  CreateLoopInput,
  Loop,
  LoopRun,
  LoopStatus,
  LoopTarget,
  RunReceipt,
  WorkflowSpec,
  WorkflowWorkItemStatus,
  WriteRunReceiptInput,
} from "../../types.js";
import { normalizeRunReceipt } from "../run-receipts.js";
import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";
import type { LoopStorageContract, LoopStorageMethodName } from "./contract.js";

// --- pg type parsers: keep row shapes byte-compatible with the sqlite mappers.
// jsonb (3802) + json (114): return the raw JSON text so `JSON.parse` in the
// shared mappers works (pg would otherwise hand back an already-parsed object).
// timestamptz (1184) + timestamp (1114): normalize to ISO-8601 with a trailing
// `Z`, matching the exact string sqlite persisted, so the store's lexical ISO
// string comparisons (lease_expires_at <= now, created_at < cutoff) stay valid.
const { types: pgTypes } = pgLib;
pgTypes.setTypeParser(3802, (v: string) => v);
pgTypes.setTypeParser(114, (v: string) => v);
const toIso = (v: string | null): string | null => (v == null ? null : new Date(v).toISOString());
pgTypes.setTypeParser(1184, (v) => toIso(v));
pgTypes.setTypeParser(1114, (v) => toIso(v));

/** Thrown by store methods that are not yet ported to the Postgres backend. */
export class NotImplementedError extends Error {
  readonly code = "not_implemented";
  constructor(method: string) {
    super(
      `PostgresLoopStorage.${method} is not implemented on the Postgres backend yet. ` +
        `This path must not silently no-op; port the sqlite Store.${method} logic.`,
    );
    this.name = "NotImplementedError";
  }
}

const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "timed_out", "abandoned", "skipped"] as const;
const PRUNE_BATCH_SIZE = 400;
const DEFAULT_RECOVERY_BATCH_LIMIT = 100;
const DEFAULT_RECOVERY_SCAN_MULTIPLIER = 5;

type M<K extends LoopStorageMethodName> = Store[K] extends (...a: infer A) => infer R
  ? { args: A; result: R }
  : never;

interface DaemonLeaseFence {
  daemonLeaseId?: string;
  now?: Date;
  claimToken?: string;
}

export class PostgresLoopStorage implements LoopStorageContract {
  readonly backend = "postgres";
  readonly supportsRemoteRunners = true;

  constructor(private readonly client: PoolQueryClient) {}

  async close(): Promise<void> {
    await this.client.close();
  }

  // ---- internal helpers (accept a client so they compose inside transactions)

  private async assertDaemonLeaseFence(c: TypedQueryClient, opts: DaemonLeaseFence, now: string): Promise<void> {
    if (!opts.daemonLeaseId) return;
    const row = await c.get<{ id: string }>(
      "SELECT id FROM daemon_lease WHERE id = $1 AND expires_at > $2",
      [opts.daemonLeaseId, now],
    );
    if (!row) throw new Error("daemon lease lost");
  }

  private async loadLoop(c: TypedQueryClient, id: string): Promise<Loop | undefined> {
    const row = await c.get<LoopRow>("SELECT * FROM loops WHERE id = $1", [id]);
    return row ? rowToLoop(row) : undefined;
  }

  private async loadRun(c: TypedQueryClient, id: string): Promise<LoopRun | undefined> {
    const row = await c.get<RunRow>("SELECT * FROM loop_runs WHERE id = $1", [id]);
    return row ? rowToRun(row) : undefined;
  }

  private async loadRunBySlot(c: TypedQueryClient, loopId: string, scheduledFor: string): Promise<LoopRun | undefined> {
    const row = await c.get<RunRow>(
      "SELECT * FROM loop_runs WHERE loop_id = $1 AND scheduled_for = $2",
      [loopId, scheduledFor],
    );
    return row ? rowToRun(row) : undefined;
  }

  private async loadDaemonLease(c: TypedQueryClient): Promise<DaemonLease | undefined> {
    const row = await c.get<LeaseRow>("SELECT * FROM daemon_lease LIMIT 1", []);
    return row ? rowToLease(row) : undefined;
  }

  private async setWorkItemsForLoop(
    c: TypedQueryClient,
    loopId: string,
    status: WorkflowWorkItemStatus,
    reason: string | undefined,
    updated: string,
    statuses: WorkflowWorkItemStatus[] = ["admitted", "running"],
  ): Promise<void> {
    const placeholders = statuses.map((_, i) => `$${i + 5}`).join(",");
    await c.execute(
      `UPDATE workflow_work_items
       SET status=$1, lease_expires_at=NULL, last_reason=COALESCE($2, last_reason), updated_at=$3
       WHERE loop_id = $4 AND status IN (${placeholders})`,
      [status, reason ?? null, updated, loopId, ...statuses],
    );
  }

  private async setWorkItemsForWorkflowRun(
    c: TypedQueryClient,
    workflowRunId: string,
    status: WorkflowWorkItemStatus,
    reason: string | undefined,
    updated: string,
    statuses: WorkflowWorkItemStatus[] = ["admitted", "running"],
  ): Promise<void> {
    const placeholders = statuses.map((_, i) => `$${i + 5}`).join(",");
    await c.execute(
      `UPDATE workflow_work_items
       SET status=$1, lease_expires_at=NULL, last_reason=COALESCE($2, last_reason), updated_at=$3
       WHERE workflow_run_id = $4 AND status IN (${placeholders})`,
      [status, reason ?? null, updated, workflowRunId, ...statuses],
    );
  }

  private async cascadeWorkItemsForLoopRun(
    c: TypedQueryClient,
    run: LoopRun,
    reason: string | undefined,
    updated: string,
  ): Promise<void> {
    const loop = await this.loadLoop(c, run.loopId);
    const status = workItemStatusForLoopRun(run.status, run.attempt, loop?.maxAttempts);
    if (!status) return;
    const statuses: WorkflowWorkItemStatus[] =
      status === "admitted" ? ["admitted", "running", "failed"] : ["admitted", "running"];
    const nextReason =
      status === "admitted"
        ? reason
          ? `attempt failed; retry pending: ${reason}`
          : "attempt failed; retry pending"
        : reason;
    await this.setWorkItemsForLoop(c, run.loopId, status, nextReason, updated, statuses);
  }

  // ---------------------------------------------------------------- loops CRUD

  async createLoop(...args: M<"createLoop">["args"]): Promise<M<"createLoop">["result"]> {
    const [input, from = new Date()] = args as [CreateLoopInput, Date?];
    const now = nowIso();
    const target: LoopTarget =
      input.target.type === "workflow"
        ? input.target
        : normalizeCreateWorkflowInput({
            name: "loop-target-validation",
            steps: [{ id: "target", target: input.target }],
          }).steps[0]!.target;
    if (input.goal && target.type === "workflow") {
      const workflow = await this.loadWorkflow(this.client, target.workflowId);
      if (workflow?.goal) {
        throw new Error(
          `workflow loop cannot define a loop-level goal when workflow ${workflow.name} already has a top-level goal; remove one goal wrapper`,
        );
      }
    }
    const loop: Loop = {
      id: genId(),
      name: input.name,
      description: input.description,
      status: "active",
      schedule: input.schedule,
      target,
      goal: input.goal,
      machine: input.machine,
      nextRunAt: initialNextRun(input.schedule, from),
      catchUp: input.catchUp ?? "latest",
      catchUpLimit: input.catchUpLimit ?? 50,
      overlap: input.overlap ?? "skip",
      maxAttempts: input.maxAttempts ?? 1,
      retryDelayMs: input.retryDelayMs ?? 60_000,
      leaseMs: input.leaseMs ?? 30 * 60_000,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    await this.client.execute(
      `INSERT INTO loops (id, name, description, status, schedule_json, target_json, machine_json, next_run_at, retry_scheduled_for,
        goal_json, catch_up, catch_up_limit, overlap, max_attempts, retry_delay_ms, lease_ms, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,NULL,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        loop.id,
        loop.name,
        loop.description ?? null,
        loop.status,
        JSON.stringify(loop.schedule),
        JSON.stringify(loop.target),
        loop.machine ? JSON.stringify(loop.machine) : null,
        loop.nextRunAt ?? null,
        loop.goal ? JSON.stringify(loop.goal) : null,
        loop.catchUp,
        loop.catchUpLimit,
        loop.overlap,
        loop.maxAttempts,
        loop.retryDelayMs,
        loop.leaseMs,
        loop.expiresAt ?? null,
        loop.createdAt,
        loop.updatedAt,
      ],
    );
    return loop;
  }

  async getLoop(...args: M<"getLoop">["args"]): Promise<M<"getLoop">["result"]> {
    return this.loadLoop(this.client, args[0]);
  }

  async findLoopByName(...args: M<"findLoopByName">["args"]): Promise<M<"findLoopByName">["result"]> {
    const row = await this.client.get<LoopRow>(
      "SELECT * FROM loops WHERE name = $1 ORDER BY created_at DESC LIMIT 1",
      [args[0]],
    );
    return row ? rowToLoop(row) : undefined;
  }

  async requireLoop(...args: M<"requireLoop">["args"]): Promise<M<"requireLoop">["result"]> {
    const idOrName = args[0];
    const found = (await this.getLoop(idOrName)) ?? (await this.findLoopByName(idOrName));
    if (!found) throw new LoopNotFoundError(idOrName);
    return found;
  }

  async listLoops(...args: M<"listLoops">["args"]): Promise<M<"listLoops">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 200;
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    let rows: LoopRow[];
    // Exact-name lookup short-circuits every other filter: returns *all* loops
    // (archived included) matching the name so callers can detect ambiguity.
    if (opts.name != null) {
      rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops WHERE name = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        [opts.name, limit, offset],
      );
    } else if (opts.status && opts.archived) {
      rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops WHERE status = $1 AND archived_at IS NOT NULL ORDER BY next_run_at ASC LIMIT $2 OFFSET $3",
        [opts.status, limit, offset],
      );
    } else if (opts.status && opts.includeArchived) {
      rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops WHERE status = $1 ORDER BY next_run_at ASC LIMIT $2 OFFSET $3",
        [opts.status, limit, offset],
      );
    } else if (opts.status) {
      rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops WHERE status = $1 AND archived_at IS NULL ORDER BY next_run_at ASC LIMIT $2 OFFSET $3",
        [opts.status, limit, offset],
      );
    } else if (opts.archived) {
      rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
    } else if (opts.includeArchived) {
      rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops ORDER BY status ASC, next_run_at ASC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
    } else {
      rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops WHERE archived_at IS NULL ORDER BY status ASC, next_run_at ASC LIMIT $1 OFFSET $2",
        [limit, offset],
      );
    }
    return rows.map(rowToLoop);
  }

  async dueLoops(...args: M<"dueLoops">["args"]): Promise<M<"dueLoops">["result"]> {
    const [now, limit = 500] = args as [Date, number?];
    const rows = await this.client.many<LoopRow>(
      `SELECT * FROM loops
       WHERE status = 'active' AND archived_at IS NULL AND next_run_at IS NOT NULL AND next_run_at <= $1
       ORDER BY next_run_at ASC LIMIT $2`,
      [now.toISOString(), limit],
    );
    return rows.map(rowToLoop);
  }

  async updateLoop(...args: M<"updateLoop">["args"]): Promise<M<"updateLoop">["result"]> {
    const [id, patch, opts = {}] = args;
    const updated = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      const current = await this.loadLoop(c, id);
      if (!current) throw new LoopNotFoundError(id);
      if (current.archivedAt) throw new LoopArchivedError(current.name || id);
      const merged: Loop = { ...current, ...patch, updatedAt: updated };
      const res = await c.query(
        `UPDATE loops SET status=$1, next_run_at=$2, retry_scheduled_for=$3, expires_at=$4, updated_at=$5
         WHERE id=$6
           AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE id=$7 AND expires_at > $8))`,
        [
          merged.status,
          merged.nextRunAt ?? null,
          merged.retryScheduledFor ?? null,
          merged.expiresAt ?? null,
          merged.updatedAt,
          id,
          opts.daemonLeaseId ?? null,
          updated,
        ],
      );
      if (res.rowCount !== 1) throw new Error("daemon lease lost");
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        await this.setWorkItemsForLoop(c, id, status, `loop ${patch.status}`, updated);
      }
      const after = await this.loadLoop(c, id);
      if (!after) throw new Error(`loop not found after update: ${id}`);
      return after;
    });
  }

  async renameLoop(...args: M<"renameLoop">["args"]): Promise<M<"renameLoop">["result"]> {
    const [id, name, opts = {}] = args;
    const current = await this.getLoop(id);
    if (!current) throw new LoopNotFoundError(id);
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("loop name must not be empty");
    const updated = (opts.now ?? new Date()).toISOString();
    await this.client.execute(
      `UPDATE loops SET name=$1, updated_at=$2
       WHERE id=$3 AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE id=$4 AND expires_at > $5))`,
      [trimmed, updated, id, opts.daemonLeaseId ?? null, updated],
    );
    const after = await this.getLoop(id);
    if (!after) throw new Error(`loop not found after rename: ${id}`);
    return after;
  }

  async archiveLoop(...args: M<"archiveLoop">["args"]): Promise<M<"archiveLoop">["result"]> {
    const idOrName = args[0];
    return this.client.transaction(async (c) => {
      const loop = await this.requireLoopIn(c, idOrName);
      if (loop.archivedAt) return loop;
      const updated = nowIso();
      const archivedStatus: LoopStatus = loop.status === "active" ? "paused" : loop.status;
      await c.execute(
        `UPDATE loops SET status=$1, archived_at=$2, archived_from_status=$3, updated_at=$4 WHERE id=$5`,
        [archivedStatus, updated, loop.status, updated, loop.id],
      );
      await this.setWorkItemsForLoop(c, loop.id, "deferred", "loop archived", updated);
      const archived = await this.loadLoop(c, loop.id);
      if (!archived) throw new Error(`loop not found after archive: ${loop.id}`);
      return archived;
    });
  }

  async unarchiveLoop(...args: M<"unarchiveLoop">["args"]): Promise<M<"unarchiveLoop">["result"]> {
    const idOrName = args[0];
    const loop = await this.requireLoop(idOrName);
    if (!loop.archivedAt) return loop;
    const updated = nowIso();
    const restoredStatus = loop.archivedFromStatus ?? loop.status;
    await this.client.execute(
      `UPDATE loops SET status=$1, archived_at=NULL, archived_from_status=NULL, updated_at=$2 WHERE id=$3`,
      [restoredStatus, updated, loop.id],
    );
    const unarchived = await this.getLoop(loop.id);
    if (!unarchived) throw new Error(`loop not found after unarchive: ${loop.id}`);
    return unarchived;
  }

  async deleteLoop(...args: M<"deleteLoop">["args"]): Promise<M<"deleteLoop">["result"]> {
    const idOrName = args[0];
    return this.client.transaction(async (c) => {
      const loop = await this.requireLoopIn(c, idOrName);
      await this.setWorkItemsForLoop(c, loop.id, "cancelled", "loop deleted", nowIso());
      // loop_runs.loop_id REFERENCES loops ON DELETE CASCADE handles children.
      const res = await c.query(`DELETE FROM loops WHERE id = $1`, [loop.id]);
      return res.rowCount > 0;
    });
  }

  private async requireLoopIn(c: TypedQueryClient, idOrName: string): Promise<Loop> {
    const byId = await this.loadLoop(c, idOrName);
    if (byId) return byId;
    const row = await c.get<LoopRow>(
      "SELECT * FROM loops WHERE name = $1 ORDER BY created_at DESC LIMIT 1",
      [idOrName],
    );
    if (!row) throw new LoopNotFoundError(idOrName);
    return rowToLoop(row);
  }

  async countLoops(...args: M<"countLoops">["args"]): Promise<M<"countLoops">["result"]> {
    const [status, opts = {}] = args;
    let sql: string;
    const params: unknown[] = [];
    if (status && opts.archived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE status = $1 AND archived_at IS NOT NULL";
      params.push(status);
    } else if (status && opts.includeArchived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE status = $1";
      params.push(status);
    } else if (status) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE status = $1 AND archived_at IS NULL";
      params.push(status);
    } else if (opts.archived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE archived_at IS NOT NULL";
    } else if (opts.includeArchived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops";
    } else {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE archived_at IS NULL";
    }
    const row = await this.client.get<{ count: number }>(sql, params);
    return row?.count ?? 0;
  }

  // ----------------------------------------------- id-preserving bulk import
  // Postgres counterparts of the sqlite Store.upsertMigration* methods. These
  // preserve the incoming id/status/timestamps exactly (no genId, no forced
  // "active"), so a local->self-hosted backfill reproduces the source rows
  // faithfully and idempotently (ON CONFLICT(id) DO UPDATE — re-runs never
  // duplicate). Without --replace an existing row is left untouched and
  // returned as-is. Run/step output is re-clamped by persistedRunOutput and
  // errors re-scrubbed, matching the sqlite import semantics exactly.

  async upsertMigrationWorkflow(
    ...args: M<"upsertMigrationWorkflow">["args"]
  ): Promise<M<"upsertMigrationWorkflow">["result"]> {
    const [workflow, opts = {}] = args as [WorkflowSpec, { replace?: boolean }?];
    const existing = await this.getWorkflow(workflow.id);
    if (existing && !opts.replace) return existing;
    await this.client.execute(
      `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
       ON CONFLICT(id) DO UPDATE SET
         name=EXCLUDED.name,
         description=EXCLUDED.description,
         version=EXCLUDED.version,
         status=EXCLUDED.status,
         goal_json=EXCLUDED.goal_json,
         steps_json=EXCLUDED.steps_json,
         created_at=EXCLUDED.created_at,
         updated_at=EXCLUDED.updated_at`,
      [
        workflow.id,
        workflow.name,
        workflow.description ?? null,
        workflow.version,
        workflow.status,
        workflow.goal ? JSON.stringify(workflow.goal) : null,
        JSON.stringify(workflow.steps),
        workflow.createdAt,
        workflow.updatedAt,
      ],
    );
    const imported = await this.getWorkflow(workflow.id);
    if (!imported) throw new Error(`workflow not found after migration import: ${workflow.id}`);
    return imported;
  }

  async upsertMigrationLoop(...args: M<"upsertMigrationLoop">["args"]): Promise<M<"upsertMigrationLoop">["result"]> {
    const [loop, opts = {}] = args as [Loop, { replace?: boolean }?];
    const existing = await this.loadLoop(this.client, loop.id);
    if (existing && !opts.replace) return existing;
    await this.client.execute(
      `INSERT INTO loops (id, name, description, status, archived_at, archived_from_status, schedule_json, target_json,
        goal_json, machine_json, next_run_at, retry_scheduled_for, catch_up, catch_up_limit, overlap, max_attempts,
        retry_delay_ms, lease_ms, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT(id) DO UPDATE SET
         name=EXCLUDED.name,
         description=EXCLUDED.description,
         status=EXCLUDED.status,
         archived_at=EXCLUDED.archived_at,
         archived_from_status=EXCLUDED.archived_from_status,
         schedule_json=EXCLUDED.schedule_json,
         target_json=EXCLUDED.target_json,
         goal_json=EXCLUDED.goal_json,
         machine_json=EXCLUDED.machine_json,
         next_run_at=EXCLUDED.next_run_at,
         retry_scheduled_for=EXCLUDED.retry_scheduled_for,
         catch_up=EXCLUDED.catch_up,
         catch_up_limit=EXCLUDED.catch_up_limit,
         overlap=EXCLUDED.overlap,
         max_attempts=EXCLUDED.max_attempts,
         retry_delay_ms=EXCLUDED.retry_delay_ms,
         lease_ms=EXCLUDED.lease_ms,
         expires_at=EXCLUDED.expires_at,
         created_at=EXCLUDED.created_at,
         updated_at=EXCLUDED.updated_at`,
      [
        loop.id,
        loop.name,
        loop.description ?? null,
        loop.status,
        loop.archivedAt ?? null,
        loop.archivedFromStatus ?? null,
        JSON.stringify(loop.schedule),
        JSON.stringify(loop.target),
        loop.goal ? JSON.stringify(loop.goal) : null,
        loop.machine ? JSON.stringify(loop.machine) : null,
        loop.nextRunAt ?? null,
        loop.retryScheduledFor ?? null,
        loop.catchUp,
        loop.catchUpLimit,
        loop.overlap,
        loop.maxAttempts,
        loop.retryDelayMs,
        loop.leaseMs,
        loop.expiresAt ?? null,
        loop.createdAt,
        loop.updatedAt,
      ],
    );
    const imported = await this.loadLoop(this.client, loop.id);
    if (!imported) throw new Error(`loop not found after migration import: ${loop.id}`);
    return imported;
  }

  async upsertMigrationRun(...args: M<"upsertMigrationRun">["args"]): Promise<M<"upsertMigrationRun">["result"]> {
    const [run, opts = {}] = args as [LoopRun, { replace?: boolean }?];
    if (run.status === "running") throw new ValidationError(`cannot import running run ${run.id}`);
    const existing = await this.loadRun(this.client, run.id);
    if (existing && !opts.replace) return existing;
    await this.client.execute(
      `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
        claimed_by, claim_token, lease_expires_at, pid, pgid, process_started_at, exit_code, duration_ms,
        stdout, stderr, error, goal_run_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT(id) DO UPDATE SET
         loop_id=EXCLUDED.loop_id,
         loop_name=EXCLUDED.loop_name,
         scheduled_for=EXCLUDED.scheduled_for,
         attempt=EXCLUDED.attempt,
         status=EXCLUDED.status,
         started_at=EXCLUDED.started_at,
         finished_at=EXCLUDED.finished_at,
         claimed_by=EXCLUDED.claimed_by,
         claim_token=NULL,
         lease_expires_at=EXCLUDED.lease_expires_at,
         pid=EXCLUDED.pid,
         pgid=EXCLUDED.pgid,
         process_started_at=EXCLUDED.process_started_at,
         exit_code=EXCLUDED.exit_code,
         duration_ms=EXCLUDED.duration_ms,
         stdout=EXCLUDED.stdout,
         stderr=EXCLUDED.stderr,
         error=EXCLUDED.error,
         goal_run_id=EXCLUDED.goal_run_id,
         created_at=EXCLUDED.created_at,
         updated_at=EXCLUDED.updated_at`,
      [
        run.id,
        run.loopId,
        run.loopName,
        run.scheduledFor,
        run.attempt,
        run.status,
        run.startedAt ?? null,
        run.finishedAt ?? null,
        run.claimedBy ?? null,
        run.leaseExpiresAt ?? null,
        run.pid ?? null,
        run.pgid ?? null,
        run.processStartedAt ?? null,
        run.exitCode ?? null,
        run.durationMs ?? null,
        persistedRunOutput(run.stdout),
        persistedRunOutput(run.stderr),
        scrubbedOrNull(run.error),
        run.goalRunId ?? null,
        run.createdAt,
        run.updatedAt,
      ],
    );
    const imported = await this.loadRun(this.client, run.id);
    if (!imported) throw new Error(`run not found after migration import: ${run.id}`);
    return imported;
  }

  // ------------------------------------------------------------- run lifecycle

  async createSkippedRun(...args: M<"createSkippedRun">["args"]): Promise<M<"createSkippedRun">["result"]> {
    const [loop, scheduledFor, reason, opts = {}] = args;
    const now = nowIso();
    const id = genId();
    return this.client.transaction(async (c) => {
      await this.assertDaemonLeaseFence(c, opts, now);
      await c.execute(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
          claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
         VALUES ($1,$2,$3,$4,1,'skipped',NULL,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$7,$7)
         ON CONFLICT (loop_id, scheduled_for) DO NOTHING`,
        [id, loop.id, loop.name, scheduledFor, now, reason, now],
      );
      const run = await this.loadRunBySlot(c, loop.id, scheduledFor);
      if (run) return run;
      // No row (conflict AND slot vanished): synthesize the intended record.
      return {
        id,
        loopId: loop.id,
        loopName: loop.name,
        scheduledFor,
        attempt: 1,
        status: "skipped",
        finishedAt: now,
        error: reason,
        createdAt: now,
        updatedAt: now,
      } as LoopRun;
    });
  }

  async getRun(...args: M<"getRun">["args"]): Promise<M<"getRun">["result"]> {
    return this.loadRun(this.client, args[0]);
  }

  async getRunBySlot(...args: M<"getRunBySlot">["args"]): Promise<M<"getRunBySlot">["result"]> {
    return this.loadRunBySlot(this.client, args[0], args[1]);
  }

  /**
   * Claim a specific loop slot for a runner.
   *
   * Divergence from the sqlite Store (documented, not accidental): the sqlite
   * path also consults LOCAL process liveness (`isRecordedProcessAlive`,
   * `hasLiveWorkflowStepProcesses`) before stealing an expired-lease run,
   * because the daemon and the run's child process share a host. On the
   * Postgres/remote backend the claiming runner may be a different machine than
   * the one that holds the (possibly still-live) process, so local pid checks
   * are meaningless. Ownership here is governed purely by lease expiry: an
   * expired lease is reclaimable, a live lease is not. The lease/heartbeat
   * contract (plus `FOR UPDATE` row locks) is the remote correctness boundary.
   */
  async claimRun(...args: M<"claimRun">["args"]): Promise<M<"claimRun">["result"]> {
    const [loopArg, scheduledFor, runnerId, now = new Date(), opts = {}] = args;
    const startedAt = now.toISOString();
    const claimToken = opts.claimToken ?? genId();
    return this.client.transaction(async (c) => {
      await this.assertDaemonLeaseFence(c, opts, startedAt);
      const loop = await this.loadLoop(c, loopArg.id);
      if (!loop || loop.archivedAt) return undefined;
      const leaseExpiresAt = new Date(now.getTime() + loop.leaseMs).toISOString();

      // Overlap=skip: refuse if any OTHER slot of this loop holds a live lease.
      if (loop.overlap === "skip") {
        const blocking = await c.get<{ id: string }>(
          `SELECT id FROM loop_runs
           WHERE loop_id=$1 AND scheduled_for<>$2 AND status='running'
             AND lease_expires_at IS NOT NULL AND lease_expires_at > $3
           LIMIT 1`,
          [loop.id, scheduledFor, startedAt],
        );
        if (blocking) return undefined;
      }

      // Lock the target slot row (if present) so concurrent claimers serialize.
      const existing = await c.get<RunRow>(
        "SELECT * FROM loop_runs WHERE loop_id=$1 AND scheduled_for=$2 FOR UPDATE",
        [loop.id, scheduledFor],
      );

      if (existing) {
        if (existing.status === "running") {
          if (existing.lease_expires_at && (existing.lease_expires_at as string) > startedAt) {
            return undefined; // live lease, cannot steal
          }
          const res = await c.query(
            `UPDATE loop_runs SET status='running', started_at=$2, finished_at=NULL, claimed_by=$3, claim_token=$4,
             lease_expires_at=$5, pid=NULL, pgid=NULL, process_started_at=NULL, exit_code=NULL, duration_ms=NULL,
             stdout=NULL, stderr=NULL, error=NULL, updated_at=$2
             WHERE id=$1 AND status='running' AND lease_expires_at <= $6`,
            [existing.id, startedAt, runnerId, claimToken, leaseExpiresAt, startedAt],
          );
          if (res.rowCount !== 1) return undefined;
          const run = await this.loadRun(c, existing.id);
          return run ? { run, loop, claimToken } : undefined;
        }
        if (existing.status === "succeeded" || existing.status === "skipped") return undefined;
        // failed/timed_out/abandoned -> retry if attempts remain.
        const attempt = existing.attempt + 1;
        const res = await c.query(
          `UPDATE loop_runs SET attempt=$2, status='running', started_at=$3, finished_at=NULL, claimed_by=$4, claim_token=$5,
           lease_expires_at=$6, pid=NULL, pgid=NULL, process_started_at=NULL, exit_code=NULL, duration_ms=NULL,
           stdout=NULL, stderr=NULL, error=NULL, updated_at=$3
           WHERE id=$1 AND status IN ('failed','timed_out','abandoned') AND attempt < $7`,
          [existing.id, attempt, startedAt, runnerId, claimToken, leaseExpiresAt, loop.maxAttempts],
        );
        if (res.rowCount !== 1) return undefined;
        const run = await this.loadRun(c, existing.id);
        return run ? { run, loop, claimToken } : undefined;
      }

      const id = genId();
      const res = await c.query(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
          claimed_by, claim_token, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
         VALUES ($1,$2,$3,$4,1,'running',$5,NULL,$6,$7,$8,NULL,NULL,NULL,NULL,NULL,NULL,$5,$5)
         ON CONFLICT (loop_id, scheduled_for) DO NOTHING`,
        [id, loop.id, loop.name, scheduledFor, startedAt, runnerId, claimToken, leaseExpiresAt],
      );
      if (res.rowCount !== 1) return undefined;
      const run = await this.loadRun(c, id);
      return run ? { run, loop, claimToken } : undefined;
    });
  }

  async finalizeRun(...args: M<"finalizeRun">["args"]): Promise<M<"finalizeRun">["result"]> {
    const [id, patch, opts = {}] = args;
    const finishedAt = patch.finishedAt ?? nowIso();
    const error = patch.error === undefined ? undefined : persistedRunOutput(patch.error) ?? undefined;
    const nowStr = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      let res;
      if (opts.claimedBy) {
        res = await c.query(
          `UPDATE loop_runs SET status=$2, finished_at=$3, claim_token=NULL, lease_expires_at=NULL, pid=$4, exit_code=$5,
           duration_ms=$6, stdout=$7, stderr=$8, error=$9, updated_at=$3
           WHERE id=$1 AND status='running' AND claimed_by=$10 AND lease_expires_at > $11
             AND ($12::text IS NULL OR claim_token=$12)
             AND ($13::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE id=$13 AND expires_at > $11))`,
          [
            id,
            patch.status,
            finishedAt,
            patch.pid ?? null,
            patch.exitCode ?? null,
            patch.durationMs ?? null,
            persistedRunOutput(patch.stdout),
            persistedRunOutput(patch.stderr),
            error ?? null,
            opts.claimedBy,
            nowStr,
            opts.claimToken ?? null,
            opts.daemonLeaseId ?? null,
          ],
        );
      } else {
        res = await c.query(
          `UPDATE loop_runs SET status=$2, finished_at=$3, claim_token=NULL, lease_expires_at=NULL, pid=$4, exit_code=$5,
           duration_ms=$6, stdout=$7, stderr=$8, error=$9, updated_at=$3
           WHERE id=$1 AND status='running'`,
          [
            id,
            patch.status,
            finishedAt,
            patch.pid ?? null,
            patch.exitCode ?? null,
            patch.durationMs ?? null,
            persistedRunOutput(patch.stdout),
            persistedRunOutput(patch.stderr),
            error ?? null,
          ],
        );
      }
      const run = await this.loadRun(c, id);
      if (!run) throw new Error(`run not found after finalize: ${id}`);
      if (opts.claimedBy && res.rowCount !== 1) return run;
      if (res.rowCount === 1) {
        await this.cascadeWorkItemsForLoopRun(c, run, error, finishedAt);
      }
      return run;
    });
  }

  async heartbeatRunLease(...args: M<"heartbeatRunLease">["args"]): Promise<M<"heartbeatRunLease">["result"]> {
    const [id, claimedBy, leaseMs, now = new Date(), opts = {}] = args;
    const nowStr = now.toISOString();
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const res = await this.client.query(
      `UPDATE loop_runs SET lease_expires_at=$2, updated_at=$3
       WHERE id=$1 AND status='running' AND claimed_by=$4 AND lease_expires_at > $5
         AND ($6::text IS NULL OR claim_token=$6)
         AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE id=$7 AND expires_at > $5))`,
      [id, expiresAt, nowStr, claimedBy, nowStr, opts.claimToken ?? null, opts.daemonLeaseId ?? null],
    );
    if (res.rowCount !== 1) return undefined;
    return this.getRun(id);
  }

  async recordRunProcess(...args: M<"recordRunProcess">["args"]): Promise<M<"recordRunProcess">["result"]> {
    const [runId, info, opts = {}] = args;
    const now = (opts.now ?? new Date()).toISOString();
    const res = await this.client.query(
      `UPDATE loop_runs SET pid=$2, pgid=$3, process_started_at=$4, updated_at=$5
       WHERE id=$1 AND status='running'
         AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE id=$6 AND expires_at > $7))`,
      [runId, info.pid, info.pgid ?? null, info.processStartedAt ?? now, now, opts.daemonLeaseId ?? null, now],
    );
    if (res.rowCount !== 1) return undefined;
    return this.getRun(runId);
  }

  async listRuns(...args: M<"listRuns">["args"]): Promise<M<"listRuns">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    let rows: RunRow[];
    if (opts.loopId && opts.status) {
      rows = await this.client.many<RunRow>(
        "SELECT * FROM loop_runs WHERE loop_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
        [opts.loopId, opts.status, limit, offset],
      );
    } else if (opts.loopId) {
      rows = await this.client.many<RunRow>(
        "SELECT * FROM loop_runs WHERE loop_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        [opts.loopId, limit, offset],
      );
    } else if (opts.status) {
      rows = await this.client.many<RunRow>(
        "SELECT * FROM loop_runs WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        [opts.status, limit, offset],
      );
    } else {
      rows = await this.client.many<RunRow>("SELECT * FROM loop_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    }
    return rows.map(rowToRun);
  }

  async writeRunReceipt(...args: M<"writeRunReceipt">["args"]): Promise<M<"writeRunReceipt">["result"]> {
    const [input, opts = {}] = args as [WriteRunReceiptInput, { now?: Date }?];
    const inputRunId = typeof input.run_id === "string" && input.run_id.trim() ? input.run_id : undefined;
    const existing = inputRunId ? await this.getRunReceipt(inputRunId) : undefined;
    const run = inputRunId ? await this.getRun(inputRunId) : undefined;
    const loop = input.loop_id ? await this.getLoop(input.loop_id) : run ? await this.getLoop(run.loopId) : undefined;
    const receipt = normalizeRunReceipt(input, { now: opts.now, run, loop, existing });
    await this.client.execute(
      `INSERT INTO run_receipts (run_id, loop_id, machine_json, repo, task_ids_json, knowledge_ids_json, digest_id,
        started_at, finished_at, status, exit_code, summary_json, evidence_paths_json, created_at, updated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)
       ON CONFLICT(run_id) DO UPDATE SET
        loop_id=EXCLUDED.loop_id,
        machine_json=EXCLUDED.machine_json,
        repo=EXCLUDED.repo,
        task_ids_json=EXCLUDED.task_ids_json,
        knowledge_ids_json=EXCLUDED.knowledge_ids_json,
        digest_id=EXCLUDED.digest_id,
        started_at=EXCLUDED.started_at,
        finished_at=EXCLUDED.finished_at,
        status=EXCLUDED.status,
        exit_code=EXCLUDED.exit_code,
        summary_json=EXCLUDED.summary_json,
        evidence_paths_json=EXCLUDED.evidence_paths_json,
        updated_at=EXCLUDED.updated_at`,
      [
        receipt.run_id,
        receipt.loop_id,
        JSON.stringify(receipt.machine),
        receipt.repo,
        JSON.stringify(receipt.task_ids),
        JSON.stringify(receipt.knowledge_ids),
        receipt.digest_id,
        receipt.started_at,
        receipt.finished_at,
        receipt.status,
        receipt.exit_code,
        JSON.stringify(receipt.summary),
        JSON.stringify(receipt.evidence_paths),
        receipt.created_at,
        receipt.updated_at,
      ],
    );
    return (await this.getRunReceipt(receipt.run_id)) ?? receipt;
  }

  async getRunReceipt(...args: M<"getRunReceipt">["args"]): Promise<M<"getRunReceipt">["result"]> {
    const row = await this.client.get<RunReceiptRow>("SELECT * FROM run_receipts WHERE run_id = $1", [args[0]]);
    return row ? rowToRunReceipt(row) : undefined;
  }

  async listRunReceipts(...args: M<"listRunReceipts">["args"]): Promise<M<"listRunReceipts">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    const filters: string[] = [];
    const params: unknown[] = [];
    const next = () => `$${params.length + 1}`;
    if (opts.loopId) {
      const slot = next();
      filters.push(`loop_id = ${slot}`);
      params.push(opts.loopId);
    }
    if (opts.repo) {
      const slot = next();
      filters.push(`repo = ${slot}`);
      params.push(opts.repo);
    }
    if (opts.status) {
      const slot = next();
      filters.push(`status = ${slot}`);
      params.push(opts.status);
    }
    if (opts.taskId) {
      const slot = next();
      filters.push(`task_ids_json ? ${slot}`);
      params.push(opts.taskId);
    }
    if (opts.knowledgeId) {
      const slot = next();
      filters.push(`knowledge_ids_json ? ${slot}`);
      params.push(opts.knowledgeId);
    }
    const limitSlot = next();
    params.push(limit);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await this.client.many<RunReceiptRow>(
      `SELECT * FROM run_receipts ${where} ORDER BY created_at DESC LIMIT ${limitSlot}`,
      params,
    );
    return rows.map(rowToRunReceipt);
  }

  async countRuns(...args: M<"countRuns">["args"]): Promise<M<"countRuns">["result"]> {
    const status = args[0];
    const row = status
      ? await this.client.get<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM loop_runs WHERE status = $1",
          [status],
        )
      : await this.client.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM loop_runs", []);
    return row?.count ?? 0;
  }

  async recoverExpiredRunLeases(
    ...args: M<"recoverExpiredRunLeases">["args"]
  ): Promise<M<"recoverExpiredRunLeases">["result"]> {
    const detailed = await this.recoverExpiredRunLeasesDetailed(...args);
    return detailed.abandoned;
  }

  /**
   * Recover expired run leases. Divergence from sqlite (documented): the remote
   * backend cannot inspect local process liveness, so an expired lease is always
   * abandoned (never "deferred because the local process is still alive"). The
   * `deferred` array is therefore always empty here. The generated-route
   * workflow archival side effect is not ported (route automation is a TIER 2
   * path); the core guarantee — no run stays `running` past its lease — holds.
   */
  async recoverExpiredRunLeasesDetailed(
    ...args: M<"recoverExpiredRunLeasesDetailed">["args"]
  ): Promise<RecoverExpiredRunLeasesResult> {
    const [now = new Date(), opts = {}] = args;
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts.limit ?? DEFAULT_RECOVERY_BATCH_LIMIT)));
    const scanLimit = Math.max(
      limit,
      Math.min(5_000, Math.floor(opts.scanLimit ?? limit * DEFAULT_RECOVERY_SCAN_MULTIPLIER)),
    );
    const finished = now.toISOString();
    const rows = await this.client.many<RunRow>(
      `SELECT * FROM loop_runs WHERE status='running' AND lease_expires_at <= $1 ORDER BY lease_expires_at ASC LIMIT $2`,
      [finished, scanLimit],
    );
    const recovered: LoopRun[] = [];
    for (const row of rows) {
      if (recovered.length >= limit) break;
      const run = await this.client.transaction(async (c) => {
        const res = await c.query(
          `UPDATE loop_runs SET status='abandoned', finished_at=$2, lease_expires_at=NULL,
           error='run lease expired before completion', updated_at=$2
           WHERE id=$1 AND status='running' AND lease_expires_at <= $3
             AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE id=$4 AND expires_at > $3))`,
          [row.id, finished, finished, opts.daemonLeaseId ?? null],
        );
        if (res.rowCount !== 1) return undefined;
        const workflowRows = await c.many<WorkflowRunRow>(
          "SELECT * FROM workflow_runs WHERE loop_run_id = $1 AND status NOT IN ('succeeded','failed','timed_out','cancelled')",
          [row.id],
        );
        for (const wf of workflowRows) {
          const wfRes = await c.query(
            `UPDATE workflow_runs SET status='failed', finished_at=$2,
             error='parent loop run lease expired before completion', updated_at=$2
             WHERE id=$1 AND status NOT IN ('succeeded','failed','timed_out','cancelled')`,
            [wf.id, finished],
          );
          if (wfRes.rowCount !== 1) continue;
          await c.execute(
            `UPDATE workflow_step_runs SET status='skipped', finished_at=$2, pid=NULL,
             error='parent loop run lease expired before completion', updated_at=$2
             WHERE workflow_run_id=$1 AND status IN ('pending','running')`,
            [wf.id, finished],
          );
          await this.setWorkItemsForWorkflowRun(
            c,
            wf.id,
            "failed",
            "parent loop run lease expired before completion",
            finished,
          );
        }
        const loop = await this.loadLoop(c, row.loop_id);
        const itemStatus = workItemStatusForLoopRun("abandoned", row.attempt, loop?.maxAttempts);
        if (itemStatus) {
          const statuses: WorkflowWorkItemStatus[] =
            itemStatus === "admitted" ? ["admitted", "running", "failed"] : ["admitted", "running"];
          const reason =
            itemStatus === "admitted"
              ? "run lease expired before completion; retry pending"
              : "run lease expired before completion";
          await this.setWorkItemsForLoop(c, row.loop_id, itemStatus, reason, finished, statuses);
        }
        return this.loadRun(c, row.id);
      });
      if (run) recovered.push(run);
    }
    return { abandoned: recovered, deferred: [] };
  }

  async pruneHistory(...args: M<"pruneHistory">["args"]): Promise<M<"pruneHistory">["result"]> {
    const opts = args[0];
    const { maxAgeDays, keepPerLoop } = opts;
    if (maxAgeDays === undefined && keepPerLoop === undefined) {
      throw new ValidationError("pruneHistory requires maxAgeDays and/or keepPerLoop");
    }
    if (maxAgeDays !== undefined && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0)) {
      throw new ValidationError(`pruneHistory maxAgeDays must be a non-negative number: ${maxAgeDays}`);
    }
    if (keepPerLoop !== undefined && (!Number.isInteger(keepPerLoop) || keepPerLoop < 0)) {
      throw new ValidationError(`pruneHistory keepPerLoop must be a non-negative integer: ${keepPerLoop}`);
    }
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun ?? false;
    const cutoff = maxAgeDays === undefined ? undefined : new Date(now.getTime() - maxAgeDays * 86_400_000).toISOString();
    const terminal = TERMINAL_RUN_STATUSES.map((s) => `'${s}'`).join(",");
    const candidateIds = (
      await this.client.many<{ id: string }>(
        `WITH ranked AS (
           SELECT id, status, created_at,
             ROW_NUMBER() OVER (PARTITION BY loop_id ORDER BY created_at DESC, id DESC) AS recency
           FROM loop_runs
         )
         SELECT id FROM ranked
         WHERE status IN (${terminal})
           AND ($1::timestamptz IS NULL OR created_at < $1::timestamptz)
           AND ($2::int IS NULL OR recency > $2)`,
        [cutoff ?? null, keepPerLoop ?? null],
      )
    ).map((r) => r.id);

    const summary: PruneHistorySummary = {
      dryRun,
      cutoff,
      keepPerLoop,
      loopRuns: dryRun ? candidateIds.length : 0,
      workflowRuns: 0,
      goalRuns: 0,
    };

    for (let offset = 0; offset < candidateIds.length; offset += PRUNE_BATCH_SIZE) {
      const batch = candidateIds.slice(offset, offset + PRUNE_BATCH_SIZE);
      if (dryRun) {
        const workflowRunIds = (
          await this.client.many<{ id: string }>(
            `SELECT id FROM workflow_runs WHERE loop_run_id = ANY($1)`,
            [batch],
          )
        ).map((r) => r.id);
        summary.workflowRuns += workflowRunIds.length;
        const gr = await this.client.get<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM goal_runs WHERE loop_run_id = ANY($1) OR workflow_run_id = ANY($2)`,
          [batch, workflowRunIds],
        );
        summary.goalRuns += gr?.count ?? 0;
        continue;
      }
      await this.client.transaction(async (c) => {
        const confirmed = (
          await c.many<{ id: string }>(
            `SELECT id FROM loop_runs WHERE id = ANY($1) AND status IN (${terminal})`,
            [batch],
          )
        ).map((r) => r.id);
        if (confirmed.length === 0) return;
        const workflowRunIds = (
          await c.many<{ id: string }>(`SELECT id FROM workflow_runs WHERE loop_run_id = ANY($1)`, [confirmed])
        ).map((r) => r.id);
        summary.loopRuns += confirmed.length;
        summary.workflowRuns += workflowRunIds.length;
        const gr = await c.query(
          `DELETE FROM goal_runs WHERE loop_run_id = ANY($1) OR workflow_run_id = ANY($2)`,
          [confirmed, workflowRunIds],
        );
        summary.goalRuns += gr.rowCount;
        // workflow_runs.loop_run_id ON DELETE SET NULL; delete them explicitly to
        // mirror sqlite pruning of orphaned workflow history.
        if (workflowRunIds.length > 0) {
          await c.execute(`DELETE FROM workflow_runs WHERE id = ANY($1)`, [workflowRunIds]);
        }
        await c.execute(`DELETE FROM loop_runs WHERE id = ANY($1) AND status IN (${terminal})`, [confirmed]);
      });
    }
    return summary;
  }

  // -------------------------------------------------------------- daemon lease

  async acquireDaemonLease(...args: M<"acquireDaemonLease">["args"]): Promise<M<"acquireDaemonLease">["result"]> {
    const input = args[0];
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    return this.client.transaction(async (c) => {
      const existing = await c.get<LeaseRow>("SELECT * FROM daemon_lease LIMIT 1 FOR UPDATE", []);
      if (existing && (existing.expires_at as string) > now.toISOString() && existing.id !== input.id) {
        return undefined;
      }
      await c.execute("DELETE FROM daemon_lease", []);
      await c.execute(
        `INSERT INTO daemon_lease (id, pid, hostname, heartbeat_at, expires_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$4,$4)`,
        [input.id, input.pid, input.hostname, now.toISOString(), expiresAt],
      );
      return this.loadDaemonLease(c);
    });
  }

  async heartbeatDaemonLease(...args: M<"heartbeatDaemonLease">["args"]): Promise<M<"heartbeatDaemonLease">["result"]> {
    const [id, ttlMs, now = new Date()] = args;
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const res = await this.client.query(
      `UPDATE daemon_lease SET heartbeat_at=$2, expires_at=$3, updated_at=$2 WHERE id=$1 AND expires_at > $4`,
      [id, now.toISOString(), expiresAt, now.toISOString()],
    );
    if (res.rowCount !== 1) return undefined;
    return this.getDaemonLease();
  }

  async releaseDaemonLease(...args: M<"releaseDaemonLease">["args"]): Promise<M<"releaseDaemonLease">["result"]> {
    await this.client.execute("DELETE FROM daemon_lease WHERE id = $1", [args[0]]);
  }

  async getDaemonLease(...args: M<"getDaemonLease">["args"]): Promise<M<"getDaemonLease">["result"]> {
    void args;
    return this.loadDaemonLease(this.client);
  }

  // --------------------------------------------------------- workflows (reads)

  private async loadWorkflow(c: TypedQueryClient, id: string) {
    const row = await c.get<WorkflowRow>("SELECT * FROM workflow_specs WHERE id = $1", [id]);
    return row ? rowToWorkflow(row) : undefined;
  }

  async getWorkflow(...args: M<"getWorkflow">["args"]): Promise<M<"getWorkflow">["result"]> {
    return this.loadWorkflow(this.client, args[0]);
  }

  async listWorkflows(...args: M<"listWorkflows">["args"]): Promise<M<"listWorkflows">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 200;
    const offset = opts.offset ?? 0;
    const rows = opts.status
      ? await this.client.many<WorkflowRow>(
          "SELECT * FROM workflow_specs WHERE status = $1 ORDER BY status ASC, name ASC LIMIT $2 OFFSET $3",
          [opts.status, limit, offset],
        )
      : await this.client.many<WorkflowRow>(
          "SELECT * FROM workflow_specs ORDER BY status ASC, name ASC LIMIT $1 OFFSET $2",
          [limit, offset],
        );
    return rows.map(rowToWorkflow);
  }

  async countWorkflows(...args: M<"countWorkflows">["args"]): Promise<M<"countWorkflows">["result"]> {
    const opts = args[0] ?? {};
    const row = opts.status
      ? await this.client.get<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM workflow_specs WHERE status = $1",
          [opts.status],
        )
      : await this.client.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM workflow_specs", []);
    return row?.count ?? 0;
  }

  async getWorkflowInvocation(
    ...args: M<"getWorkflowInvocation">["args"]
  ): Promise<M<"getWorkflowInvocation">["result"]> {
    const row = await this.client.get<WorkflowInvocationRow>(
      "SELECT * FROM workflow_invocations WHERE id = $1",
      [args[0]],
    );
    return row ? rowToWorkflowInvocation(row) : undefined;
  }

  async listWorkflowInvocations(
    ...args: M<"listWorkflowInvocations">["args"]
  ): Promise<M<"listWorkflowInvocations">["result"]> {
    const opts = args[0] ?? {};
    const rows = await this.client.many<WorkflowInvocationRow>(
      "SELECT * FROM workflow_invocations ORDER BY created_at DESC LIMIT $1",
      [opts.limit ?? 100],
    );
    return rows.map(rowToWorkflowInvocation);
  }

  async getWorkflowWorkItem(...args: M<"getWorkflowWorkItem">["args"]): Promise<M<"getWorkflowWorkItem">["result"]> {
    const row = await this.client.get<WorkflowWorkItemRow>(
      "SELECT * FROM workflow_work_items WHERE id = $1",
      [args[0]],
    );
    return row ? rowToWorkflowWorkItem(row) : undefined;
  }

  async listWorkflowWorkItems(
    ...args: M<"listWorkflowWorkItems">["args"]
  ): Promise<M<"listWorkflowWorkItems">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    let rows: WorkflowWorkItemRow[];
    if (opts.status && opts.routeKey) {
      rows = await this.client.many<WorkflowWorkItemRow>(
        "SELECT * FROM workflow_work_items WHERE status = $1 AND route_key = $2 ORDER BY priority DESC, created_at ASC LIMIT $3",
        [opts.status, opts.routeKey, limit],
      );
    } else if (opts.status) {
      rows = await this.client.many<WorkflowWorkItemRow>(
        "SELECT * FROM workflow_work_items WHERE status = $1 ORDER BY priority DESC, created_at ASC LIMIT $2",
        [opts.status, limit],
      );
    } else if (opts.routeKey) {
      rows = await this.client.many<WorkflowWorkItemRow>(
        "SELECT * FROM workflow_work_items WHERE route_key = $1 ORDER BY priority DESC, created_at ASC LIMIT $2",
        [opts.routeKey, limit],
      );
    } else {
      rows = await this.client.many<WorkflowWorkItemRow>(
        "SELECT * FROM workflow_work_items ORDER BY priority DESC, created_at ASC LIMIT $1",
        [limit],
      );
    }
    return rows.map(rowToWorkflowWorkItem);
  }

  async countActiveWorkflowWorkItems(
    ...args: M<"countActiveWorkflowWorkItems">["args"]
  ): Promise<M<"countActiveWorkflowWorkItems">["result"]> {
    const a = args[0] ?? {};
    const active = "('admitted','running')";
    const scoped = async (col: string, val: string | undefined): Promise<number> => {
      const row = await this.client.get<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM workflow_work_items WHERE status IN ${active} AND ${col} = $1`,
        [val],
      );
      return row?.count ?? 0;
    };
    const routeScope = a.routeScope?.trim() || undefined;
    // `global` mirrors sqlite: route-scoped when a route identity is supplied
    // (per-router --max-active ceiling), store-wide otherwise.
    const global = routeScope
      ? await scoped("route_scope", routeScope)
      : (
          await this.client.get<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM workflow_work_items WHERE status IN ${active}`,
            [],
          )
        )?.count ?? 0;
    const project = a.projectKey ? await scoped("project_key", a.projectKey) : 0;
    const projectGroup = a.projectGroup ? await scoped("project_group", a.projectGroup) : undefined;
    return {
      global,
      project,
      ...(projectGroup !== undefined ? { projectGroup } : {}),
    } as M<"countActiveWorkflowWorkItems">["result"];
  }

  async getWorkflowRun(...args: M<"getWorkflowRun">["args"]): Promise<M<"getWorkflowRun">["result"]> {
    const row = await this.client.get<WorkflowRunRow>("SELECT * FROM workflow_runs WHERE id = $1", [args[0]]);
    return row ? rowToWorkflowRun(row) : undefined;
  }

  async listWorkflowRuns(...args: M<"listWorkflowRuns">["args"]): Promise<M<"listWorkflowRuns">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    let rows: WorkflowRunRow[];
    if (opts.workflowId && opts.loopRunId) {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE workflow_id = $1 AND loop_run_id = $2 ORDER BY created_at DESC LIMIT $3",
        [opts.workflowId, opts.loopRunId, limit],
      );
    } else if (opts.workflowId) {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT $2",
        [opts.workflowId, limit],
      );
    } else if (opts.loopRunId) {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE loop_run_id = $1 ORDER BY created_at DESC LIMIT $2",
        [opts.loopRunId, limit],
      );
    } else {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT $1",
        [limit],
      );
    }
    return rows.map(rowToWorkflowRun);
  }

  async listWorkflowStepRuns(...args: M<"listWorkflowStepRuns">["args"]): Promise<M<"listWorkflowStepRuns">["result"]> {
    const rows = await this.client.many<WorkflowStepRunRow>(
      "SELECT * FROM workflow_step_runs WHERE workflow_run_id = $1 ORDER BY sequence ASC",
      [args[0]],
    );
    return rows.map(rowToWorkflowStepRun);
  }

  async getWorkflowStepRun(...args: M<"getWorkflowStepRun">["args"]): Promise<M<"getWorkflowStepRun">["result"]> {
    const row = await this.client.get<WorkflowStepRunRow>(
      "SELECT * FROM workflow_step_runs WHERE workflow_run_id = $1 AND step_id = $2",
      [args[0], args[1]],
    );
    return row ? rowToWorkflowStepRun(row) : undefined;
  }

  async listWorkflowEvents(...args: M<"listWorkflowEvents">["args"]): Promise<M<"listWorkflowEvents">["result"]> {
    const [workflowRunId, limit = 200] = args as [string, number?];
    const rows = await this.client.many<WorkflowEventRow>(
      "SELECT * FROM workflow_events WHERE workflow_run_id = $1 ORDER BY sequence ASC LIMIT $2",
      [workflowRunId, limit],
    );
    return rows.map(rowToWorkflowEvent);
  }

  // -------------------------------------------------------------- goals (reads)

  async getGoal(...args: M<"getGoal">["args"]): Promise<M<"getGoal">["result"]> {
    const row = await this.client.get<GoalRow>("SELECT * FROM goals WHERE id = $1", [args[0]]);
    return row ? rowToGoal(row) : undefined;
  }

  async listGoals(...args: M<"listGoals">["args"]): Promise<M<"listGoals">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    const rows = opts.status
      ? await this.client.many<GoalRow>(
          "SELECT * FROM goals WHERE status = $1 ORDER BY updated_at DESC LIMIT $2",
          [opts.status, limit],
        )
      : await this.client.many<GoalRow>("SELECT * FROM goals ORDER BY updated_at DESC LIMIT $1", [limit]);
    return rows.map(rowToGoal);
  }

  async listGoalPlanNodes(...args: M<"listGoalPlanNodes">["args"]): Promise<M<"listGoalPlanNodes">["result"]> {
    const idOrPlan = args[0];
    const rows = await this.client.many<GoalPlanNodeRow>(
      "SELECT * FROM goal_plan_nodes WHERE goal_id = $1 OR plan_id = $1 ORDER BY sequence ASC",
      [idOrPlan],
    );
    // sqlite mapper reads `ready === 1`; pg boolean comes back true/false, so
    // coerce to the numeric shape the shared mapper expects.
    return rows.map((r) => rowToGoalPlanNode({ ...r, ready: (r.ready as unknown as boolean) ? 1 : 0 }));
  }

  async listGoalRuns(...args: M<"listGoalRuns">["args"]): Promise<M<"listGoalRuns">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    let rows: GoalRunRow[];
    if (opts.runId) {
      rows = await this.client.many<GoalRunRow>("SELECT * FROM goal_runs WHERE id = $1", [opts.runId]);
    } else if (opts.goalId) {
      rows = await this.client.many<GoalRunRow>(
        "SELECT * FROM goal_runs WHERE goal_id = $1 ORDER BY created_at ASC LIMIT $2",
        [opts.goalId, limit],
      );
    } else {
      rows = await this.client.many<GoalRunRow>("SELECT * FROM goal_runs ORDER BY created_at DESC LIMIT $1", [limit]);
    }
    return rows.map(rowToGoalRun);
  }

  // -------------------------------------------------------- TIER 2: not ported
  // Heavy multi-statement workflow/goal orchestration lifted straight from the
  // sqlite Store (manifest staging, goal status rollups, step sequencing). These
  // throw loudly rather than silently no-op. Port order matches sqlite Store.

  createWorkflow(): never {
    throw new NotImplementedError("createWorkflow");
  }
  archiveWorkflow(): never {
    throw new NotImplementedError("archiveWorkflow");
  }
  createWorkflowInvocation(): never {
    throw new NotImplementedError("createWorkflowInvocation");
  }
  upsertWorkflowWorkItem(): never {
    throw new NotImplementedError("upsertWorkflowWorkItem");
  }
  admitWorkflowWorkItem(): never {
    throw new NotImplementedError("admitWorkflowWorkItem");
  }
  createGoal(): never {
    throw new NotImplementedError("createGoal");
  }
  createGoalPlanNodes(): never {
    throw new NotImplementedError("createGoalPlanNodes");
  }
  updateGoalStatus(): never {
    throw new NotImplementedError("updateGoalStatus");
  }
  updateGoalPlanNode(): never {
    throw new NotImplementedError("updateGoalPlanNode");
  }
  recordGoalEvent(): never {
    throw new NotImplementedError("recordGoalEvent");
  }
  createWorkflowRun(): never {
    throw new NotImplementedError("createWorkflowRun");
  }
  startWorkflowStepRun(): never {
    throw new NotImplementedError("startWorkflowStepRun");
  }
  recoverWorkflowRun(): never {
    throw new NotImplementedError("recoverWorkflowRun");
  }
  finalizeWorkflowStepRun(): never {
    throw new NotImplementedError("finalizeWorkflowStepRun");
  }
  finalizeWorkflowRun(): never {
    throw new NotImplementedError("finalizeWorkflowRun");
  }
  appendWorkflowEvent(): never {
    throw new NotImplementedError("appendWorkflowEvent");
  }
}

export function createPostgresLoopStorage(client: PoolQueryClient): PostgresLoopStorage {
  return new PostgresLoopStorage(client);
}
