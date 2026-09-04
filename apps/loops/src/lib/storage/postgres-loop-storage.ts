// Postgres implementation of the LoopStorageContract.
//
// This is the self-hosted Postgres backend counterpart to SqliteLoopStorage. It
// speaks the exact same ~60-method surface as the local sqlite `Store`, but
// every method is async and every statement runs against a live `pg.Pool`
// through the generated @hasna/contracts storage kit (direct Postgres, no cache,
// no local mirror).
//
// Row shape parity with sqlite is achieved by three pg type-parser overrides
// registered at module load (see below): JSONB/JSON come back as raw text and
// timestamps come back as normalized ISO-8601 strings, so the shared
// `rowToX` mappers from `../store.js` map pg rows exactly as they map sqlite
// rows.
//
// Concurrency-critical run claiming (runner claim/heartbeat) uses
// `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction and is covered by
// the live two-connection claim race test in postgres-loop-storage.test.ts.
//
// Workflow-run, workflow-step, and goal lifecycle writes are implemented here
// instead of falling through to sqlite-only or preview-only stubs.

import pgLib from "pg";
import type {
  CreateGoalInput,
  CreateGoalPlanNodeInput,
  CreateWorkflowRunInput,
  DaemonLease,
  ExpiredRunLeaseCandidatePage,
  PruneHistorySummary,
  RecordGoalEventInput,
  RecoverExpiredRunLeasesResult,
  RecoveredLeaseRunPage,
  WorkflowRecoveryContext,
} from "../store.js";
import { Store } from "../store.js";
import {
  GATE_DEATH_CEILING,
  GENERATED_ROUTE_KEYS,
  LIVE_EXPIRED_RUN_GRACE_MS,
  MAX_LIVE_EXPIRED_RUN_DEFERRALS,
  classifyNonProductiveStepFailure,
  isGeneratedRouteTemplate,
  persistedJson,
  persistedRunOutput,
  persistedWorkflowEventPayload,
  rowToGoal,
  rowToGoalPlanNode,
  rowToGoalRun,
  rowToLease,
  rowToLoop,
  rowToLoopRevision,
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
  type LoopRevisionRow,
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
import {
  AmbiguousNameError,
  BundleNameTakenError,
  DuplicateWorkflowEventError,
  LegacyWorkflowRunProvenanceError,
  LoopArchivedError,
  LoopMutationConflictError,
  LoopNotFoundError,
  LoopVersionNotFoundError,
  RunFinalizationConflictError,
  ValidationError,
  WorkflowRunDefinitionConflictError,
  WorkflowRunNotRunningError,
  WorkflowRunStepOwnershipUnverifiableError,
} from "../errors.js";
import { genId, nowIso } from "../ids.js";
import { initialNextRun } from "../recurrence.js";
import { normalizeCreateWorkflowInput } from "../workflow-spec.js";
import { initialAgentSessionContractEvents, workflowDefinitionHash } from "../workflow-provenance.js";
import { assertGoalTransition, updateReadyFlags } from "../goal/status.js";
import { GOAL_TERMINAL, type GoalStatus } from "../goal/types.js";
import type {
  CreateLoopInput,
  CreateWorkflowInvocationInput,
  CreateWorkflowInput,
  GoalPlanNode,
  Loop,
  LoopRun,
  LoopStatus,
  LoopTarget,
  RecoveredLeaseRunSnapshotEntry,
  RunReceipt,
  UpsertWorkflowWorkItemInput,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSpec,
  WorkflowStepRun,
  WorkflowWorkItemStatus,
  WriteRunReceiptInput,
} from "../../types.js";
import { normalizeRunReceipt } from "../run-receipts.js";
import { normalizeLoopLabels } from "../labels.js";
import { assertExpiresAfterRuns, assertLeaseMs, assertLoopStatus, assertMaxAttempts } from "../loop-status.js";
import { normalizeRunCompletion } from "../run-completion.js";
import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";
import type { LoopStorageContract, LoopStorageMethodName } from "./contract.js";
import {
  DEFAULT_LOOP_MUTATION_LOOKUP_CAPS,
  isPrivateOperationEventType,
  loopMutationAdmissionReceipt,
  loopMutationTerminalReceipt,
  normalizeLoopMutationEnvelope,
  privateOperationEventsForWorkflowRun,
  type LoopMutationEnvelope,
  type LoopMutationLookupCaps,
  type LoopMutationResult,
  type OperationAuthorityBinding,
} from "../operation-contract.js";

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

const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "timed_out", "abandoned", "skipped"] as const;
const PRUNE_BATCH_SIZE = 400;

/**
 * Postgres SQLSTATE 23505 = unique_violation. A migration/backfill import keys
 * every row by its tenant-qualified primary id, but some tables carry a
 * SECONDARY unique constraint that a re-keyed row from another machine can trip:
 *   - workflow_specs: partial unique on (tenant_id, name) for active rows
 *   - loop_runs:      UNIQUE(tenant_id, loop_id, scheduled_for)
 * When a fleet-union backfill pushes a row whose id is new but whose secondary
 * key already exists (a different machine already owns that active-workflow name
 * or that loop schedule slot), the primary-key conflict target cannot catch it and
 * the whole batch would abort. The import treats that as "already represented"
 * and keeps the existing owner instead of failing the backfill.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

const DEFAULT_RECOVERY_BATCH_LIMIT = 100;
const DEFAULT_RECOVERY_SCAN_MULTIPLIER = 5;

/**
 * Serializes concurrent mutations of the same (tenant, operation, step) triple.
 * `hashtextextended` receives the tenant id, operation id and step id joined
 * with the unit separator (E'\x1f', 0x1F) — a single-byte, UTF-8-valid control
 * character that PostgreSQL accepts inside text values.
 *
 * O15-00692: the previous separator was `E'\000'` (an octal escape for NUL in a
 * Postgres E-string). PostgreSQL rejects NUL bytes in text ("invalid byte
 * sequence for encoding UTF8: 0x00"), so the very first statement of every
 * mutation transaction threw an unhandled Postgres error and
 * POST /v1/loops/<id>/mutations returned 500 for every loop. The separator must
 * stay NUL-free.
 */
export const LOOP_MUTATION_ADVISORY_LOCK_SQL = `SELECT pg_advisory_xact_lock(
  hashtextextended(open_loops_current_tenant_id() || E'\\x1f' || $1 || E'\\x1f' || $2, 0)
)`;


type M<K extends LoopStorageMethodName> = Store[K] extends (...a: infer A) => infer R
  ? { args: A; result: R }
  : never;

interface DaemonLeaseFence {
  daemonLeaseId?: string;
  now?: Date;
  claimToken?: string;
  recoveredRun?: RecoveredLeaseRunSnapshotEntry;
}

function matchesRecoveredLeaseSnapshot(row: RunRow | null | undefined, expected: RecoveredLeaseRunSnapshotEntry): boolean {
  return Boolean(
    row &&
    row.status === "abandoned" &&
    row.error === "run lease expired before completion" &&
    row.attempt === expected.attempt &&
    row.updated_at === expected.updatedAt &&
    row.scheduled_for === expected.scheduledFor
  );
}

export interface TenantStorageContext {
  tenantId: string;
  principalId: string;
  requestId: string;
}

function scopedClient(client: TypedQueryClient, pool: PoolQueryClient["pool"]): PoolQueryClient {
  return {
    ...client,
    pool,
    transaction: (fn) => fn(client),
    close: async () => {},
  };
}

function bindTenantClient(client: PoolQueryClient, context: TenantStorageContext): PoolQueryClient {
  const inContext = <T>(fn: (scoped: PoolQueryClient) => Promise<T>): Promise<T> =>
    client.transaction(async (transactionClient) => {
      await transactionClient.execute("SET LOCAL ROLE open_loops_runtime");
      await transactionClient.execute("SET LOCAL search_path = pg_catalog, public");
      await transactionClient.get(
        `SELECT
          set_config('open_loops.tenant_id', $1, true),
          set_config('open_loops.principal_id', $2, true),
          set_config('open_loops.request_id', $3, true)`,
        [context.tenantId, context.principalId, context.requestId],
      );
      return fn(scopedClient(transactionClient, client.pool));
    });
  return {
    pool: client.pool,
    query: (sql, params) => inContext((scoped) => scoped.query(sql, params)),
    many: (sql, params) => inContext((scoped) => scoped.many(sql, params)),
    get: (sql, params) => inContext((scoped) => scoped.get(sql, params)),
    one: (sql, params) => inContext((scoped) => scoped.one(sql, params)),
    execute: (sql, params) => inContext((scoped) => scoped.execute(sql, params)),
    transaction: (fn) => inContext((scoped) => fn(scoped)),
    close: () => client.close(),
  };
}

export class PostgresLoopStorage implements LoopStorageContract {
  readonly backend = "postgresql";
  readonly supportsRemoteRunners = true;

  readonly tenantId: string;
  readonly principalId: string;
  readonly requestId: string;
  private readonly client: PoolQueryClient;

  constructor(client: PoolQueryClient, context: TenantStorageContext, opts: { contextAlreadyBound?: boolean } = {}) {
    this.tenantId = context.tenantId.trim();
    this.principalId = context.principalId.trim();
    this.requestId = context.requestId.trim();
    if (!this.tenantId || !this.principalId || !this.requestId) {
      throw new Error("PostgresLoopStorage requires tenant, principal, and request ids");
    }
    this.client = opts.contextAlreadyBound ? client : bindTenantClient(client, {
      tenantId: this.tenantId,
      principalId: this.principalId,
      requestId: this.requestId,
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  // ---- internal helpers (accept a client so they compose inside transactions)

  private async assertDaemonLeaseFence(c: TypedQueryClient, opts: DaemonLeaseFence, now: string): Promise<void> {
    if (!opts.daemonLeaseId) return;
    const row = await c.get<{ id: string }>(
      "SELECT id FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id = $1 AND expires_at > $2",
      [opts.daemonLeaseId, now],
    );
    if (!row) throw new Error("daemon lease lost");
  }

  private async lockWorkflowRun(c: TypedQueryClient, workflowRunId: string): Promise<WorkflowRunRow> {
    const row = await c.get<WorkflowRunRow>(
      "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
      [workflowRunId],
    );
    if (!row) throw new Error(`workflow run not found: ${workflowRunId}`);
    return row;
  }

  private async loadLoop(c: TypedQueryClient, id: string): Promise<Loop | undefined> {
    const row = await c.get<LoopRow>("SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND id = $1", [id]);
    return row ? rowToLoop(row) : undefined;
  }

  private async loadRun(c: TypedQueryClient, id: string): Promise<LoopRun | undefined> {
    const row = await c.get<RunRow>("SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1", [id]);
    return row ? rowToRun(row) : undefined;
  }

  private async loadRunBySlot(c: TypedQueryClient, loopId: string, scheduledFor: string): Promise<LoopRun | undefined> {
    const row = await c.get<RunRow>(
      "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND loop_id = $1 AND scheduled_for = $2",
      [loopId, scheduledFor],
    );
    return row ? rowToRun(row) : undefined;
  }

  private async loadDaemonLease(c: TypedQueryClient): Promise<DaemonLease | undefined> {
    const row = await c.get<LeaseRow>("SELECT * FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() LIMIT 1", []);
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
       WHERE tenant_id = open_loops_current_tenant_id() AND loop_id = $4 AND status IN (${placeholders})`,
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
       WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id = $4 AND status IN (${placeholders})`,
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
    const workflowRun = loop?.target.type === "workflow" && status !== "admitted"
      ? await c.get<WorkflowRunRow>(
          `SELECT * FROM workflow_runs
           WHERE tenant_id = open_loops_current_tenant_id() AND loop_run_id=$1 AND workflow_id=$2
           ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [run.id, loop.target.workflowId],
        )
      : undefined;
    await this.setWorkItemsForLoop(c, run.loopId, status, nextReason, updated, statuses);
    if (loop?.target.type === "workflow" && status !== "admitted") {
      const workItemId = loop.target.input?.workflowWorkItemId ?? loop.target.input?.workItemId;
      await this.maybeArchiveGeneratedRouteWorkflow(c, {
        workflowId: loop.target.workflowId,
        loopId: loop.id,
        loopRunId: run.id,
        workItemId,
        workflowRunId: workflowRun?.id,
        updated,
      });
    }
  }

  private async maybeArchiveGeneratedRouteWorkflow(
    c: TypedQueryClient,
    args: {
      workflowId: string;
      loopId?: string;
      loopRunId?: string;
      workItemId?: string;
      workflowRunId?: string;
      workflowRunStatus?: WorkflowRunStatus;
      updated: string;
    },
  ): Promise<void> {
    if (!args.loopId || !args.workItemId) return;
    const workItemRow = await c.get<WorkflowWorkItemRow>(
      "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
      [args.workItemId],
    );
    if (!workItemRow || !GENERATED_ROUTE_KEYS.has(workItemRow.route_key)) return;
    const invocationRow = await c.get<WorkflowInvocationRow>(
      "SELECT * FROM workflow_invocations WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
      [workItemRow.invocation_id],
    );
    if (!invocationRow?.template_id || !isGeneratedRouteTemplate(workItemRow.route_key, invocationRow.template_id)) return;
    const loopRow = await c.get<LoopRow>(
      "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
      [args.loopId],
    );
    if (!loopRow) return;
    const loop = rowToLoop(loopRow);
    if (loop.schedule.type !== "once" || loop.target.type !== "workflow" || loop.target.workflowId !== args.workflowId) return;
    if (
      args.loopRunId
      && (args.workflowRunStatus === "failed" || args.workflowRunStatus === "timed_out")
    ) {
      const loopRunRow = await c.get<RunRow>(
        "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
        [args.loopRunId],
      );
      if (loopRunRow && loopRunRow.attempt < loop.maxAttempts) return;
    }
    const input = loop.target.input ?? {};
    if (input.workflowWorkItemId !== workItemRow.id || input.workflowInvocationId !== invocationRow.id) return;
    if (workItemRow.loop_id !== loop.id || workItemRow.workflow_id !== args.workflowId) return;
    const workflowRow = await c.get<WorkflowRow>(
      "SELECT * FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
      [args.workflowId],
    );
    if (!workflowRow || workflowRow.status !== "active") return;
    let workflowRunId = args.workflowRunId;
    if (!workflowRunId) {
      if (!args.loopRunId || workItemRow.workflow_run_id) return;
      const loopRunRow = await c.get<RunRow>(
        "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
        [args.loopRunId],
      );
      if (!loopRunRow || loopRunRow.status === "running") return;
      workflowRunId = `preflight-archive:${loopRunRow.id}`;
      await c.execute(
        `INSERT INTO workflow_runs (id, workflow_id, workflow_name, loop_id, loop_run_id, invocation_id, work_item_id,
          scheduled_for, idempotency_key, workflow_definition_hash, manifest_path, status, started_at, finished_at,
          duration_ms, error, created_at, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,NULL,'failed',NULL,$10,NULL,$11,$10,$10,open_loops_current_tenant_id())
         ON CONFLICT DO NOTHING`,
        [
          workflowRunId,
          args.workflowId,
          workflowRow.name,
          loop.id,
          loopRunRow.id,
          invocationRow.id,
          workItemRow.id,
          loopRunRow.scheduled_for,
          workflowDefinitionHash(rowToWorkflow(workflowRow)),
          args.updated,
          "workflow preflight failed before workflow execution; synthetic archival event owner",
        ],
      );
      const archivalOwner = await c.get<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
        [workflowRunId],
      );
      if (
        !archivalOwner
        || archivalOwner.workflow_id !== args.workflowId
        || archivalOwner.loop_id !== loop.id
        || archivalOwner.loop_run_id !== loopRunRow.id
        || archivalOwner.invocation_id !== invocationRow.id
        || archivalOwner.work_item_id !== workItemRow.id
        || archivalOwner.status !== "failed"
        || archivalOwner.started_at !== null
        || archivalOwner.duration_ms !== null
      ) return;
      await c.execute(
        `UPDATE workflow_work_items SET workflow_run_id=$2, updated_at=$3
         WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND workflow_run_id IS NULL`,
        [workItemRow.id, workflowRunId, args.updated],
      );
    }
    const nonTerminal = await c.get<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM workflow_runs
       WHERE tenant_id = open_loops_current_tenant_id() AND workflow_id=$1
         AND status NOT IN ('succeeded','failed','timed_out','cancelled')`,
      [args.workflowId],
    );
    if ((nonTerminal?.count ?? 0) > 0) return;
    const archived = await c.query(
      `UPDATE workflow_specs SET status='archived', updated_at=$2
       WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='active'`,
      [args.workflowId, args.updated],
    );
    if (archived.rowCount === 1) {
      await this.appendWorkflowEventWithClient(c, workflowRunId, "workflow_archived", undefined, {
        workflowId: args.workflowId,
        loopId: loop.id,
        workItemId: workItemRow.id,
        routeKey: workItemRow.route_key,
        reason: "terminal generated one-shot route workflow",
      });
    }
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
      labels: normalizeLoopLabels(input.labels),
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
      expiresAfterRuns: input.expiresAfterRuns,
      createdAt: now,
      updatedAt: now,
    };
    await this.client.execute(
      `INSERT INTO loops (id, name, description, labels_json, status, schedule_json, target_json, machine_json, next_run_at, retry_scheduled_for,
        goal_json, catch_up, catch_up_limit, overlap, max_attempts, retry_delay_ms, lease_ms, expires_at, expires_after_runs, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,NULL,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,open_loops_current_tenant_id())`,
      [
        loop.id,
        loop.name,
        loop.description ?? null,
        JSON.stringify(loop.labels),
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
        loop.expiresAfterRuns ?? null,
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
      "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 ORDER BY created_at DESC LIMIT 1",
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

  async requireUniqueLoop(...args: M<"requireUniqueLoop">["args"]): Promise<M<"requireUniqueLoop">["result"]> {
    return this.requireUniqueLoopIn(this.client, args[0]);
  }

  async listLoops(...args: M<"listLoops">["args"]): Promise<M<"listLoops">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 200;
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    // Exact-name lookup short-circuits every other filter: returns *all* loops
    // (archived included) matching the name so callers can detect ambiguity.
    if (opts.name != null) {
      const rows = await this.client.many<LoopRow>(
        "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3",
        [opts.name, limit, offset],
      );
      return rows.map(rowToLoop);
    }
    const labels = normalizeLoopLabels(opts.labels);
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const filters: string[] = [];
    if (opts.status) filters.push(`status = ${bind(opts.status)}`);
    if (opts.archived) filters.push("archived_at IS NOT NULL");
    else if (!opts.includeArchived) filters.push("archived_at IS NULL");
    for (const label of labels) filters.push(`labels_json @> ${bind(JSON.stringify([label]))}::jsonb`);
    const order = opts.archived
      ? "archived_at DESC, id DESC"
      : "status ASC, next_run_at ASC, id ASC";
    const limitParam = bind(limit);
    const offsetParam = bind(offset);
    const rows = await this.client.many<LoopRow>(
      `SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id()${filters.length ? ` AND ${filters.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );
    return rows.map(rowToLoop);
  }

  async dueLoops(...args: M<"dueLoops">["args"]): Promise<M<"dueLoops">["result"]> {
    const [now, limit = 500] = args as [Date, number?];
    const rows = await this.client.many<LoopRow>(
      `SELECT * FROM loops
       WHERE tenant_id = open_loops_current_tenant_id() AND status = 'active' AND archived_at IS NULL AND next_run_at IS NOT NULL AND next_run_at <= $1
       ORDER BY next_run_at ASC LIMIT $2`,
      [now.toISOString(), limit],
    );
    return rows.map(rowToLoop);
  }

  async updateLoop(...args: M<"updateLoop">["args"]): Promise<M<"updateLoop">["result"]> {
    const [id, patch, opts = {}] = args;
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    if ("maxAttempts" in patch && patch.maxAttempts !== undefined) assertMaxAttempts(patch.maxAttempts);
    if ("expiresAfterRuns" in patch && patch.expiresAfterRuns !== undefined) assertExpiresAfterRuns(patch.expiresAfterRuns);
    if ("leaseMs" in patch && patch.leaseMs !== undefined) assertLeaseMs(patch.leaseMs);
    const updated = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      const current = await this.loadLoop(c, id);
      if (!current) throw new LoopNotFoundError(id);
      if (current.archivedAt) throw new LoopArchivedError(current.name || id);
      const merged: Loop = {
        ...current,
        ...patch,
        labels: patch.labels !== undefined ? normalizeLoopLabels(patch.labels) : current.labels,
        updatedAt: updated,
      };
      const res = await c.query(
        `UPDATE loops SET status=$1, labels_json=$2::jsonb, next_run_at=$3, retry_scheduled_for=$4, expires_at=$5, expires_after_runs=$6, max_attempts=$7, lease_ms=$8, updated_at=$9
         WHERE tenant_id = open_loops_current_tenant_id() AND id=$10
           AND ($11::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$11 AND expires_at > $12))`,
        [
          merged.status,
          JSON.stringify(merged.labels),
          merged.nextRunAt ?? null,
          merged.retryScheduledFor ?? null,
          merged.expiresAt ?? null,
          merged.expiresAfterRuns ?? null,
          merged.maxAttempts,
          merged.leaseMs,
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

  async mutateLoop(
    envelope: LoopMutationEnvelope,
    authority: OperationAuthorityBinding,
    opts: { now?: Date; leaseMs?: number } = {},
  ): Promise<LoopMutationResult> {
    if (authority.tenantId !== this.tenantId) {
      throw new LoopMutationConflictError("binding_mismatch", envelope.targetId);
    }
    const binding = normalizeLoopMutationEnvelope(envelope, {
      authorityId: authority.authorityId,
      tenantId: this.tenantId,
    });
    const now = opts.now ?? new Date();
    const createdAt = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + (opts.leaseMs ?? 30_000)).toISOString();
    return this.client.transaction(async (c) => {
      await c.query(LOOP_MUTATION_ADVISORY_LOCK_SQL, [binding.operationId, binding.stepId]);
      const existing = await c.get<{
        binding_digest: string;
        binding_json: string;
        admission_json: string;
        terminal_json: string;
        result_json: string;
      }>(
        `SELECT binding_digest, binding_json, admission_json, terminal_json, result_json
         FROM loop_mutation_operations
         WHERE tenant_id = open_loops_current_tenant_id() AND operation_id=$1 AND step_id=$2`,
        [binding.operationId, binding.stepId],
      );
      if (existing) {
        if (existing.binding_digest !== binding.bindingDigest) {
          throw new LoopMutationConflictError("binding_mismatch", binding.targetId);
        }
        return {
          binding: JSON.parse(existing.binding_json),
          admission: JSON.parse(existing.admission_json),
          terminal: JSON.parse(existing.terminal_json),
          loop: JSON.parse(existing.result_json),
          replayed: true,
        } as LoopMutationResult;
      }

      const currentRow = await c.get<LoopRow>(
        `SELECT * FROM loops
         WHERE tenant_id = open_loops_current_tenant_id() AND id=$1
         FOR UPDATE`,
        [binding.targetId],
      );
      if (!currentRow) throw new LoopNotFoundError(binding.targetId);
      const current = rowToLoop(currentRow);
      if (current.archivedAt) throw new LoopArchivedError(current.name || current.id);
      if (current.updatedAt !== binding.expectedRevision) {
        throw new LoopMutationConflictError("revision_mismatch", binding.targetId);
      }

      await c.execute(
        `DELETE FROM loop_mutation_leases
         WHERE tenant_id = open_loops_current_tenant_id() AND target_id=$1 AND expires_at <= $2`,
        [binding.targetId, createdAt],
      );
      try {
        await c.execute(
          `INSERT INTO loop_mutation_leases
           (tenant_id,target_id,lease_id,operation_id,step_id,expires_at,created_at)
           VALUES (open_loops_current_tenant_id(),$1,$2,$3,$4,$5,$6)`,
          [
            binding.targetId,
            binding.leaseId,
            binding.operationId,
            binding.stepId,
            leaseExpiresAt,
            createdAt,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new LoopMutationConflictError("lease_conflict", binding.targetId);
        throw error;
      }

      let result = current;
      if (!binding.dryRun) {
        const status: LoopStatus = binding.action === "pause"
          ? "paused"
          : binding.action === "stop"
            ? "stopped"
            : "active";
        const nextRunAt = binding.action === "stop"
          ? undefined
          : binding.action === "resume" && !current.nextRunAt
            ? initialNextRun(current.schedule, now)
            : current.nextRunAt;
        const updatedAt = new Date(Math.max(now.getTime(), Date.parse(current.updatedAt) + 1)).toISOString();
        const update = await c.query(
          `UPDATE loops SET status=$1, next_run_at=$2, updated_at=$3
           WHERE tenant_id = open_loops_current_tenant_id() AND id=$4 AND updated_at=$5 AND archived_at IS NULL`,
          [status, nextRunAt ?? null, updatedAt, current.id, binding.expectedRevision],
        );
        if (update.rowCount !== 1) throw new LoopMutationConflictError("revision_mismatch", binding.targetId);
        if (status !== "active") {
          await this.setWorkItemsForLoop(
            c,
            current.id,
            status === "paused" ? "deferred" : "cancelled",
            `loop ${status}`,
            updatedAt,
          );
        }
        result = { ...current, status, nextRunAt, updatedAt };
      }
      const admission = loopMutationAdmissionReceipt(binding, createdAt);
      const terminal = loopMutationTerminalReceipt(binding, result, createdAt);
      await c.execute(
        `INSERT INTO loop_mutation_operations
         (tenant_id,operation_id,step_id,target_id,binding_digest,binding_json,admission_json,terminal_json,result_json,created_at)
         VALUES (open_loops_current_tenant_id(),$1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
        [
          binding.operationId,
          binding.stepId,
          binding.targetId,
          binding.bindingDigest,
          JSON.stringify(binding),
          JSON.stringify(admission),
          JSON.stringify(terminal),
          JSON.stringify(result),
          createdAt,
        ],
      );
      await c.execute(
        `DELETE FROM loop_mutation_leases
         WHERE tenant_id = open_loops_current_tenant_id() AND target_id=$1 AND lease_id=$2`,
        [binding.targetId, binding.leaseId],
      );
      return { binding, admission, terminal, loop: result, replayed: false };
    });
  }

  async getLoopMutationResult(
    authority: OperationAuthorityBinding,
    operationId: string,
    stepId: string,
    caps: LoopMutationLookupCaps = DEFAULT_LOOP_MUTATION_LOOKUP_CAPS,
  ): Promise<LoopMutationResult | undefined> {
    if (authority.tenantId !== this.tenantId) return undefined;
    const startedAt = Date.now();
    if (!Number.isInteger(caps.maxCalls) || caps.maxCalls < 1) throw new ValidationError("loop mutation lookup call cap exceeded");
    if (!Number.isInteger(caps.maxRecords) || caps.maxRecords < 1) throw new ValidationError("loop mutation lookup record cap exceeded");
    if (!Number.isInteger(caps.maxBytes) || caps.maxBytes < 1) throw new ValidationError("loop mutation lookup byte cap exceeded");
    if (!Number.isInteger(caps.maxWallMs) || caps.maxWallMs < 1) throw new ValidationError("loop mutation lookup wall-time cap exceeded");
    const rows = await this.client.many<{
      binding_digest: string;
      binding_json: string;
      admission_json: string;
      terminal_json: string;
      result_json: string;
    }>(
      `SELECT binding_digest, binding_json, admission_json, terminal_json, result_json
       FROM loop_mutation_operations
       WHERE tenant_id = open_loops_current_tenant_id() AND operation_id=$1 AND step_id=$2
       LIMIT 2`,
      [operationId, stepId],
    );
    if (rows.length > caps.maxRecords) throw new ValidationError("loop mutation lookup record cap exceeded");
    if (Date.now() - startedAt > caps.maxWallMs) throw new ValidationError("loop mutation lookup wall-time cap exceeded");
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw new ValidationError("duplicate loop mutation result");
    const row = rows[0]!;
    const bytes = Buffer.byteLength(row.binding_json) + Buffer.byteLength(row.admission_json) +
      Buffer.byteLength(row.terminal_json) + Buffer.byteLength(row.result_json);
    if (bytes > caps.maxBytes) throw new ValidationError("loop mutation lookup byte cap exceeded");
    const binding = JSON.parse(row.binding_json);
    const admission = JSON.parse(row.admission_json);
    const terminal = JSON.parse(row.terminal_json);
    if (
      binding.bindingDigest !== row.binding_digest ||
      admission.bindingDigest !== row.binding_digest ||
      terminal.bindingDigest !== row.binding_digest
    ) {
      throw new LoopMutationConflictError("binding_mismatch", admission.targetId);
    }
    return {
      binding,
      admission,
      terminal,
      loop: JSON.parse(row.result_json),
      replayed: true,
    };
  }

  async advanceLoopIfCurrent(...args: M<"advanceLoopIfCurrent">["args"]): Promise<M<"advanceLoopIfCurrent">["result"]> {
    const [id, expected, patch, opts = {}] = args;
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    const updated = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      if (opts.recoveredRun) {
        const recovered = await c.get<RunRow>(
          "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
          [opts.recoveredRun.id],
        );
        if (!matchesRecoveredLeaseSnapshot(recovered, opts.recoveredRun)) return undefined;
      }
      const current = await this.loadLoop(c, id);
      if (!current || current.archivedAt) return undefined;
      const merged: Loop = { ...current, ...patch, updatedAt: updated };
      const res = await c.query(
        `UPDATE loops SET status=$1, next_run_at=$2, retry_scheduled_for=$3, updated_at=$4
         WHERE tenant_id = open_loops_current_tenant_id() AND id=$5
           AND archived_at IS NULL
           AND status=$6
           AND next_run_at IS NOT DISTINCT FROM $7::timestamptz
           AND retry_scheduled_for IS NOT DISTINCT FROM $8::timestamptz
           AND ($9::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease
             WHERE tenant_id = open_loops_current_tenant_id() AND id=$9 AND expires_at > $10
           ))`,
        [
          merged.status,
          merged.nextRunAt ?? null,
          merged.retryScheduledFor ?? null,
          updated,
          id,
          expected.status,
          expected.nextRunAt ?? null,
          expected.retryScheduledFor ?? null,
          opts.daemonLeaseId ?? null,
          updated,
        ],
      );
      if (res.rowCount !== 1) return undefined;
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        await this.setWorkItemsForLoop(c, id, status, `loop ${patch.status}`, updated);
      }
      return this.loadLoop(c, id);
    });
  }

  async tripCircuitBreakerIfCurrent(...args: M<"tripCircuitBreakerIfCurrent">["args"]): Promise<M<"tripCircuitBreakerIfCurrent">["result"]> {
    const [id, expected, patch, marker, opts = {}] = args;
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    const updated = (opts.now ?? new Date()).toISOString();
    const scrubbedReason = scrubbedOrNull(marker.reason) ?? "";
    return this.client.transaction(async (c) => {
      if (opts.recoveredRun) {
        const recovered = await c.get<RunRow>(
          "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
          [opts.recoveredRun.id],
        );
        if (!matchesRecoveredLeaseSnapshot(recovered, opts.recoveredRun)) return undefined;
      }
      const currentRow = await c.get<LoopRow>(
        "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
        [id],
      );
      const current = currentRow ? rowToLoop(currentRow) : undefined;
      if (
        !current ||
        current.archivedAt ||
        current.status !== expected.status ||
        current.nextRunAt !== expected.nextRunAt ||
        current.retryScheduledFor !== expected.retryScheduledFor
      ) {
        return undefined;
      }
      const merged: Loop = { ...current, ...patch, updatedAt: updated };
      const res = await c.query(
        `UPDATE loops SET status=$1, next_run_at=$2, retry_scheduled_for=$3, updated_at=$4
         WHERE tenant_id = open_loops_current_tenant_id() AND id=$5
           AND archived_at IS NULL
           AND status=$6
           AND next_run_at IS NOT DISTINCT FROM $7::timestamptz
           AND retry_scheduled_for IS NOT DISTINCT FROM $8::timestamptz
           AND ($9::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease
             WHERE tenant_id = open_loops_current_tenant_id() AND id=$9 AND expires_at > $10
           ))`,
        [
          merged.status,
          merged.nextRunAt ?? null,
          merged.retryScheduledFor ?? null,
          updated,
          id,
          expected.status,
          expected.nextRunAt ?? null,
          expected.retryScheduledFor ?? null,
          opts.daemonLeaseId ?? null,
          updated,
        ],
      );
      if (res.rowCount !== 1) return undefined;

      let markerAtMs = new Date(marker.scheduledFor).getTime();
      let markerRun: LoopRun | undefined;
      for (let probe = 0; probe < 1_000 && !markerRun; probe += 1) {
        const scheduledFor = new Date(markerAtMs).toISOString();
        const markerId = genId();
        const inserted = await c.get<{ id: string }>(
          `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at, tenant_id)
           VALUES ($1,$2,$3,$4,1,'skipped',NULL,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$5,$5,open_loops_current_tenant_id())
           ON CONFLICT (tenant_id, loop_id, scheduled_for) DO NOTHING
           RETURNING id`,
          [markerId, current.id, current.name, scheduledFor, updated, scrubbedReason],
        );
        if (inserted) markerRun = await this.loadRun(c, inserted.id);
        markerAtMs += 1;
      }
      if (!markerRun) throw new Error(`circuit breaker marker slot unavailable: ${id}`);
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        await this.setWorkItemsForLoop(c, id, status, `loop ${patch.status}`, updated);
      }
      const loop = await this.loadLoop(c, id);
      if (!loop) throw new Error(`circuit breaker loop missing after update: ${id}`);
      return { loop, marker: markerRun };
    });
  }

  async expireLoopIfCurrent(...args: M<"expireLoopIfCurrent">["args"]): Promise<M<"expireLoopIfCurrent">["result"]> {
    const [id, expected, patch, marker, opts = {}] = args;
    if ("status" in patch && patch.status !== undefined) assertLoopStatus(patch.status);
    const updated = (opts.now ?? new Date()).toISOString();
    const scrubbedReason = scrubbedOrNull(marker.reason) ?? "";
    return this.client.transaction(async (c) => {
      const currentRow = await c.get<LoopRow>(
        "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
        [id],
      );
      const current = currentRow ? rowToLoop(currentRow) : undefined;
      if (
        !current ||
        current.archivedAt ||
        current.status !== expected.status ||
        current.nextRunAt !== expected.nextRunAt ||
        current.retryScheduledFor !== expected.retryScheduledFor
      ) {
        return undefined;
      }
      const merged: Loop = { ...current, ...patch, updatedAt: updated };
      const res = await c.query(
        `UPDATE loops SET status=$1, next_run_at=$2, retry_scheduled_for=$3, updated_at=$4
         WHERE tenant_id = open_loops_current_tenant_id() AND id=$5
           AND archived_at IS NULL
           AND status=$6
           AND next_run_at IS NOT DISTINCT FROM $7::timestamptz
           AND retry_scheduled_for IS NOT DISTINCT FROM $8::timestamptz
           AND ($9::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease
             WHERE tenant_id = open_loops_current_tenant_id() AND id=$9 AND expires_at > $10
           ))`,
        [
          merged.status,
          merged.nextRunAt ?? null,
          merged.retryScheduledFor ?? null,
          updated,
          id,
          expected.status,
          expected.nextRunAt ?? null,
          expected.retryScheduledFor ?? null,
          opts.daemonLeaseId ?? null,
          updated,
        ],
      );
      if (res.rowCount !== 1) return undefined;

      let markerAtMs = new Date(marker.scheduledFor).getTime();
      let markerRun: LoopRun | undefined;
      for (let probe = 0; probe < 1_000 && !markerRun; probe += 1) {
        const scheduledFor = new Date(markerAtMs).toISOString();
        const markerId = genId();
        const inserted = await c.get<{ id: string }>(
          `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at, tenant_id)
           VALUES ($1,$2,$3,$4,1,'skipped',NULL,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$5,$5,open_loops_current_tenant_id())
           ON CONFLICT (tenant_id, loop_id, scheduled_for) DO NOTHING
           RETURNING id`,
          [markerId, current.id, current.name, scheduledFor, updated, scrubbedReason],
        );
        if (inserted) markerRun = await this.loadRun(c, inserted.id);
        markerAtMs += 1;
      }
      if (!markerRun) throw new Error(`expiry marker slot unavailable: ${id}`);
      if (patch.status && patch.status !== "active") {
        const status: WorkflowWorkItemStatus = patch.status === "paused" ? "deferred" : "cancelled";
        await this.setWorkItemsForLoop(c, id, status, `loop ${patch.status}`, updated);
      }
      const loop = await this.loadLoop(c, id);
      if (!loop) throw new Error(`expiry loop missing after update: ${id}`);
      return { loop, marker: markerRun };
    });
  }

  // ── loop bundles / revisions (hasna/apps#1724) ────────────────────────────

  async setLoopBundleName(...args: M<"setLoopBundleName">["args"]): Promise<M<"setLoopBundleName">["result"]> {
    const [loopId, bundleName, opts = {}] = args;
    const updated = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      const loop = await this.loadLoop(c, loopId);
      if (!loop) throw new LoopNotFoundError(loopId);
      if (loop.archivedAt) throw new LoopArchivedError(loop.name || loopId);
      // The unique partial index enforces this too; checking first turns the
      // 23505 into a coded conflict the API can map to 409 instead of a 500.
      const holder = await c.get<{ id: string }>(
        "SELECT id FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND bundle_name = $1",
        [bundleName],
      );
      if (holder && holder.id !== loopId) throw new BundleNameTakenError(bundleName, holder.id);
      await c.execute(
        "UPDATE loops SET bundle_name=$1, updated_at=$2 WHERE tenant_id = open_loops_current_tenant_id() AND id=$3",
        [bundleName, updated, loopId],
      );
      const after = await this.loadLoop(c, loopId);
      if (!after) throw new Error(`loop not found after bundle-name claim: ${loopId}`);
      return after;
    });
  }

  async setLoopBundlePin(...args: M<"setLoopBundlePin">["args"]): Promise<M<"setLoopBundlePin">["result"]> {
    const [loopId, version, opts = {}] = args;
    const updated = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      const loop = await this.loadLoop(c, loopId);
      if (!loop) throw new LoopNotFoundError(loopId);
      if (version !== null) {
        const revision = await c.get<{ version: number }>(
          "SELECT version FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 AND version=$2",
          [loopId, version],
        );
        if (!revision) throw new LoopVersionNotFoundError(loopId, version);
      }
      await c.execute(
        "UPDATE loops SET bundle_pinned_version=$1, updated_at=$2 WHERE tenant_id = open_loops_current_tenant_id() AND id=$3",
        [version, updated, loopId],
      );
      const after = await this.loadLoop(c, loopId);
      if (!after) throw new Error(`loop not found after pin: ${loopId}`);
      return after;
    });
  }

  async findLoopByBundleName(...args: M<"findLoopByBundleName">["args"]): Promise<M<"findLoopByBundleName">["result"]> {
    const [bundleName] = args;
    const row = await this.client.get<LoopRow>(
      "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND bundle_name = $1",
      [bundleName],
    );
    return row ? rowToLoop(row) : undefined;
  }

  async createLoopRevision(...args: M<"createLoopRevision">["args"]): Promise<M<"createLoopRevision">["result"]> {
    const [input, opts = {}] = args;
    const createdAt = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      // FOR UPDATE on the loop row serialises version allocation for this loop:
      // two concurrent pushes queue here, get N and N+1, and neither can
      // overwrite the other's object because the key carries the version.
      const locked = await c.get<LoopRow>(
        "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND id = $1 FOR UPDATE",
        [input.loopId],
      );
      if (!locked) throw new LoopNotFoundError(input.loopId);
      const loop = rowToLoop(locked);
      if (loop.archivedAt) throw new LoopArchivedError(loop.name || input.loopId);
      const head = await c.get<{ version: number | null }>(
        "SELECT MAX(version) AS version FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id = $1",
        [input.loopId],
      );
      const version = Number(head?.version ?? 0) + 1;
      await c.execute(
        `INSERT INTO loop_revisions (tenant_id, loop_id, version, bundle_name, bundle_digest, archive_sha256, archive_bytes,
           storage_kind, storage_key, manifest_json, loop_json, carries_prompt, author, source_station, source_agent,
           reason, rolled_back_from, created_at)
         VALUES (open_loops_current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17)`,
        [
          input.loopId,
          version,
          input.bundleName,
          input.bundleDigest,
          input.archiveSha256,
          input.archiveBytes,
          input.storageKind,
          input.storageKeyFor?.(version) ?? input.storageKey ?? null,
          JSON.stringify(input.manifest ?? {}),
          JSON.stringify(input.loopJson),
          input.carriesPrompt,
          input.author,
          input.sourceStation ?? null,
          input.sourceAgent ?? null,
          input.reason ?? null,
          input.rolledBackFrom ?? null,
          createdAt,
        ],
      );
      await c.execute(
        "UPDATE loops SET bundle_name=$1, updated_at=$2 WHERE tenant_id = open_loops_current_tenant_id() AND id=$3",
        [input.bundleName, createdAt, input.loopId],
      );
      const row = await c.get<LoopRevisionRow>(
        "SELECT * FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 AND version=$2",
        [input.loopId, version],
      );
      if (!row) throw new Error(`loop revision missing after insert: ${input.loopId}@${version}`);
      return rowToLoopRevision(row);
    });
  }

  async getLoopRevision(...args: M<"getLoopRevision">["args"]): Promise<M<"getLoopRevision">["result"]> {
    const [loopId, version] = args;
    const row = await this.client.get<LoopRevisionRow>(
      "SELECT * FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 AND version=$2",
      [loopId, version],
    );
    return row ? rowToLoopRevision(row) : undefined;
  }

  async latestLoopRevision(...args: M<"latestLoopRevision">["args"]): Promise<M<"latestLoopRevision">["result"]> {
    const [loopId] = args;
    const row = await this.client.get<LoopRevisionRow>(
      "SELECT * FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 ORDER BY version DESC LIMIT 1",
      [loopId],
    );
    return row ? rowToLoopRevision(row) : undefined;
  }

  async findLoopRevisionByDigest(...args: M<"findLoopRevisionByDigest">["args"]): Promise<M<"findLoopRevisionByDigest">["result"]> {
    const [loopId, bundleDigest] = args;
    const row = await this.client.get<LoopRevisionRow>(
      "SELECT * FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 AND bundle_digest=$2 ORDER BY version DESC LIMIT 1",
      [loopId, bundleDigest],
    );
    return row ? rowToLoopRevision(row) : undefined;
  }

  async listLoopRevisions(...args: M<"listLoopRevisions">["args"]): Promise<M<"listLoopRevisions">["result"]> {
    const [loopId, opts = {}] = args;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await this.client.many<LoopRevisionRow>(
      "SELECT * FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 ORDER BY version DESC LIMIT $2 OFFSET $3",
      [loopId, limit, offset],
    );
    const total = await this.client.get<{ total: string | number }>(
      "SELECT COUNT(*) AS total FROM loop_revisions WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1",
      [loopId],
    );
    return { revisions: rows.map(rowToLoopRevision), total: Number(total?.total ?? 0) };
  }

  async listLoopBundles(...args: M<"listLoopBundles">["args"]): Promise<M<"listLoopBundles">["result"]> {
    const [opts = {}] = args;
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    // The head revision per bundle comes from a lateral join rather than N+1
    // round trips: `sync --for-machine` on a busy runner asks for the whole
    // index at once.
    const rows = await this.client.many<{
      bundle_name: string;
      loop_id: string;
      loop_name: string;
      bundle_pinned_version: number | null;
      machine_json: string | null;
      loop_updated_at: string;
      version: number | null;
      bundle_digest: string | null;
      carries_prompt: boolean | null;
      created_at: string | null;
    }>(
      `SELECT l.bundle_name, l.id AS loop_id, l.name AS loop_name, l.bundle_pinned_version,
              l.machine_json, l.updated_at AS loop_updated_at,
              head.version, head.bundle_digest, head.carries_prompt, head.created_at
         FROM loops l
         LEFT JOIN LATERAL (
           SELECT version, bundle_digest, carries_prompt, created_at
             FROM loop_revisions r
            WHERE r.tenant_id = open_loops_current_tenant_id() AND r.loop_id = l.id
            ORDER BY r.version DESC LIMIT 1
         ) head ON TRUE
        WHERE l.tenant_id = open_loops_current_tenant_id()
          AND l.bundle_name IS NOT NULL
          AND ($1::text IS NULL OR l.machine_json->>'id' = $1)
        ORDER BY l.bundle_name ASC
        LIMIT $2 OFFSET $3`,
      [opts.machine ?? null, limit, offset],
    );
    const total = await this.client.get<{ total: string | number }>(
      `SELECT COUNT(*) AS total FROM loops
        WHERE tenant_id = open_loops_current_tenant_id() AND bundle_name IS NOT NULL
          AND ($1::text IS NULL OR machine_json->>'id' = $1)`,
      [opts.machine ?? null],
    );
    return {
      bundles: rows.map((row) => {
        const machine = row.machine_json ? (JSON.parse(row.machine_json) as { id?: string }) : undefined;
        return {
          bundleName: row.bundle_name,
          loopId: row.loop_id,
          loopName: row.loop_name,
          latestVersion: row.version ?? 0,
          ...(row.bundle_pinned_version === null ? {} : { pinnedVersion: row.bundle_pinned_version }),
          ...(row.bundle_digest === null ? {} : { bundleDigest: row.bundle_digest }),
          carriesPrompt: row.carries_prompt === true,
          ...(machine?.id === undefined ? {} : { machineId: machine.id }),
          updatedAt: row.created_at ?? row.loop_updated_at,
        };
      }),
      total: Number(total?.total ?? 0),
    };
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
       WHERE tenant_id = open_loops_current_tenant_id() AND id=$3 AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$4 AND expires_at > $5))`,
      [trimmed, updated, id, opts.daemonLeaseId ?? null, updated],
    );
    const after = await this.getLoop(id);
    if (!after) throw new Error(`loop not found after rename: ${id}`);
    return after;
  }

  async archiveLoop(...args: M<"archiveLoop">["args"]): Promise<M<"archiveLoop">["result"]> {
    const idOrName = args[0];
    return this.client.transaction(async (c) => {
      const loop = await this.requireArchiveMutationLoopIn(c, idOrName, "archive");
      if (loop.archivedAt) return loop;
      const updated = nowIso();
      const archivedStatus: LoopStatus = loop.status === "active" ? "paused" : loop.status;
      await c.execute(
        `UPDATE loops SET status=$1, archived_at=$2, archived_from_status=$3, updated_at=$4 WHERE tenant_id = open_loops_current_tenant_id() AND id=$5`,
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
    return this.client.transaction(async (c) => {
      const loop = await this.requireArchiveMutationLoopIn(c, idOrName, "unarchive");
      if (!loop.archivedAt) return loop;
      const updated = nowIso();
      const restoredStatus = loop.archivedFromStatus ?? loop.status;
      await c.execute(
        `UPDATE loops SET status=$1, archived_at=NULL, archived_from_status=NULL, updated_at=$2 WHERE tenant_id = open_loops_current_tenant_id() AND id=$3`,
        [restoredStatus, updated, loop.id],
      );
      const unarchived = await this.loadLoop(c, loop.id);
      if (!unarchived) throw new Error(`loop not found after unarchive: ${loop.id}`);
      return unarchived;
    });
  }

  async deleteLoop(...args: M<"deleteLoop">["args"]): Promise<M<"deleteLoop">["result"]> {
    const idOrName = args[0];
    return this.client.transaction(async (c) => {
      const loop = await this.requireLoopIn(c, idOrName);
      await this.setWorkItemsForLoop(c, loop.id, "cancelled", "loop deleted", nowIso());
      // O15-00624: run_receipts (tenant_id, loop_id) REFERENCES loops carries no
      // ON DELETE action, so a loop that produced terminal receipts cannot be
      // deleted — the FK violation aborts the transaction and DELETE
      // /loops/<id> returns 500 on the hosted control plane. Delete the loop's
      // receipts explicitly (like the sqlite store deletes loop_runs children);
      // the 0015_run_receipts_loop_cascade migration then aligns the schema
      // with this behavior for fresh installs.
      await c.execute(
        `DELETE FROM run_receipts WHERE tenant_id = open_loops_current_tenant_id() AND loop_id = $1`,
        [loop.id],
      );
      // loop_runs.loop_id REFERENCES loops ON DELETE CASCADE handles children.
      const res = await c.query(`DELETE FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND id = $1`, [loop.id]);
      return res.rowCount > 0;
    });
  }

  private async requireLoopIn(c: TypedQueryClient, idOrName: string): Promise<Loop> {
    const byId = await this.loadLoop(c, idOrName);
    if (byId) return byId;
    const row = await c.get<LoopRow>(
      "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 ORDER BY created_at DESC LIMIT 1",
      [idOrName],
    );
    if (!row) throw new LoopNotFoundError(idOrName);
    return rowToLoop(row);
  }

  private async requireUniqueLoopIn(c: TypedQueryClient, idOrName: string): Promise<Loop> {
    const byId = await this.loadLoop(c, idOrName);
    if (byId) return byId;
    const rows = await c.many<LoopRow>(
      "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 ORDER BY created_at DESC LIMIT 2",
      [idOrName],
    );
    if (rows.length === 0) throw new LoopNotFoundError(idOrName);
    if (rows.length === 1) return rowToLoop(rows[0]!);
    const active = await c.many<LoopRow>(
      "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 2",
      [idOrName],
    );
    if (active.length !== 1) throw new AmbiguousNameError(idOrName);
    return rowToLoop(active[0]!);
  }

  private async requireArchiveMutationLoopIn(
    c: TypedQueryClient,
    idOrName: string,
    operation: "archive" | "unarchive",
  ): Promise<Loop> {
    const byId = await this.loadLoop(c, idOrName);
    if (byId) return byId;

    // Name resolution and mutation must form one serializable critical section.
    // SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE lock taken by
    // concurrent INSERT/UPDATE writers, so create/rename cannot commit a new
    // namesake between this lookup and the archive-state update. Exact-id paths
    // intentionally avoid this rare-operation table lock.
    await c.execute("LOCK TABLE loops IN SHARE ROW EXCLUSIVE MODE");
    const exactAfterLock = await this.loadLoop(c, idOrName);
    if (exactAfterLock) return exactAfterLock;

    const eligibleWhere = operation === "archive" ? "archived_at IS NULL" : "archived_at IS NOT NULL";
    const eligible = await c.many<LoopRow>(
      `SELECT * FROM loops
       WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 AND ${eligibleWhere}
       ORDER BY created_at DESC LIMIT 2`,
      [idOrName],
    );
    if (eligible.length > 1) throw new AmbiguousNameError(idOrName);
    if (eligible.length === 1) return rowToLoop(eligible[0]!);

    const alreadyWhere = operation === "archive" ? "archived_at IS NOT NULL" : "archived_at IS NULL";
    const already = await c.many<LoopRow>(
      `SELECT * FROM loops
       WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 AND ${alreadyWhere}
       ORDER BY created_at DESC LIMIT 2`,
      [idOrName],
    );
    if (already.length === 0) throw new LoopNotFoundError(idOrName);
    if (already.length > 1) throw new AmbiguousNameError(idOrName);
    return rowToLoop(already[0]!);
  }

  async countLoops(...args: M<"countLoops">["args"]): Promise<M<"countLoops">["result"]> {
    const [status, opts = {}] = args;
    let sql: string;
    const params: unknown[] = [];
    if (status && opts.archived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND status = $1 AND archived_at IS NOT NULL";
      params.push(status);
    } else if (status && opts.includeArchived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND status = $1";
      params.push(status);
    } else if (status) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND status = $1 AND archived_at IS NULL";
      params.push(status);
    } else if (opts.archived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND archived_at IS NOT NULL";
    } else if (opts.includeArchived) {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE tenant_id = open_loops_current_tenant_id()";
    } else {
      sql = "SELECT COUNT(*)::int AS count FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND archived_at IS NULL";
    }
    const row = await this.client.get<{ count: number }>(sql, params);
    return row?.count ?? 0;
  }

  // ----------------------------------------------- id-preserving bulk import
  // Postgres counterparts of the sqlite Store.upsertMigration* methods. These
  // preserve the incoming id/status/timestamps exactly (no genId, no forced
  // "active"), so a local->self-hosted backfill reproduces the source rows
  // faithfully and idempotently (tenant-qualified upsert — re-runs never
  // duplicate). Without --replace an existing row is left untouched and
  // returned as-is. Run/step output is re-clamped by persistedRunOutput and
  // errors re-scrubbed, matching the sqlite import semantics exactly.

  async upsertMigrationWorkflow(
    ...args: M<"upsertMigrationWorkflow">["args"]
  ): Promise<M<"upsertMigrationWorkflow">["result"]> {
    const [workflow, opts = {}] = args as [WorkflowSpec, { replace?: boolean }?];
    const existing = await this.getWorkflow(workflow.id);
    if (existing && !opts.replace) return existing;
    try {
      await this.client.execute(
        `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,open_loops_current_tenant_id())
         ON CONFLICT(tenant_id,id) DO UPDATE SET
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
    } catch (error) {
      // Secondary unique: another active workflow already owns this name (a
      // different id from another machine). The primary-key conflict target
      // cannot catch it. Keep
      // the existing active owner rather than aborting the fleet-union backfill.
      if (isUniqueViolation(error)) {
        const owner = await this.client.get<WorkflowRow>(
          "SELECT * FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 AND status = 'active' LIMIT 1",
          [workflow.name],
        );
        if (owner) return rowToWorkflow(owner);
      }
      throw error;
    }
    const imported = await this.getWorkflow(workflow.id);
    if (!imported) throw new Error(`workflow not found after migration import: ${workflow.id}`);
    return imported;
  }

  async upsertMigrationLoop(...args: M<"upsertMigrationLoop">["args"]): Promise<M<"upsertMigrationLoop">["result"]> {
    const [loop, opts = {}] = args as [Loop, { replace?: boolean }?];
    const existing = await this.loadLoop(this.client, loop.id);
    if (existing && !opts.replace) return existing;
    await this.client.execute(
      `INSERT INTO loops (id, name, description, labels_json, status, archived_at, archived_from_status, schedule_json, target_json,
        goal_json, machine_json, next_run_at, retry_scheduled_for, catch_up, catch_up_limit, overlap, max_attempts,
        retry_delay_ms, lease_ms, expires_at, expires_after_runs, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,open_loops_current_tenant_id())
       ON CONFLICT(tenant_id,id) DO UPDATE SET
         name=EXCLUDED.name,
         description=EXCLUDED.description,
         labels_json=EXCLUDED.labels_json,
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
         expires_after_runs=EXCLUDED.expires_after_runs,
         created_at=EXCLUDED.created_at,
         updated_at=EXCLUDED.updated_at`,
      [
        loop.id,
        loop.name,
        loop.description ?? null,
        JSON.stringify(normalizeLoopLabels(loop.labels)),
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
        loop.expiresAfterRuns ?? null,
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
    try {
    await this.client.execute(
      `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
        claimed_by, claim_token, lease_expires_at, pid, pgid, process_started_at, exit_code, duration_ms,
        stdout, stderr, error, goal_run_id, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,open_loops_current_tenant_id())
       ON CONFLICT(tenant_id,id) DO UPDATE SET
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
    } catch (error) {
      // Secondary unique: a run for this (loop_id, scheduled_for) slot already
      // exists under a different id (another machine ran the same shared loop at
      // the same slot). The primary-key conflict target cannot catch it; the slot can hold only
      // one run, so keep the existing occupant rather than aborting the backfill.
      if (isUniqueViolation(error)) {
        const slot = await this.loadRunBySlot(this.client, run.loopId, run.scheduledFor);
        if (slot) return slot;
      }
      throw error;
    }
    const imported = await this.loadRun(this.client, run.id);
    if (!imported) throw new Error(`run not found after migration import: ${run.id}`);
    return imported;
  }

  // ------------------------------------------------------------- run lifecycle

  async createSkippedRun(...args: M<"createSkippedRun">["args"]): Promise<M<"createSkippedRun">["result"]> {
    const [loop, scheduledFor, reason, opts = {}] = args;
    const now = nowIso();
    const id = genId();
    const scrubbedReason = scrubbedOrNull(reason) ?? "";
    return this.client.transaction(async (c) => {
      await this.assertDaemonLeaseFence(c, opts, now);
      await c.execute(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
          claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,1,'skipped',NULL,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$7,$7,open_loops_current_tenant_id())
         ON CONFLICT (tenant_id, loop_id, scheduled_for) DO NOTHING`,
        [id, loop.id, loop.name, scheduledFor, now, scrubbedReason, now],
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
        error: scrubbedReason,
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

  async nextRetryableRun(...args: M<"nextRetryableRun">["args"]): Promise<M<"nextRetryableRun">["result"]> {
    const [loopId, maxAttempts, afterScheduledFor] = args;
    const params: unknown[] = [loopId, maxAttempts];
    const afterClause = afterScheduledFor ? " AND scheduled_for > $3" : "";
    if (afterScheduledFor) params.push(afterScheduledFor);
    const row = await this.client.get<RunRow>(
      `SELECT * FROM loop_runs
       WHERE tenant_id = open_loops_current_tenant_id()
         AND loop_id = $1
         AND status IN ('failed', 'timed_out', 'abandoned')
         AND attempt < $2${afterClause}
       ORDER BY scheduled_for ASC, id ASC LIMIT 1`,
      params,
    );
    return row ? rowToRun(row) : undefined;
  }

  /**
   * Remote-safe liveness proxy shared by claimRun and
   * recoverExpiredRunLeasesDetailed. The Postgres backend cannot inspect the
   * original runner's process (it may be a different machine), so a run whose
   * LEASE lapsed within the expired-run grace window — MAX x GRACE (10 min),
   * the same post-expiry budget the sqlite path allows via its live-process
   * deferral ceiling — is treated as possibly-still-executing: steal and
   * abandon are both deferred until the window passes, bounding the
   * duplicate-execution window to the original runner's 3-heartbeat abort
   * (~1.5 lease periods) instead of stealing the instant the lease lapses.
   *
   * The anchor is lease expiry, deliberately not process start: a run executing
   * longer than the grace window at the moment its lease lapses (a transient
   * heartbeat outage, a machine suspend, a long-running loop) would otherwise
   * receive zero post-expiry protection and have its slot stolen mid-execution
   * while the original runner keeps running. Anchoring on the recorded process
   * start consumes the whole budget up front and defeats the fix for exactly
   * those runs. Time-bounded by construction, so a genuinely dead runner is
   * still reclaimed once the window passes — the "expired lease is reclaimable"
   * fence stays intact without a defer counter column.
   */
  private static expiredLeaseWithinGrace(leaseExpiresAt: string | null | undefined, nowIso: string): boolean {
    if (!leaseExpiresAt) return false;
    const budgetMs = MAX_LIVE_EXPIRED_RUN_DEFERRALS * LIVE_EXPIRED_RUN_GRACE_MS;
    return Date.parse(leaseExpiresAt) + budgetMs > Date.parse(nowIso);
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
   * are meaningless. Ownership here is governed by lease expiry plus a bounded
   * grace window: an expired lease whose lapse is older than the expired-run
   * grace window is reclaimable, and an expired lease whose lapse is still
   * inside that window is deferred (see
   * {@link PostgresLoopStorage.expiredLeaseWithinGrace}) so a runner hit by a
   * transient heartbeat outage cannot have its slot stolen mid-execution. The
   * lease/heartbeat contract (plus `FOR UPDATE` row locks) is the remote
   * correctness boundary.
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
           WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 AND scheduled_for<>$2 AND status='running'
             AND lease_expires_at IS NOT NULL AND lease_expires_at > $3
           LIMIT 1`,
          [loop.id, scheduledFor, startedAt],
        );
        if (blocking) return undefined;
      }

      // Lock the target slot row (if present) so concurrent claimers serialize.
      const existing = await c.get<RunRow>(
        "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND loop_id=$1 AND scheduled_for=$2 FOR UPDATE",
        [loop.id, scheduledFor],
      );

      if (existing) {
        if (existing.status === "running") {
          if (existing.lease_expires_at && (existing.lease_expires_at as string) > startedAt) {
            return undefined; // live lease, cannot steal
          }
          // Expired lease whose lapse is still inside the expired-run grace
          // window: the original runner may still be executing (transient
          // heartbeat outage, machine suspend, a long-running loop — the anchor
          // is the lease lapse, so runs executing longer than the window are
          // protected too). Stealing now would run the slot twice with
          // conflicting side effects. Leave the slot to recovery, which applies
          // the same window, and only reclaim once it passes — a genuinely dead
          // runner is still reclaimed.
          if (PostgresLoopStorage.expiredLeaseWithinGrace(existing.lease_expires_at, startedAt)) {
            return undefined;
          }
          const res = await c.query(
            `UPDATE loop_runs SET status='running', started_at=$2, finished_at=NULL, claimed_by=$3, claim_token=$4,
             lease_expires_at=$5, pid=NULL, pgid=NULL, process_started_at=NULL, exit_code=NULL, duration_ms=NULL,
             stdout=NULL, stderr=NULL, error=NULL, updated_at=$2
             WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='running' AND lease_expires_at <= $6`,
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
           WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status IN ('failed','timed_out','abandoned') AND attempt < $7`,
          [existing.id, attempt, startedAt, runnerId, claimToken, leaseExpiresAt, loop.maxAttempts],
        );
        if (res.rowCount !== 1) return undefined;
        const run = await this.loadRun(c, existing.id);
        return run ? { run, loop, claimToken } : undefined;
      }

      const id = genId();
      const res = await c.query(
        `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
          claimed_by, claim_token, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,1,'running',$5,NULL,$6,$7,$8,NULL,NULL,NULL,NULL,NULL,NULL,$5,$5,open_loops_current_tenant_id())
         ON CONFLICT (tenant_id, loop_id, scheduled_for) DO NOTHING`,
        [id, loop.id, loop.name, scheduledFor, startedAt, runnerId, claimToken, leaseExpiresAt],
      );
      if (res.rowCount !== 1) return undefined;
      const run = await this.loadRun(c, id);
      return run ? { run, loop, claimToken } : undefined;
    });
  }

  async finalizeRun(...args: M<"finalizeRun">["args"]): Promise<M<"finalizeRun">["result"]> {
    const [id, patch, opts = {}] = args;
    const error = patch.error === undefined ? undefined : persistedRunOutput(patch.error) ?? undefined;
    const serverNow = opts.now ?? new Date();
    return this.client.transaction(async (c) => {
      const current = await this.loadRun(c, id);
      if (!current) throw new Error(`run not found after finalize: ${id}`);
      const completion = normalizeRunCompletion({
        startedAt: current.startedAt ?? current.createdAt,
        requestedFinishedAt: patch.finishedAt,
        requestedDurationMs: patch.durationMs,
        serverNow,
      });
      const nowStr = completion.updatedAt;
      let res;
      if (opts.claimedBy) {
        res = await c.query(
          `UPDATE loop_runs SET status=$2, finished_at=$3, lease_expires_at=NULL, pid=$4, exit_code=$5,
           duration_ms=$6, stdout=$7, stderr=$8, error=$9, updated_at=$14
           WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='running' AND claimed_by=$10 AND lease_expires_at > $11
             AND claim_token=$12
             AND ($13::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$13 AND expires_at > $11))`,
          [
            id,
            patch.status,
            completion.finishedAt,
            patch.pid ?? null,
            patch.exitCode ?? null,
            completion.durationMs ?? null,
            persistedRunOutput(patch.stdout),
            persistedRunOutput(patch.stderr),
            error ?? null,
            opts.claimedBy,
            nowStr,
            opts.claimToken ?? null,
            opts.daemonLeaseId ?? null,
            completion.updatedAt,
          ],
        );
      } else {
        res = await c.query(
          `UPDATE loop_runs SET status=$2, finished_at=$3, lease_expires_at=NULL, pid=$4, exit_code=$5,
           duration_ms=$6, stdout=$7, stderr=$8, error=$9, updated_at=$10
           WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='running'`,
          [
            id,
            patch.status,
            completion.finishedAt,
            patch.pid ?? null,
            patch.exitCode ?? null,
            completion.durationMs ?? null,
            persistedRunOutput(patch.stdout),
            persistedRunOutput(patch.stderr),
            error ?? null,
            completion.updatedAt,
          ],
        );
      }
      const runRow = await c.get<RunRow>(
        "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
        [id],
      );
      const run = runRow ? rowToRun(runRow) : undefined;
      if (!run || !runRow) throw new Error(`run not found after finalize: ${id}`);
      if (opts.claimedBy && res.rowCount !== 1) {
        throw new RunFinalizationConflictError(
          opts.claimToken === undefined || runRow.claim_token !== opts.claimToken
            ? "stale_claim"
            : run.status === "running" ? "stale_claim" : "run_not_running",
          id,
        );
      }
      if (res.rowCount === 1) {
        await this.cascadeWorkItemsForLoopRun(c, run, error, completion.updatedAt);
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
       WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='running' AND claimed_by=$4 AND lease_expires_at > $5
         AND claim_token=$6
         AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$7 AND expires_at > $5))`,
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
       WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='running'
         AND claim_token=$6
         AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$7 AND expires_at > $8))`,
      [
        runId,
        info.pid,
        info.pgid ?? null,
        info.processStartedAt ?? now,
        now,
        opts.claimToken ?? null,
        opts.daemonLeaseId ?? null,
        now,
      ],
    );
    if (res.rowCount !== 1) return undefined;
    return this.getRun(runId);
  }

  async listRuns(...args: M<"listRuns">["args"]): Promise<M<"listRuns">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const labels = normalizeLoopLabels(opts.labels);
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const filters: string[] = [];
    if (opts.loopId) filters.push(`loop_runs.loop_id = ${bind(opts.loopId)}`);
    if (opts.status) filters.push(`loop_runs.status = ${bind(opts.status)}`);
    for (const label of labels) {
      filters.push(`label_loops.labels_json @> ${bind(JSON.stringify([label]))}::jsonb`);
    }
    const join = labels.length
      ? " JOIN loops AS label_loops ON label_loops.tenant_id = loop_runs.tenant_id AND label_loops.id = loop_runs.loop_id"
      : "";
    const limitParam = bind(limit);
    const offsetParam = bind(offset);
    const rows = await this.client.many<RunRow>(
      `SELECT loop_runs.* FROM loop_runs${join} WHERE loop_runs.tenant_id = open_loops_current_tenant_id()${filters.length ? ` AND ${filters.join(" AND ")}` : ""} ORDER BY loop_runs.created_at DESC, loop_runs.id DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );
    return rows.map(rowToRun);
  }

  async listRecoveredLeaseRunsPage(
    ...args: M<"listRecoveredLeaseRunsPage">["args"]
  ): Promise<RecoveredLeaseRunPage> {
    const opts = args[0] ?? {};
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts.limit ?? 1_000)));
    const snapshot: RecoveredLeaseRunSnapshotEntry[] = opts.snapshot ?? await this.client.many<Pick<RunRow, "id" | "updated_at" | "scheduled_for" | "attempt">>(
      `SELECT id, updated_at, scheduled_for, attempt FROM loop_runs
       WHERE tenant_id = open_loops_current_tenant_id()
         AND status='abandoned' AND error='run lease expired before completion'
       ORDER BY updated_at ASC, scheduled_for ASC, id ASC`,
      [],
    ).then((rows) => rows.map((row) => ({
      id: row.id,
      updatedAt: row.updated_at,
      scheduledFor: row.scheduled_for,
      attempt: row.attempt,
    })));
    const offset = Math.max(0, Math.min(snapshot.length, Math.floor(opts.offset ?? 0)));
    const selected = snapshot.slice(offset, offset + limit);
    const rows = selected.length === 0
      ? []
      : await this.client.many<RunRow>(
          `SELECT * FROM loop_runs
           WHERE tenant_id = open_loops_current_tenant_id() AND id = ANY($1::text[])`,
          [selected.map((entry) => entry.id)],
        );
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const snapshotById = new Map(selected.map((entry) => [entry.id, entry]));
    const runs = selected
      .map((entry) => rowsById.get(entry.id))
      .filter((row): row is RunRow => {
        if (!row) return false;
        const entry = snapshotById.get(row.id);
        return Boolean(entry && matchesRecoveredLeaseSnapshot(row, entry));
      })
      .map(rowToRun);
    const nextOffset = offset + selected.length;
    return {
      runs,
      snapshot,
      ...(nextOffset < snapshot.length ? { nextOffset } : {}),
    };
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
        started_at, finished_at, status, exit_code, summary_json, evidence_paths_json, bundle_json, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,open_loops_current_tenant_id())
       ON CONFLICT(tenant_id,run_id) DO UPDATE SET
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
        bundle_json=EXCLUDED.bundle_json,
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
        receipt.bundle ? JSON.stringify(receipt.bundle) : null,
        receipt.created_at,
        receipt.updated_at,
      ],
    );
    return (await this.getRunReceipt(receipt.run_id)) ?? receipt;
  }

  async getRunReceipt(...args: M<"getRunReceipt">["args"]): Promise<M<"getRunReceipt">["result"]> {
    const row = await this.client.get<RunReceiptRow>("SELECT * FROM run_receipts WHERE tenant_id = open_loops_current_tenant_id() AND run_id = $1", [args[0]]);
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
    const where = `WHERE tenant_id = open_loops_current_tenant_id()${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
    const rows = await this.client.many<RunReceiptRow>(
      `SELECT * FROM run_receipts ${where} ORDER BY created_at DESC LIMIT ${limitSlot}`,
      params,
    );
    return rows.map(rowToRunReceipt);
  }

  async countRuns(...args: M<"countRuns">["args"]): Promise<M<"countRuns">["result"]> {
    // Mirrors listRuns' filters exactly (LOO3-00143 P1): the CLI's pagination
    // envelope must count the FILTERED population, never the global run table.
    const opts = args[0] ?? {};
    const labels = normalizeLoopLabels(opts.labels);
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const filters: string[] = [];
    if (opts.loopId) filters.push(`loop_runs.loop_id = ${bind(opts.loopId)}`);
    if (opts.status) filters.push(`loop_runs.status = ${bind(opts.status)}`);
    for (const label of labels) {
      filters.push(`label_loops.labels_json @> ${bind(JSON.stringify([label]))}::jsonb`);
    }
    const join = labels.length
      ? " JOIN loops AS label_loops ON label_loops.tenant_id = loop_runs.tenant_id AND label_loops.id = loop_runs.loop_id"
      : "";
    const row = await this.client.get<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM loop_runs${join} WHERE loop_runs.tenant_id = open_loops_current_tenant_id()${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`,
      params,
    );
    return row?.count ?? 0;
  }

  async recoverExpiredRunLeases(
    ...args: M<"recoverExpiredRunLeases">["args"]
  ): Promise<M<"recoverExpiredRunLeases">["result"]> {
    const detailed = await this.recoverExpiredRunLeasesDetailed(...args);
    return detailed.abandoned;
  }

  async listExpiredRunLeaseCandidates(
    expiredBefore: Date = new Date(),
    opts: { limit?: number } = {},
  ): Promise<ExpiredRunLeaseCandidatePage> {
    const limit = Math.max(1, Math.min(1_000, Math.floor(opts.limit ?? DEFAULT_RECOVERY_BATCH_LIMIT)));
    const rows = await this.client.many<RunRow>(
      `SELECT * FROM loop_runs
       WHERE tenant_id = open_loops_current_tenant_id()
         AND status = 'running'
         AND lease_expires_at <= $1
       ORDER BY lease_expires_at ASC, id ASC
       LIMIT $2`,
      [expiredBefore.toISOString(), limit + 1],
    );
    return {
      candidates: rows.slice(0, limit).map((row) => ({
        runId: row.id,
        loopId: row.loop_id,
        leaseExpiresAt: row.lease_expires_at!,
        updatedAt: row.updated_at,
      })),
      truncated: rows.length > limit,
    };
  }

  /**
   * Recover expired run leases. Divergence from sqlite (documented): the remote
   * backend cannot inspect local process liveness, so an expired lease is
   * abandoned unless its lapse is still inside the expired-run grace window
   * (`expiredLeaseWithinGrace`) — such runs are deferred, not abandoned, because
   * the original runner may still be executing on another machine. Abandoning
   * within the window would let the next claim pass mint a new attempt while the
   * original runner is live. The window is time-bounded (MAX x GRACE = 10 min),
   * so a genuinely dead runner is still abandoned once it passes.
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
    // Applied inside the query, before LIMIT — see the sqlite implementation
    // and the `protectClaimedByInLoops` contract note for why a post-scan
    // filter starves unrelated reapable runs.
    const protect = opts.protectClaimedByInLoops;
    const protectLoopIds = protect ? [...new Set(protect.loopIds)] : [];
    const protectClaimedBy = protectLoopIds.length > 0 ? protect!.claimedBy : null;
    const unresolvedOperationPredicate = `EXISTS (
      SELECT 1
      FROM workflow_runs AS operation_workflow
      JOIN workflow_events AS admitted_event
        ON admitted_event.workflow_run_id = operation_workflow.id
       AND admitted_event.tenant_id = open_loops_current_tenant_id()
      WHERE operation_workflow.tenant_id = open_loops_current_tenant_id()
        AND operation_workflow.loop_run_id = loop_runs.id
        AND admitted_event.event_type = 'private_operation_admitted'
        AND NOT EXISTS (
          SELECT 1
          FROM workflow_events AS terminal_event
          WHERE terminal_event.tenant_id = open_loops_current_tenant_id()
            AND terminal_event.workflow_run_id = admitted_event.workflow_run_id
            AND terminal_event.step_id = admitted_event.step_id
            AND terminal_event.event_type = 'private_operation_terminal'
        )
    )`;
    const commonArgs = [
      finished,
      opts.runId ?? null,
      opts.expectedLeaseExpiresAt ?? null,
      opts.expectedUpdatedAt ?? null,
      opts.excludeClaimedBy ?? null,
      protectClaimedBy,
      protectLoopIds,
    ];
    const operationRows = opts.refuseAdmittedPrivateOperations
      ? await this.client.many<RunRow>(
          `SELECT * FROM loop_runs
           WHERE tenant_id = open_loops_current_tenant_id() AND status='running' AND lease_expires_at <= $1
             AND ($2::text IS NULL OR id = $2)
             AND ($3::timestamptz IS NULL OR lease_expires_at = $3::timestamptz)
             AND ($4::timestamptz IS NULL OR updated_at = $4::timestamptz)
             AND ($5::text IS NULL OR claimed_by IS DISTINCT FROM $5)
             AND ($6::text IS NULL OR claimed_by IS NULL OR claimed_by <> $6 OR NOT (loop_id = ANY($7::text[])))
             AND ${unresolvedOperationPredicate}
           ORDER BY lease_expires_at ASC LIMIT $8`,
          [...commonArgs, limit],
        )
      : [];
    const operationReconciliationRequired = (
      await Promise.all(operationRows.map((row) => this.getRun(row.id)))
    ).filter((run): run is LoopRun => Boolean(run));
    const reconciliationRunIds = new Set(operationReconciliationRequired.map((run) => run.id));
    const rows = await this.client.many<RunRow>(
      `SELECT * FROM loop_runs
       WHERE tenant_id = open_loops_current_tenant_id() AND status='running' AND lease_expires_at <= $1
         AND ($2::text IS NULL OR id = $2)
         AND ($3::timestamptz IS NULL OR lease_expires_at = $3::timestamptz)
         AND ($4::timestamptz IS NULL OR updated_at = $4::timestamptz)
         AND ($5::text IS NULL OR claimed_by IS DISTINCT FROM $5)
         AND ($6::text IS NULL OR claimed_by IS NULL OR claimed_by <> $6 OR NOT (loop_id = ANY($7::text[])))
         AND ($8::boolean = FALSE OR NOT ${unresolvedOperationPredicate})
       ORDER BY lease_expires_at ASC LIMIT $9`,
      [
        ...commonArgs,
        opts.refuseAdmittedPrivateOperations ?? false,
        scanLimit,
      ],
    );
    const recovered: LoopRun[] = [];
    const deferred: LoopRun[] = [];
    for (const row of rows) {
      if (recovered.length >= limit) break;
      // Lease lapsed within the expired-run grace window: the original runner
      // may still be executing on its own machine. Defer instead of abandoning —
      // see the method doc.
      if (PostgresLoopStorage.expiredLeaseWithinGrace(row.lease_expires_at, finished)) {
        const deferredRun = await this.getRun(row.id);
        if (deferredRun) deferred.push(deferredRun);
        continue;
      }
      const run = await this.client.transaction(async (c) => {
        const res = await c.query(
          `UPDATE loop_runs SET status='abandoned', finished_at=$2, lease_expires_at=NULL,
           error='run lease expired before completion', updated_at=$2
           WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='running' AND lease_expires_at <= $3
             AND ($4::timestamptz IS NULL OR lease_expires_at=$4::timestamptz)
             AND ($5::timestamptz IS NULL OR updated_at=$5::timestamptz)
             AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$6 AND expires_at > $3))
             AND ($7::boolean = FALSE OR NOT ${unresolvedOperationPredicate})`,
          [
            row.id,
            finished,
            finished,
            opts.expectedLeaseExpiresAt ?? null,
            opts.expectedUpdatedAt ?? null,
            opts.daemonLeaseId ?? null,
            opts.refuseAdmittedPrivateOperations ?? false,
          ],
        );
        if (res.rowCount !== 1) return undefined;
        const workflowRows = await c.many<WorkflowRunRow>(
          "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND loop_run_id = $1 AND status NOT IN ('succeeded','failed','timed_out','cancelled')",
          [row.id],
        );
        for (const wf of workflowRows) {
          const wfRes = await c.query(
            `UPDATE workflow_runs SET status='failed', finished_at=$2,
             error='parent loop run lease expired before completion', updated_at=$2
             WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status NOT IN ('succeeded','failed','timed_out','cancelled')`,
            [wf.id, finished],
          );
          if (wfRes.rowCount !== 1) continue;
          await c.execute(
            `UPDATE workflow_step_runs SET status='skipped', finished_at=$2, pid=NULL,
             error='parent loop run lease expired before completion', updated_at=$2
             WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND status IN ('pending','running')`,
            [wf.id, finished],
          );
          await this.setWorkItemsForWorkflowRun(
            c,
            wf.id,
            "failed",
            "parent loop run lease expired before completion",
            finished,
          );
          await this.appendWorkflowEventWithClient(c, wf.id, "failed", undefined, {
            error: "parent loop run lease expired before completion",
            loopRunId: row.id,
          });
          await this.demoteNonProductiveWorkItems(c, wf.id, finished);
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
          if (loop?.target.type === "workflow" && itemStatus !== "admitted") {
            const workflowId = loop.target.workflowId;
            const workItemId = loop.target.input?.workflowWorkItemId ?? loop.target.input?.workItemId;
            await this.maybeArchiveGeneratedRouteWorkflow(c, {
              workflowId,
              loopId: loop.id,
              loopRunId: row.id,
              workItemId,
              workflowRunId: workflowRows.find((workflowRow) => workflowRow.workflow_id === workflowId)?.id,
              updated: finished,
            });
          }
        }
        return this.loadRun(c, row.id);
      });
      if (run) {
        recovered.push(run);
      } else if (opts.refuseAdmittedPrivateOperations && !reconciliationRunIds.has(row.id)) {
        const unresolved = await this.client.get<{ found: number }>(
          `SELECT 1 AS found FROM loop_runs
           WHERE tenant_id = open_loops_current_tenant_id() AND id=$1
             AND status='running' AND lease_expires_at <= $2
             AND ${unresolvedOperationPredicate}
           LIMIT 1`,
          [row.id, finished],
        );
        if (unresolved) {
          const unchanged = await this.getRun(row.id);
          if (unchanged) {
            operationReconciliationRequired.push(unchanged);
            reconciliationRunIds.add(unchanged.id);
          }
        }
      }
    }
    return { abandoned: recovered, deferred, operationReconciliationRequired };
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
           WHERE tenant_id = open_loops_current_tenant_id()
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
            `SELECT id FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND loop_run_id = ANY($1)`,
            [batch],
          )
        ).map((r) => r.id);
        summary.workflowRuns += workflowRunIds.length;
        const gr = await this.client.get<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM goal_runs WHERE tenant_id = open_loops_current_tenant_id() AND (loop_run_id = ANY($1) OR workflow_run_id = ANY($2))`,
          [batch, workflowRunIds],
        );
        summary.goalRuns += gr?.count ?? 0;
        continue;
      }
      await this.client.transaction(async (c) => {
        const confirmed = (
          await c.many<{ id: string }>(
            `SELECT id FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = ANY($1) AND status IN (${terminal})`,
            [batch],
          )
        ).map((r) => r.id);
        if (confirmed.length === 0) return;
        const workflowRunIds = (
          await c.many<{ id: string }>(`SELECT id FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND loop_run_id = ANY($1)`, [confirmed])
        ).map((r) => r.id);
        summary.loopRuns += confirmed.length;
        summary.workflowRuns += workflowRunIds.length;
        const gr = await c.query(
          `DELETE FROM goal_runs WHERE tenant_id = open_loops_current_tenant_id() AND (loop_run_id = ANY($1) OR workflow_run_id = ANY($2))`,
          [confirmed, workflowRunIds],
        );
        summary.goalRuns += gr.rowCount;
        // workflow_runs.loop_run_id ON DELETE SET NULL; delete them explicitly to
        // mirror sqlite pruning of orphaned workflow history.
        if (workflowRunIds.length > 0) {
          await c.execute(`DELETE FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = ANY($1)`, [workflowRunIds]);
        }
        await c.execute(`DELETE FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = ANY($1) AND status IN (${terminal})`, [confirmed]);
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
      const existing = await c.get<LeaseRow>("SELECT * FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() LIMIT 1 FOR UPDATE", []);
      if (existing && (existing.expires_at as string) > now.toISOString() && existing.id !== input.id) {
        return undefined;
      }
      await c.execute("DELETE FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id()", []);
      await c.execute(
        `INSERT INTO daemon_lease (id, pid, hostname, heartbeat_at, expires_at, created_at, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$4,$4,open_loops_current_tenant_id())`,
        [input.id, input.pid, input.hostname, now.toISOString(), expiresAt],
      );
      return this.loadDaemonLease(c);
    });
  }

  async heartbeatDaemonLease(...args: M<"heartbeatDaemonLease">["args"]): Promise<M<"heartbeatDaemonLease">["result"]> {
    const [id, ttlMs, now = new Date()] = args;
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const res = await this.client.query(
      `UPDATE daemon_lease SET heartbeat_at=$2, expires_at=$3, updated_at=$2 WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND expires_at > $4`,
      [id, now.toISOString(), expiresAt, now.toISOString()],
    );
    if (res.rowCount !== 1) return undefined;
    return this.getDaemonLease();
  }

  async releaseDaemonLease(...args: M<"releaseDaemonLease">["args"]): Promise<M<"releaseDaemonLease">["result"]> {
    await this.client.execute("DELETE FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id = $1", [args[0]]);
  }

  async getDaemonLease(...args: M<"getDaemonLease">["args"]): Promise<M<"getDaemonLease">["result"]> {
    void args;
    return this.loadDaemonLease(this.client);
  }

  // --------------------------------------------------------- workflows (reads)

  private async loadWorkflow(c: TypedQueryClient, id: string) {
    const row = await c.get<WorkflowRow>("SELECT * FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1", [id]);
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
          "SELECT * FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() AND status = $1 ORDER BY status ASC, name ASC LIMIT $2 OFFSET $3",
          [opts.status, limit, offset],
        )
      : await this.client.many<WorkflowRow>(
          "SELECT * FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() ORDER BY status ASC, name ASC LIMIT $1 OFFSET $2",
          [limit, offset],
        );
    return rows.map(rowToWorkflow);
  }

  async countWorkflows(...args: M<"countWorkflows">["args"]): Promise<M<"countWorkflows">["result"]> {
    const opts = args[0] ?? {};
    const row = opts.status
      ? await this.client.get<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() AND status = $1",
          [opts.status],
        )
      : await this.client.get<{ count: number }>("SELECT COUNT(*)::int AS count FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id()", []);
    return row?.count ?? 0;
  }

  async getWorkflowInvocation(
    ...args: M<"getWorkflowInvocation">["args"]
  ): Promise<M<"getWorkflowInvocation">["result"]> {
    const row = await this.client.get<WorkflowInvocationRow>(
      "SELECT * FROM workflow_invocations WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
      [args[0]],
    );
    return row ? rowToWorkflowInvocation(row) : undefined;
  }

  async listWorkflowInvocations(
    ...args: M<"listWorkflowInvocations">["args"]
  ): Promise<M<"listWorkflowInvocations">["result"]> {
    const opts = args[0] ?? {};
    const rows = await this.client.many<WorkflowInvocationRow>(
      "SELECT * FROM workflow_invocations WHERE tenant_id = open_loops_current_tenant_id() ORDER BY created_at DESC LIMIT $1",
      [opts.limit ?? 100],
    );
    return rows.map(rowToWorkflowInvocation);
  }

  async getWorkflowWorkItem(...args: M<"getWorkflowWorkItem">["args"]): Promise<M<"getWorkflowWorkItem">["result"]> {
    const row = await this.client.get<WorkflowWorkItemRow>(
      "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
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
        "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND status = $1 AND route_key = $2 ORDER BY priority DESC, created_at ASC LIMIT $3",
        [opts.status, opts.routeKey, limit],
      );
    } else if (opts.status) {
      rows = await this.client.many<WorkflowWorkItemRow>(
        "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND status = $1 ORDER BY priority DESC, created_at ASC LIMIT $2",
        [opts.status, limit],
      );
    } else if (opts.routeKey) {
      rows = await this.client.many<WorkflowWorkItemRow>(
        "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND route_key = $1 ORDER BY priority DESC, created_at ASC LIMIT $2",
        [opts.routeKey, limit],
      );
    } else {
      rows = await this.client.many<WorkflowWorkItemRow>(
        "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() ORDER BY priority DESC, created_at ASC LIMIT $1",
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
        `SELECT COUNT(*)::int AS count FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND status IN ${active} AND ${col} = $1`,
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
            `SELECT COUNT(*)::int AS count FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND status IN ${active}`,
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
    const row = await this.client.get<WorkflowRunRow>("SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1", [args[0]]);
    return row ? rowToWorkflowRun(row) : undefined;
  }

  async listWorkflowRuns(...args: M<"listWorkflowRuns">["args"]): Promise<M<"listWorkflowRuns">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    let rows: WorkflowRunRow[];
    if (opts.workflowId && opts.loopRunId) {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_id = $1 AND loop_run_id = $2 ORDER BY created_at DESC LIMIT $3",
        [opts.workflowId, opts.loopRunId, limit],
      );
    } else if (opts.workflowId) {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_id = $1 ORDER BY created_at DESC LIMIT $2",
        [opts.workflowId, limit],
      );
    } else if (opts.loopRunId) {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND loop_run_id = $1 ORDER BY created_at DESC LIMIT $2",
        [opts.loopRunId, limit],
      );
    } else {
      rows = await this.client.many<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() ORDER BY created_at DESC LIMIT $1",
        [limit],
      );
    }
    return rows.map(rowToWorkflowRun);
  }

  async listWorkflowStepRuns(...args: M<"listWorkflowStepRuns">["args"]): Promise<M<"listWorkflowStepRuns">["result"]> {
    const rows = await this.client.many<WorkflowStepRunRow>(
      "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id = $1 ORDER BY sequence ASC",
      [args[0]],
    );
    return rows.map(rowToWorkflowStepRun);
  }

  async getWorkflowStepRun(...args: M<"getWorkflowStepRun">["args"]): Promise<M<"getWorkflowStepRun">["result"]> {
    const row = await this.client.get<WorkflowStepRunRow>(
      "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id = $1 AND step_id = $2",
      [args[0], args[1]],
    );
    return row ? rowToWorkflowStepRun(row) : undefined;
  }

  async listWorkflowEvents(...args: M<"listWorkflowEvents">["args"]): Promise<M<"listWorkflowEvents">["result"]> {
    const [workflowRunId, limit = 200] = args as [string, number?];
    const rows = await this.client.many<WorkflowEventRow>(
      "SELECT * FROM workflow_events WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id = $1 ORDER BY sequence ASC LIMIT $2",
      [workflowRunId, limit],
    );
    return rows.map(rowToWorkflowEvent);
  }

  // -------------------------------------------------------------- goals (reads)

  async getGoal(...args: M<"getGoal">["args"]): Promise<M<"getGoal">["result"]> {
    const row = await this.client.get<GoalRow>("SELECT * FROM goals WHERE tenant_id = open_loops_current_tenant_id() AND id = $1", [args[0]]);
    return row ? rowToGoal(row) : undefined;
  }

  async listGoals(...args: M<"listGoals">["args"]): Promise<M<"listGoals">["result"]> {
    const opts = args[0] ?? {};
    const limit = opts.limit ?? 100;
    const rows = opts.status
      ? await this.client.many<GoalRow>(
          "SELECT * FROM goals WHERE tenant_id = open_loops_current_tenant_id() AND status = $1 ORDER BY updated_at DESC LIMIT $2",
          [opts.status, limit],
        )
      : await this.client.many<GoalRow>("SELECT * FROM goals WHERE tenant_id = open_loops_current_tenant_id() ORDER BY updated_at DESC LIMIT $1", [limit]);
    return rows.map(rowToGoal);
  }

  async listGoalPlanNodes(...args: M<"listGoalPlanNodes">["args"]): Promise<M<"listGoalPlanNodes">["result"]> {
    const idOrPlan = args[0];
    const rows = await this.client.many<GoalPlanNodeRow>(
      "SELECT * FROM goal_plan_nodes WHERE tenant_id = open_loops_current_tenant_id() AND (goal_id = $1 OR plan_id = $1) ORDER BY sequence ASC",
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
      rows = await this.client.many<GoalRunRow>("SELECT * FROM goal_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1", [opts.runId]);
    } else if (opts.goalId) {
      rows = await this.client.many<GoalRunRow>(
        "SELECT * FROM goal_runs WHERE tenant_id = open_loops_current_tenant_id() AND goal_id = $1 ORDER BY created_at ASC LIMIT $2",
        [opts.goalId, limit],
      );
    } else {
      rows = await this.client.many<GoalRunRow>("SELECT * FROM goal_runs WHERE tenant_id = open_loops_current_tenant_id() ORDER BY created_at DESC LIMIT $1", [limit]);
    }
    return rows.map(rowToGoalRun);
  }

  // -------------------------------------------------------- TIER 2: not ported
  // Heavy multi-statement workflow/goal orchestration lifted straight from the
  // sqlite Store (manifest staging, goal status rollups, step sequencing). These
  // throw loudly rather than silently no-op. Port order matches sqlite Store.

  async createWorkflow(...args: M<"createWorkflow">["args"]): Promise<M<"createWorkflow">["result"]> {
    const [input] = args as [CreateWorkflowInput];
    const normalized = normalizeCreateWorkflowInput(input);
    const now = nowIso();
    const workflow: WorkflowSpec = {
      id: genId(),
      name: normalized.name,
      description: normalized.description,
      version: normalized.version ?? 1,
      status: "active",
      goal: normalized.goal,
      steps: normalized.steps,
      createdAt: now,
      updatedAt: now,
    };
    await this.client.execute(
      `INSERT INTO workflow_specs (id, name, description, version, status, goal_json, steps_json, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,open_loops_current_tenant_id())`,
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
    return workflow;
  }
  async archiveWorkflow(...args: M<"archiveWorkflow">["args"]): Promise<M<"archiveWorkflow">["result"]> {
    const [idOrName] = args as [string];
    // The hosted ApiStore resolves name→id client-side before POSTing to
    // /workflows/:id/archive, so `idOrName` is normally an id. Fall back to an
    // active-name lookup to stay behaviour-compatible with the sqlite Store.
    const existing =
      (await this.loadWorkflow(this.client, idOrName)) ??
      (await this.client
        .get<WorkflowRow>("SELECT * FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1", [idOrName])
        .then((row) => (row ? rowToWorkflow(row) : undefined)));
    if (!existing) throw new Error(`workflow not found: ${idOrName}`);
    const updated = nowIso();
    await this.client.execute("UPDATE workflow_specs SET status='archived', updated_at=$1 WHERE tenant_id = open_loops_current_tenant_id() AND id=$2", [updated, existing.id]);
    const archived = await this.getWorkflow(existing.id);
    if (!archived) throw new Error(`workflow not found after archive: ${existing.id}`);
    return archived;
  }
  async createWorkflowInvocation(
    ...args: M<"createWorkflowInvocation">["args"]
  ): Promise<M<"createWorkflowInvocation">["result"]> {
    const [input] = args as [CreateWorkflowInvocationInput];
    const now = nowIso();
    const sourceDedupeKey = input.sourceRef.dedupeKey ?? undefined;
    if (sourceDedupeKey) {
      const existing = await this.client.get<WorkflowInvocationRow>(
        "SELECT * FROM workflow_invocations WHERE tenant_id = open_loops_current_tenant_id() AND source_kind = $1 AND source_dedupe_key = $2 LIMIT 1",
        [input.sourceRef.kind, sourceDedupeKey],
      );
      if (existing) return rowToWorkflowInvocation(existing);
    }
    const id = input.id ?? genId();
    await this.client.execute(
      `INSERT INTO workflow_invocations (id, workflow_id, template_id, source_kind, source_id, source_dedupe_key,
        source_json, subject_kind, subject_id, subject_path, subject_url, subject_json, intent, scope_json,
        output_policy_json, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15::jsonb,$16,$17,open_loops_current_tenant_id())`,
      [
        id,
        input.workflowId ?? null,
        input.templateId ?? null,
        input.sourceRef.kind,
        input.sourceRef.id ?? null,
        sourceDedupeKey ?? null,
        JSON.stringify(input.sourceRef),
        input.subjectRef.kind,
        input.subjectRef.id ?? null,
        input.subjectRef.path ?? null,
        input.subjectRef.url ?? null,
        JSON.stringify(input.subjectRef),
        input.intent,
        input.scope ? JSON.stringify(input.scope) : null,
        input.outputPolicy ? JSON.stringify(input.outputPolicy) : null,
        now,
        now,
      ],
    );
    const row = await this.client.get<WorkflowInvocationRow>(
      "SELECT * FROM workflow_invocations WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
      [id],
    );
    if (!row) throw new Error(`workflow invocation not found after create: ${id}`);
    return rowToWorkflowInvocation(row);
  }

  async upsertWorkflowWorkItem(
    ...args: M<"upsertWorkflowWorkItem">["args"]
  ): Promise<M<"upsertWorkflowWorkItem">["result"]> {
    const [input] = args as [UpsertWorkflowWorkItemInput];
    const now = nowIso();
    const id = input.id ?? genId();
    const status = input.status ?? "queued";
    await this.client.execute(
      `INSERT INTO workflow_work_items (id, route_key, idempotency_key, invocation_id, source_type, source_ref,
        subject_ref, project_key, project_group, machine_id, route_scope, priority, status, attempts, next_attempt_at,
        lease_expires_at, workflow_id, loop_id, workflow_run_id, last_reason, created_at, updated_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,NULL,NULL,NULL,NULL,$15,$16,$17,open_loops_current_tenant_id())
       ON CONFLICT(tenant_id,route_key,idempotency_key) DO UPDATE SET
        invocation_id=excluded.invocation_id,
        source_type=excluded.source_type,
        source_ref=excluded.source_ref,
        subject_ref=excluded.subject_ref,
        project_key=excluded.project_key,
        project_group=excluded.project_group,
        machine_id=CASE
          WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.machine_id
          ELSE excluded.machine_id
        END,
        route_scope=excluded.route_scope,
        priority=excluded.priority,
        status=CASE
          WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled')
            THEN workflow_work_items.status
          ELSE excluded.status
        END,
        workflow_id=CASE
          WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.workflow_id
          ELSE NULL
        END,
        loop_id=CASE
          WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.loop_id
          ELSE NULL
        END,
        workflow_run_id=CASE
          WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.workflow_run_id
          ELSE NULL
        END,
        lease_expires_at=CASE
          WHEN workflow_work_items.status IN ('succeeded', 'admitted', 'running', 'failed', 'dead_letter', 'cancelled') THEN workflow_work_items.lease_expires_at
          ELSE NULL
        END,
        next_attempt_at=excluded.next_attempt_at,
        last_reason=CASE
          WHEN workflow_work_items.attempts > 0
            AND workflow_work_items.status IN ('queued', 'deferred')
            AND workflow_work_items.last_reason IS NOT NULL
            AND excluded.last_reason IS NOT NULL
            THEN workflow_work_items.last_reason || '; ' || excluded.last_reason
          ELSE COALESCE(excluded.last_reason, workflow_work_items.last_reason)
        END,
        updated_at=excluded.updated_at`,
      [
        id,
        input.routeKey,
        input.idempotencyKey,
        input.invocationId,
        input.sourceType,
        input.sourceRef,
        input.subjectRef,
        input.projectKey ?? null,
        input.projectGroup ?? null,
        input.machineId ?? null,
        input.routeScope ?? null,
        input.priority ?? 0,
        status,
        input.nextAttemptAt ?? null,
        input.lastReason ?? null,
        now,
        now,
      ],
    );
    const row = await this.client.get<WorkflowWorkItemRow>(
      "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND route_key = $1 AND idempotency_key = $2 LIMIT 1",
      [input.routeKey, input.idempotencyKey],
    );
    if (!row) throw new Error(`workflow work item not found after upsert: ${input.routeKey}/${input.idempotencyKey}`);
    return rowToWorkflowWorkItem(row);
  }
  async admitWorkflowWorkItem(...args: M<"admitWorkflowWorkItem">["args"]): Promise<M<"admitWorkflowWorkItem">["result"]> {
    const [id, patch] = args;
    const now = nowIso();
    const res = await this.client.query(
      `UPDATE workflow_work_items
       SET status='admitted', attempts=attempts + 1, workflow_id=$2, loop_id=$3,
        next_attempt_at=NULL,
        lease_expires_at=NULL,
        last_reason=CASE
          WHEN last_reason IS NOT NULL AND $4::text IS NOT NULL THEN last_reason || '; ' || $4::text
          ELSE COALESCE($4::text, last_reason)
        END,
        updated_at=$5
       WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status IN ('queued', 'deferred')`,
      [id, patch.workflowId, patch.loopId, patch.reason ?? null, now],
    );
    const item = await this.getWorkflowWorkItem(id);
    if (!item) throw new Error(`workflow work item not found after admit: ${id}`);
    if (res.rowCount !== 1) throw new Error(`workflow work item is not claimable: ${id} status=${item.status}`);
    return item;
  }

  async createGoal(...args: M<"createGoal">["args"]): Promise<M<"createGoal">["result"]> {
    const [input, opts = {}] = args as [CreateGoalInput, DaemonLeaseFence?];
    const now = nowIso();
    return this.client.transaction(async (c) => {
      await this.assertDaemonLeaseFence(c, opts, now);
      const id = genId();
      await c.execute(
        `INSERT INTO goals (id, plan_id, objective, status, token_budget, tokens_used, time_used_seconds, auto_execute,
          max_tokens, source_type, source_id, loop_id, loop_run_id, workflow_id, workflow_run_id, workflow_step_id,
          created_at, updated_at, tenant_id)
         VALUES ($1,$1,$2,'active',$3,0,0,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,open_loops_current_tenant_id())`,
        [
          id,
          input.objective,
          input.tokenBudget ?? null,
          input.autoExecute ?? "readyOnly",
          input.maxTokens ?? input.tokenBudget ?? null,
          input.sourceType ?? null,
          input.sourceId ?? null,
          input.loopId ?? null,
          input.loopRunId ?? null,
          input.workflowId ?? null,
          input.workflowRunId ?? null,
          input.workflowStepId ?? null,
          now,
        ],
      );
      const row = await c.get<GoalRow>(
        "SELECT * FROM goals WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
        [id],
      );
      if (!row) throw new Error(`goal not found after create: ${id}`);
      return rowToGoal(row);
    });
  }

  async requireGoal(...args: M<"requireGoal">["args"]): Promise<M<"requireGoal">["result"]> {
    const goal = await this.getGoal(args[0]);
    if (!goal) throw new Error(`goal not found: ${args[0]}`);
    return goal;
  }

  async findGoalByContext(...args: M<"findGoalByContext">["args"]): Promise<M<"findGoalByContext">["result"]> {
    const [context] = args;
    if (context.loopRunId) {
      const row = await this.client.get<GoalRow>(
        `SELECT * FROM goals
         WHERE tenant_id = open_loops_current_tenant_id()
           AND loop_run_id = $1
           AND ($2::text IS NULL OR workflow_step_id = $2)
         ORDER BY created_at DESC LIMIT 1`,
        [context.loopRunId, context.workflowStepId ?? null],
      );
      if (row) return rowToGoal(row);
    }
    if (context.workflowRunId) {
      const row = await this.client.get<GoalRow>(
        `SELECT * FROM goals
         WHERE tenant_id = open_loops_current_tenant_id()
           AND workflow_run_id = $1
           AND ($2::text IS NULL OR workflow_step_id = $2)
         ORDER BY created_at DESC LIMIT 1`,
        [context.workflowRunId, context.workflowStepId ?? null],
      );
      if (row) return rowToGoal(row);
    }
    if (context.sourceType && context.sourceId) {
      const row = await this.client.get<GoalRow>(
        `SELECT * FROM goals
         WHERE tenant_id = open_loops_current_tenant_id()
           AND source_type = $1
           AND source_id = $2
           AND status <> ALL($3::text[])
         ORDER BY created_at DESC LIMIT 1`,
        [context.sourceType, context.sourceId, [...GOAL_TERMINAL]],
      );
      if (row) return rowToGoal(row);
    }
    return undefined;
  }

  private mapGoalPlanNode(row: GoalPlanNodeRow): GoalPlanNode {
    return rowToGoalPlanNode({ ...row, ready: (row.ready as unknown as boolean) ? 1 : 0 });
  }

  async createGoalPlanNodes(...args: M<"createGoalPlanNodes">["args"]): Promise<M<"createGoalPlanNodes">["result"]> {
    const [goalId, nodes, opts = {}] = args as [string, CreateGoalPlanNodeInput[], DaemonLeaseFence?];
    const goal = await this.requireGoal(goalId);
    const now = nowIso();
    const materialized: GoalPlanNode[] = nodes.map((node, sequence) => ({
      nodeId: genId(),
      planId: goal.planId,
      key: node.key,
      sequence,
      priority: node.priority ?? 0,
      objective: node.objective,
      status: "pending",
      ready: false,
      tokenBudget: node.tokenBudget,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      dependsOn: node.dependsOn ?? [],
      createdAt: now,
      updatedAt: now,
    }));
    const withReady = updateReadyFlags(materialized, "active");
    await this.client.transaction(async (c) => {
      await this.assertDaemonLeaseFence(c, opts, now);
      for (const node of withReady) {
        await c.execute(
          `INSERT INTO goal_plan_nodes (id, goal_id, plan_id, key, sequence, priority, objective, status, ready,
            token_budget, tokens_used, time_used_seconds, depends_on_json, created_at, updated_at, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,open_loops_current_tenant_id())
           ON CONFLICT DO NOTHING`,
          [
            node.nodeId,
            goal.goalId,
            goal.planId,
            node.key,
            node.sequence,
            node.priority,
            node.objective,
            node.status,
            node.ready,
            node.tokenBudget ?? null,
            node.tokensUsed,
            node.timeUsedSeconds,
            JSON.stringify(node.dependsOn),
            node.createdAt,
            node.updatedAt,
          ],
        );
      }
    });
    return await this.listGoalPlanNodes(goalId);
  }

  async updateGoalStatus(...args: M<"updateGoalStatus">["args"]): Promise<M<"updateGoalStatus">["result"]> {
    const [goalId, status, opts = {}] = args as [string, GoalStatus, DaemonLeaseFence?];
    const current = await this.requireGoal(goalId);
    assertGoalTransition(current.status, status);
    const now = (opts.now ?? new Date()).toISOString();
    await this.client.execute(
      `UPDATE goals SET status=$2, updated_at=$3
       WHERE tenant_id = open_loops_current_tenant_id() AND id=$1
         AND ($4::text IS NULL OR EXISTS (
           SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$4 AND expires_at > $5
         ))`,
      [goalId, status, now, opts.daemonLeaseId ?? null, now],
    );
    return await this.requireGoal(goalId);
  }

  async updateGoalPlanNode(...args: M<"updateGoalPlanNode">["args"]): Promise<M<"updateGoalPlanNode">["result"]> {
    const [goalId, key, patch, opts = {}] = args;
    const now = (opts.now ?? new Date()).toISOString();
    await this.client.execute(
      `UPDATE goal_plan_nodes
       SET status=COALESCE($3, status),
        tokens_used=COALESCE($4, tokens_used),
        time_used_seconds=COALESCE($5, time_used_seconds),
        ready=COALESCE($6, ready),
        updated_at=$7
       WHERE tenant_id = open_loops_current_tenant_id() AND goal_id=$1 AND key=$2
         AND ($8::text IS NULL OR EXISTS (
           SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$8 AND expires_at > $9
         ))`,
      [
        goalId,
        key,
        patch.status ?? null,
        patch.tokensUsed ?? null,
        patch.timeUsedSeconds ?? null,
        patch.ready ?? null,
        now,
        opts.daemonLeaseId ?? null,
        now,
      ],
    );
    const node = (await this.listGoalPlanNodes(goalId)).find((entry) => entry.key === key);
    if (!node) throw new Error(`goal node not found: ${goalId}/${key}`);
    return node;
  }

  async recordGoalEvent(...args: M<"recordGoalEvent">["args"]): Promise<M<"recordGoalEvent">["result"]> {
    const [input, opts = {}] = args as [RecordGoalEventInput, DaemonLeaseFence?];
    const now = nowIso();
    return this.client.transaction(async (c) => {
      await this.assertDaemonLeaseFence(c, opts, now);
      const goalRow = await c.get<GoalRow>(
        "SELECT * FROM goals WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
        [input.goalId],
      );
      if (!goalRow) throw new Error(`goal not found: ${input.goalId}`);
      const goal = rowToGoal(goalRow);
      const previous = await c.get<{ turn: number | null }>(
        "SELECT MAX(turn)::int AS turn FROM goal_runs WHERE tenant_id = open_loops_current_tenant_id() AND goal_id = $1",
        [goal.goalId],
      );
      const turn = input.turn ?? (previous?.turn ?? 0) + 1;
      const id = genId();
      await c.execute(
        `INSERT INTO goal_runs (id, goal_id, plan_id, loop_id, loop_run_id, workflow_id, workflow_run_id, workflow_step_id,
          turn, phase, status, node_key, tokens_used, evidence_json, raw_response_json, created_at, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,open_loops_current_tenant_id())`,
        [
          id,
          goal.goalId,
          goal.planId,
          goal.loopId ?? null,
          goal.loopRunId ?? null,
          goal.workflowId ?? null,
          goal.workflowRunId ?? null,
          goal.workflowStepId ?? null,
          turn,
          input.phase,
          input.status,
          input.nodeKey ?? null,
          input.tokensUsed ?? 0,
          input.evidence ? persistedJson(input.evidence) : null,
          input.rawResponse === undefined ? null : persistedJson(input.rawResponse),
          now,
          now,
        ],
      );
      if (input.tokensUsed && input.tokensUsed > 0) {
        await c.execute(
          "UPDATE goals SET tokens_used=tokens_used + $2, updated_at=$3 WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
          [goal.goalId, input.tokensUsed, now],
        );
      }
      const event = await c.get<GoalRunRow>(
        "SELECT * FROM goal_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
        [id],
      );
      if (!event) throw new Error(`goal run not found after record: ${id}`);
      return rowToGoalRun(event);
    });
  }

  async requireWorkflow(...args: M<"requireWorkflow">["args"]): Promise<M<"requireWorkflow">["result"]> {
    const idOrName = args[0];
    const byId = await this.getWorkflow(idOrName);
    if (byId) return byId;
    const row = await this.client.get<WorkflowRow>(
      "SELECT * FROM workflow_specs WHERE tenant_id = open_loops_current_tenant_id() AND name = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
      [idOrName],
    );
    if (row) return rowToWorkflow(row);
    throw new Error(`workflow not found: ${idOrName}`);
  }

  async createWorkflowRun(...args: M<"createWorkflowRun">["args"]): Promise<M<"createWorkflowRun">["result"]> {
    const [input] = args as [CreateWorkflowRunInput];
    const now = nowIso();
    const definitionHash = workflowDefinitionHash(input.workflow);
    const initialContractEvents = initialAgentSessionContractEvents(input.workflow);
    const targetInput = input.loop?.target.type === "workflow" ? input.loop.target.input : undefined;
    const invocationId = input.invocationId ?? targetInput?.workflowInvocationId ?? targetInput?.invocationId;
    const workItemId = input.workItemId ?? targetInput?.workflowWorkItemId ?? targetInput?.workItemId;
    if (input.idempotencyKey) {
      const existing = await this.client.get<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_id = $1 AND idempotency_key = $2 LIMIT 1",
        [input.workflow.id, input.idempotencyKey],
      );
      if (existing) {
        await this.client.transaction((c) => this.assertDaemonLeaseFence(c, input, now));
        if (!existing.workflow_definition_hash) throw new LegacyWorkflowRunProvenanceError(existing.id);
        if (existing.workflow_definition_hash !== definitionHash) throw new WorkflowRunDefinitionConflictError(existing.id);
        return rowToWorkflowRun(existing);
      }
    }

    return this.client.transaction(async (c) => {
      await this.assertDaemonLeaseFence(c, input, now);
      const runId = genId();
      const operationEvents = privateOperationEventsForWorkflowRun({
        workflow: input.workflow,
        workflowRunId: runId,
        attempt: input.loopRun?.attempt ?? 1,
        idempotencyKey: input.idempotencyKey ?? `${runId}:${definitionHash}`,
        authority: input.operationAuthority ?? {
          authorityId: "loops-control-plane",
          tenantId: this.tenantId,
        },
      });
      const insertSql =
        `INSERT INTO workflow_runs (id, workflow_id, workflow_name, loop_id, loop_run_id, invocation_id, work_item_id,
          scheduled_for, idempotency_key, workflow_definition_hash, manifest_path, status, started_at, finished_at, duration_ms, error,
          created_at, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,'running',$11,NULL,NULL,NULL,$11,$11,open_loops_current_tenant_id())`;
      const insertParams = [
        runId,
        input.workflow.id,
        input.workflow.name,
        input.loop?.id ?? null,
        input.loopRun?.id ?? null,
        invocationId ?? null,
        workItemId ?? null,
        input.scheduledFor ?? input.loopRun?.scheduledFor ?? null,
        input.idempotencyKey ?? null,
        definitionHash,
        now,
      ];
      if (input.idempotencyKey) {
        const inserted = await c.query(
          `${insertSql}
           ON CONFLICT (tenant_id, workflow_id, idempotency_key)
           WHERE idempotency_key IS NOT NULL
           DO NOTHING`,
          insertParams,
        );
        if (inserted.rowCount === 0) {
          // PostgreSQL waits for a concurrent conflicting insert to commit (or
          // roll back) before resolving DO NOTHING. Load that immutable winner
          // in this transaction and apply the same provenance checks as a
          // sequential retry instead of leaking a raw unique violation.
          const existing = await c.get<WorkflowRunRow>(
            "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_id = $1 AND idempotency_key = $2 LIMIT 1",
            [input.workflow.id, input.idempotencyKey],
          );
          if (!existing) throw new Error("idempotent workflow run conflict resolved without a visible winner");
          if (!existing.workflow_definition_hash) throw new LegacyWorkflowRunProvenanceError(existing.id);
          if (existing.workflow_definition_hash !== definitionHash) throw new WorkflowRunDefinitionConflictError(existing.id);
          return rowToWorkflowRun(existing);
        }
      } else {
        await c.execute(insertSql, insertParams);
      }
      if (workItemId) {
        const leaseExpiresAt = input.loop ? new Date(Date.now() + input.loop.leaseMs).toISOString() : null;
        const workItemRes = await c.query(
          `UPDATE workflow_work_items
           SET status='running', workflow_run_id=$2, lease_expires_at=$3, updated_at=$4
           WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status IN ('admitted', 'queued', 'deferred', 'running')`,
          [workItemId, runId, leaseExpiresAt, now],
        );
        if (workItemRes.rowCount !== 1) {
          const current = await c.get<WorkflowWorkItemRow>(
            "SELECT * FROM workflow_work_items WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
            [workItemId],
          );
          throw new Error(`workflow work item is not runnable: ${workItemId}${current ? ` status=${current.status}` : ""}`);
        }
      }
      for (const [sequence, step] of input.workflow.steps.entries()) {
        const account = step.account ?? step.target.account;
        const agentTarget = step.target.type === "agent" ? step.target : undefined;
        const resolvedProfile = account?.profile ?? agentTarget?.authProfile ?? null;
        const resolvedTool = account?.tool ?? (agentTarget?.authProfile ? agentTarget.provider : null);
        await c.execute(
          `INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, sequence, status, started_at, finished_at,
            exit_code, pid, duration_ms, stdout, stderr, error, account_profile, account_tool, created_at, updated_at, tenant_id)
           VALUES ($1,$2,$3,$4,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$5,$6,$7,$7,open_loops_current_tenant_id())`,
          [genId(), runId, step.id, sequence, resolvedProfile, resolvedTool, now],
        );
      }
      await this.appendWorkflowEventWithClient(c, runId, "created", undefined, {
        workflowId: input.workflow.id,
        workflowName: input.workflow.name,
        stepCount: input.workflow.steps.length,
        loopId: input.loop?.id,
        loopRunId: input.loopRun?.id,
        invocationId,
        workItemId,
        manifestPath: undefined,
      });
      for (const event of initialContractEvents) {
        input.beforeInitialWorkflowEventPersist?.(event);
        await this.appendWorkflowEventWithClient(c, runId, event.eventType, event.stepId, event.payload);
      }
      for (const event of operationEvents) {
        await this.appendWorkflowEventWithClient(c, runId, event.eventType, event.stepId, event.payload);
      }
      const run = await c.get<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
        [runId],
      );
      if (!run) throw new Error(`workflow run not found after create: ${runId}`);
      return rowToWorkflowRun(run);
    });
  }

  async requireWorkflowRun(...args: M<"requireWorkflowRun">["args"]): Promise<M<"requireWorkflowRun">["result"]> {
    const run = await this.getWorkflowRun(args[0]);
    if (!run) throw new Error(`workflow run not found: ${args[0]}`);
    return run;
  }

  async isWorkflowRunTerminal(...args: M<"isWorkflowRunTerminal">["args"]): Promise<M<"isWorkflowRunTerminal">["result"]> {
    const run = await this.getWorkflowRun(args[0]);
    return Boolean(run && ["succeeded", "failed", "timed_out", "cancelled"].includes(run.status));
  }

  async startWorkflowStepRun(...args: M<"startWorkflowStepRun">["args"]): Promise<M<"startWorkflowStepRun">["result"]> {
    const [workflowRunId, stepId, opts = {}] = args;
    const now = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      await this.lockWorkflowRun(c, workflowRunId);
      const res = await c.query(
        `UPDATE workflow_step_runs
         SET status='running', started_at=$3, finished_at=NULL, exit_code=NULL, duration_ms=NULL,
          pid=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$4
         WHERE tenant_id = open_loops_current_tenant_id()
           AND workflow_run_id=$1
           AND step_id=$2
           AND status IN ('pending', 'failed', 'timed_out')
           AND EXISTS (
             SELECT 1 FROM workflow_runs
             WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status='running'
           )
           AND ($5::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$5 AND expires_at > $6
           ))`,
        [workflowRunId, stepId, now, now, opts.daemonLeaseId ?? null, now],
      );
      const row = await c.get<WorkflowStepRunRow>(
        "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2",
        [workflowRunId, stepId],
      );
      const run = row ? rowToWorkflowStepRun(row) : undefined;
      if (!run) throw new Error(`workflow step run not found: ${workflowRunId}/${stepId}`);
      if (res.rowCount !== 1) throw new Error(`workflow step is not claimable: ${workflowRunId}/${stepId} status=${run.status}`);
      await this.appendWorkflowEventWithClient(c, workflowRunId, "step_started", stepId);
      return run;
    });
  }

  async markWorkflowStepPid(...args: M<"markWorkflowStepPid">["args"]): Promise<M<"markWorkflowStepPid">["result"]> {
    const [workflowRunId, stepId, pid, opts = {}] = args;
    const now = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      await this.lockWorkflowRun(c, workflowRunId);
      await c.execute(
        `UPDATE workflow_step_runs SET pid=$3, updated_at=$4
         WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2 AND status='running'
           AND ($5::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$5 AND expires_at > $6
           ))`,
        [workflowRunId, stepId, pid, now, opts.daemonLeaseId ?? null, now],
      );
      const row = await c.get<WorkflowStepRunRow>(
        "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2",
        [workflowRunId, stepId],
      );
      const run = row ? rowToWorkflowStepRun(row) : undefined;
      if (!run) throw new Error(`workflow step run not found after pid update: ${workflowRunId}/${stepId}`);
      return run;
    });
  }

  async recordWorkflowStepProgress(...args: M<"recordWorkflowStepProgress">["args"]): Promise<M<"recordWorkflowStepProgress">["result"]> {
    const [workflowRunId, stepId, progress, opts = {}] = args;
    const now = (opts.now ?? new Date()).toISOString();
    return this.client.transaction(async (c) => {
      await this.lockWorkflowRun(c, workflowRunId);
      const res = await c.query(
        `UPDATE workflow_step_runs
         SET stdout=COALESCE($3, stdout),
             stderr=COALESCE($4, stderr),
             updated_at=$5
         WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2 AND status='running'
           AND ($6::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$6 AND expires_at > $7
           ))`,
        [
          workflowRunId,
          stepId,
          progress.stdout === undefined ? null : persistedRunOutput(progress.stdout),
          progress.stderr === undefined ? null : persistedRunOutput(progress.stderr),
          now,
          opts.daemonLeaseId ?? null,
          now,
        ],
      );
      if (res.rowCount === 1) await this.appendWorkflowEventWithClient(c, workflowRunId, "step_progress", stepId, progress.payload);
      const row = await c.get<WorkflowStepRunRow>(
        "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2",
        [workflowRunId, stepId],
      );
      const run = row ? rowToWorkflowStepRun(row) : undefined;
      if (!run) throw new Error(`workflow step run not found after progress update: ${workflowRunId}/${stepId}`);
      return run;
    });
  }

  async recoverWorkflowRun(...args: M<"recoverWorkflowRun">["args"]): Promise<M<"recoverWorkflowRun">["result"]> {
    const [
      workflowRunId,
      reason = "workflow run recovered for retry",
      context = {},
    ] = args as [string, string?, WorkflowRecoveryContext?];
    const scrubbedReason = scrubbedOrNull(reason) ?? "";
    return this.client.transaction(async (c) => {
      const now = (context.now ?? new Date()).toISOString();
      const visibleRun = await c.get<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
        [workflowRunId],
      );
      if (!visibleRun) throw new Error(`workflow run not found: ${workflowRunId}`);
      const parentLoopRun = visibleRun.loop_run_id
        ? await c.get<RunRow>(
            "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 FOR UPDATE",
            [visibleRun.loop_run_id],
          )
        : undefined;
      const runRow = await this.lockWorkflowRun(c, workflowRunId);
      if (runRow.status !== "running") throw new WorkflowRunNotRunningError();
      if (context.mode === "operator" && parentLoopRun?.status === "running") {
        throw new WorkflowRunStepOwnershipUnverifiableError();
      }
      if (context.mode === "runner") {
        const claimIsCurrent =
          parentLoopRun != null &&
          runRow.loop_run_id === context.loopRunId &&
          parentLoopRun.id === context.loopRunId &&
          parentLoopRun.status === "running" &&
          parentLoopRun.claimed_by === context.claimedBy &&
          parentLoopRun.claim_token === context.claimToken &&
          typeof parentLoopRun.lease_expires_at === "string" &&
          parentLoopRun.lease_expires_at > now;
        if (!claimIsCurrent) throw new WorkflowRunStepOwnershipUnverifiableError();
      }
      const rows = await c.many<WorkflowStepRunRow>(
        `SELECT * FROM workflow_step_runs
         WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND status='running'
         ORDER BY sequence ASC, id ASC
         FOR UPDATE`,
        [workflowRunId],
      );
      const before = rows.map(rowToWorkflowStepRun);
      if (before.some((step) => step.pid !== undefined)) {
        throw new WorkflowRunStepOwnershipUnverifiableError();
      }
      await c.execute(
        `UPDATE workflow_step_runs
         SET status='pending', started_at=NULL, finished_at=NULL, exit_code=NULL, pid=NULL, duration_ms=NULL,
          stdout=NULL, stderr=NULL, error=$2, updated_at=$3
         WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND status='running'`,
        [workflowRunId, scrubbedReason, now],
      );
      if (before.length > 0) {
        await this.appendWorkflowEventWithClient(c, workflowRunId, "recovered", undefined, {
          reason: scrubbedReason,
          recoveredSteps: before.map((step) => step.stepId),
        });
      }
      const stepRows = await c.many<WorkflowStepRunRow>(
        "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 ORDER BY sequence ASC",
        [workflowRunId],
      );
      const recoveredSteps = stepRows.map(rowToWorkflowStepRun).filter((step) => before.some((prior) => prior.stepId === step.stepId));
      const run = rowToWorkflowRun(runRow);
      return { run, recoveredSteps };
    });
  }

  async finalizeWorkflowStepRun(...args: M<"finalizeWorkflowStepRun">["args"]): Promise<M<"finalizeWorkflowStepRun">["result"]> {
    const [workflowRunId, stepId, patch, opts = {}] = args;
    const finishedAt = patch.finishedAt ?? nowIso();
    return this.client.transaction(async (c) => {
      const now = (opts.now ?? new Date(finishedAt)).toISOString();
      const error = patch.error === undefined ? undefined : scrubbedOrNull(patch.error) ?? undefined;
      await this.lockWorkflowRun(c, workflowRunId);
      const res = await c.query(
        `UPDATE workflow_step_runs SET status=$3, finished_at=$4, exit_code=$5, duration_ms=$6,
          pid=NULL, stdout=$7, stderr=$8, error=$9, updated_at=$10
         WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2 AND status='running'
           AND ($11::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$11 AND expires_at > $12
           ))`,
        [
          workflowRunId,
          stepId,
          patch.status,
          finishedAt,
          patch.exitCode ?? null,
          patch.durationMs ?? null,
          persistedRunOutput(patch.stdout),
          persistedRunOutput(patch.stderr),
          error ?? null,
          finishedAt,
          opts.daemonLeaseId ?? null,
          now,
        ],
      );
      if (res.rowCount === 1) {
        await this.appendWorkflowEventWithClient(c, workflowRunId, `step_${patch.status}`, stepId, {
          exitCode: patch.exitCode,
          error,
        });
      }
      const row = await c.get<WorkflowStepRunRow>(
        "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2",
        [workflowRunId, stepId],
      );
      const run = row ? rowToWorkflowStepRun(row) : undefined;
      if (!run) throw new Error(`workflow step run not found after finalize: ${workflowRunId}/${stepId}`);
      return run;
    });
  }

  async skipWorkflowStepRun(...args: M<"skipWorkflowStepRun">["args"]): Promise<M<"skipWorkflowStepRun">["result"]> {
    const [workflowRunId, stepId, reason, opts = {}] = args;
    const now = (opts.now ?? new Date()).toISOString();
    const scrubbedReason = scrubbedOrNull(reason) ?? "";
    return this.client.transaction(async (c) => {
      await this.lockWorkflowRun(c, workflowRunId);
      const res = await c.query(
        `UPDATE workflow_step_runs SET status='skipped', finished_at=$3, pid=NULL, error=$4, updated_at=$5
         WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2 AND status IN ('pending', 'running')
           AND ($6::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$6 AND expires_at > $7
           ))`,
        [workflowRunId, stepId, now, scrubbedReason, now, opts.daemonLeaseId ?? null, now],
      );
      if (res.rowCount === 1) {
        await this.appendWorkflowEventWithClient(c, workflowRunId, "step_skipped", stepId, {
          reason: scrubbedReason,
        });
      }
      const row = await c.get<WorkflowStepRunRow>(
        "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND step_id=$2",
        [workflowRunId, stepId],
      );
      const run = row ? rowToWorkflowStepRun(row) : undefined;
      if (!run) throw new Error(`workflow step run not found after skip: ${workflowRunId}/${stepId}`);
      return run;
    });
  }

  private async setWorkflowWorkItemsForWorkflowRun(
    c: TypedQueryClient,
    workflowRunId: string,
    status: WorkflowWorkItemStatus,
    reason: string | undefined,
    updated: string,
    statuses: WorkflowWorkItemStatus[] = ["admitted", "running"],
  ): Promise<void> {
    await c.execute(
      `UPDATE workflow_work_items
       SET status=$2, lease_expires_at=NULL, last_reason=COALESCE($3, last_reason), updated_at=$4
       WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 AND status = ANY($5::text[])`,
      [workflowRunId, status, reason ?? null, updated, statuses],
    );
  }

  private async demoteNonProductiveWorkItems(c: TypedQueryClient, workflowRunId: string, finishedAt: string): Promise<void> {
    const rows = await c.many<WorkflowStepRunRow>(
      "SELECT * FROM workflow_step_runs WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$1 ORDER BY sequence ASC",
      [workflowRunId],
    );
    const kind = classifyNonProductiveStepFailure(rows.map(rowToWorkflowStepRun));
    if (!kind) {
      await c.execute(
        "UPDATE workflow_work_items SET gate_deaths=0, updated_at=$1 WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$2 AND status='failed' AND gate_deaths > 0",
        [finishedAt, workflowRunId],
      );
      return;
    }
    if (kind === "tempfail") {
      await c.execute(
        `UPDATE workflow_work_items
         SET status='queued', attempts=GREATEST(attempts - 1, 0),
          gate_deaths=0,
          workflow_id=NULL, loop_id=NULL, workflow_run_id=NULL,
          next_attempt_at=NULL, lease_expires_at=NULL,
          last_reason='worker exited 75 (tempfail): requeued for retry; attempt refunded (does not count toward redispatch cap)',
          updated_at=$1
         WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$2 AND status='failed'`,
        [finishedAt, workflowRunId],
      );
      return;
    }
    await c.execute(
      `UPDATE workflow_work_items
       SET attempts=GREATEST(attempts - 1, 0),
        gate_deaths=gate_deaths + 1,
        status=CASE WHEN gate_deaths + 1 >= ${GATE_DEATH_CEILING} THEN 'dead_letter' ELSE status END,
        last_reason=CASE
          WHEN gate_deaths + 1 >= ${GATE_DEATH_CEILING}
            THEN 'gate-death ceiling reached (' || (gate_deaths + 1) || '/${GATE_DEATH_CEILING} consecutive runs died at worktree prep / triage / planner without reaching the worker): dead-lettered'
          ELSE 'gate death before real work (worktree prep / triage / planner): attempt refunded (does not count toward redispatch cap); consecutive gate deaths: ' || (gate_deaths + 1) || '/${GATE_DEATH_CEILING}'
        END,
        updated_at=$1
       WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id=$2 AND status='failed'`,
      [finishedAt, workflowRunId],
    );
  }

  async finalizeWorkflowRun(...args: M<"finalizeWorkflowRun">["args"]): Promise<M<"finalizeWorkflowRun">["result"]> {
    const [workflowRunId, status, patch = {}, opts = {}] = args as [
      string,
      WorkflowRunStatus,
      Partial<Pick<WorkflowRun, "finishedAt" | "durationMs" | "error">>?,
      DaemonLeaseFence?,
    ];
    const finishedAt = patch.finishedAt ?? nowIso();
    return this.client.transaction(async (c) => {
      const now = (opts.now ?? new Date(finishedAt)).toISOString();
      const error = patch.error === undefined ? undefined : scrubbedOrNull(patch.error) ?? undefined;
      const currentRun = await this.lockWorkflowRun(c, workflowRunId);
      const res = await c.query(
        `UPDATE workflow_runs SET status=$2, finished_at=$3, duration_ms=$4, error=$5, updated_at=$6
         WHERE tenant_id = open_loops_current_tenant_id() AND id=$1 AND status NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled')
           AND ($7::text IS NULL OR EXISTS (
             SELECT 1 FROM daemon_lease WHERE tenant_id = open_loops_current_tenant_id() AND id=$7 AND expires_at > $8
           ))`,
        [workflowRunId, status, finishedAt, patch.durationMs ?? null, error ?? null, finishedAt, opts.daemonLeaseId ?? null, now],
      );
      const changed = res.rowCount === 1;
      if (changed) {
        await this.appendWorkflowEventWithClient(c, workflowRunId, status, undefined, { error });
        let itemStatus: WorkflowWorkItemStatus =
          status === "succeeded" ? "succeeded" : status === "cancelled" ? "cancelled" : "failed";
        if (
          itemStatus === "failed"
          && currentRun.loop_id
          && currentRun.loop_run_id
        ) {
          const [loopRow, loopRunRow] = await Promise.all([
            c.get<LoopRow>(
              "SELECT * FROM loops WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
              [currentRun.loop_id],
            ),
            c.get<RunRow>(
              "SELECT * FROM loop_runs WHERE tenant_id = open_loops_current_tenant_id() AND id=$1",
              [currentRun.loop_run_id],
            ),
          ]);
          if (loopRow && loopRunRow && loopRunRow.attempt < loopRow.max_attempts) itemStatus = "admitted";
        }
        const itemReason = itemStatus === "admitted"
          ? error ? `attempt failed; retry pending: ${error}` : "attempt failed; retry pending"
          : error;
        await this.setWorkflowWorkItemsForWorkflowRun(c, workflowRunId, itemStatus, itemReason, finishedAt);
        if (itemStatus === "failed") await this.demoteNonProductiveWorkItems(c, workflowRunId, finishedAt);
        await this.maybeArchiveGeneratedRouteWorkflow(c, {
          workflowId: currentRun.workflow_id,
          loopId: currentRun.loop_id ?? undefined,
          loopRunId: currentRun.loop_run_id ?? undefined,
          workItemId: currentRun.work_item_id ?? undefined,
          workflowRunId,
          workflowRunStatus: status,
          updated: finishedAt,
        });
      }
      const run = await c.get<WorkflowRunRow>(
        "SELECT * FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
        [workflowRunId],
      );
      if (!run) throw new Error(`workflow run not found after finalize: ${workflowRunId}`);
      return rowToWorkflowRun(run);
    });
  }

  private async appendWorkflowEventWithClient(
    c: TypedQueryClient,
    workflowRunId: string,
    eventType: string,
    stepId?: string,
    payload?: Record<string, unknown>,
  ): Promise<M<"appendWorkflowEvent">["result"]> {
    const now = nowIso();
    await c.get(
      "SELECT id FROM workflow_runs WHERE tenant_id = open_loops_current_tenant_id() AND id = $1 FOR UPDATE",
      [workflowRunId],
    );
    if (eventType === "agent_session_contract" || isPrivateOperationEventType(eventType)) {
      const duplicate = await c.get<{ id: string }>(
        `SELECT id FROM workflow_events
         WHERE tenant_id = open_loops_current_tenant_id()
           AND workflow_run_id = $1
           AND event_type = $2
           AND step_id IS NOT DISTINCT FROM $3
         LIMIT 1`,
        [workflowRunId, eventType, stepId ?? null],
      );
      if (duplicate) throw new DuplicateWorkflowEventError(workflowRunId, eventType, stepId);
    }
    const current = await c.get<{ sequence: number | null }>(
      "SELECT MAX(sequence)::int AS sequence FROM workflow_events WHERE tenant_id = open_loops_current_tenant_id() AND workflow_run_id = $1",
      [workflowRunId],
    );
    const sequence = (current?.sequence ?? 0) + 1;
    const id = genId();
    await c.execute(
      `INSERT INTO workflow_events (id, workflow_run_id, sequence, event_type, step_id, payload_json, created_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,open_loops_current_tenant_id())`,
      [id, workflowRunId, sequence, eventType, stepId ?? null, persistedWorkflowEventPayload(payload), now],
    );
    const event = await c.get<WorkflowEventRow>(
      "SELECT * FROM workflow_events WHERE tenant_id = open_loops_current_tenant_id() AND id = $1",
      [id],
    );
    if (!event) throw new Error(`workflow event not found after append: ${id}`);
    return rowToWorkflowEvent(event);
  }

  async appendWorkflowEvent(...args: M<"appendWorkflowEvent">["args"]): Promise<M<"appendWorkflowEvent">["result"]> {
    const [workflowRunId, eventType, stepId, payload] = args;
    return this.client.transaction((c) => this.appendWorkflowEventWithClient(c, workflowRunId, eventType, stepId, payload));
  }
}

export function createPostgresLoopStorage(
  client: PoolQueryClient,
  context: TenantStorageContext,
  opts?: { contextAlreadyBound?: boolean },
): PostgresLoopStorage {
  return new PostgresLoopStorage(client, context, opts);
}
