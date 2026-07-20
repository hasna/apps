// ── The OpenLoops client Store abstraction ───────────────────────────────────
//
// ONE interface, TWO transports. Every CLI command (and MCP tool / SDK caller)
// that reads or writes loop DATA goes through `LoopStore`. There are exactly two
// implementations:
//
//   • LocalStore — on-box SQLite. Wraps the local `Store` and awaits its
//     synchronous methods so callers see one async surface.
//   • ApiStore   — the self_hosted/cloud HTTP API at `<API_URL>/v1` with a bearer
//     key. Delegates to the vendored Hasna storage client / transport.
//
// `getStore()` resolves which transport to use from the client-flip env
// (HASNA_LOOPS_API_URL + HASNA_LOOPS_API_KEY / HASNA_LOOPS_STORAGE_MODE) via
// `resolveCloudStorage`. Callers NEVER branch on mode themselves and NEVER touch
// sqlite or fetch directly — that per-command dual path was the split-brain bug
// this module eliminates.
//
// `self_hosted` and `cloud` are the SAME client code (ApiStore); only the URL and
// key differ, and that distinction is server-side tenancy. `local` is
// first-class and fully functional.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned,
// or embedded in any value produced here. Only the HTTP transport ever holds it.

import type {
  CreateLoopInput,
  CreateWorkflowInput,
  Loop,
  LoopRun,
  LoopStatus,
  PublicWorkflowEvent,
  RunReceipt,
  RunStatus,
  StoredWorkflowEvent,
  WorkflowInvocation,
  WorkflowRun,
  WorkflowSpec,
  WorkflowStepRun,
  WorkflowWorkItem,
  WorkflowWorkItemStatus,
  WriteRunReceiptInput,
} from "../../types.js";
import type { Goal, GoalPlanNode, GoalRun, GoalStatus } from "../goal/types.js";
import { AmbiguousNameError, LoopNotFoundError } from "../errors.js";
import { publicWorkflowEvent } from "../workflow-events.js";
import { resolveCloudStorage } from "../cloud/resolve.js";
import type { HasnaStorageClient } from "../cloud/storage.js";
import type { Env } from "../cloud/mode.js";
import { Store } from "../store.js";
import type { PruneHistoryOptions, PruneHistorySummary } from "../store.js";

/** Which transport backs a resolved store (for banners/diagnostics only). */
export type StoreTransport = "local" | "cloud-http";

/**
 * Thrown when a command routed through the cloud ApiStore hits an operation that
 * the hosted `/v1` API does not yet expose. Failing loudly here is deliberate:
 * the alternative (silently reading/writing the on-box sqlite island while the
 * machine is flipped to cloud) is exactly the split-brain bug we are removing.
 */
export class CloudUnsupportedError extends Error {
  constructor(operation: string) {
    super(
      `operation not supported over the hosted OpenLoops API: ${operation}. ` +
        `Run it on a machine using local storage, or unset HASNA_LOOPS_API_URL/HASNA_LOOPS_API_KEY.`,
    );
    this.name = "CloudUnsupportedError";
  }
}

/**
 * The single data interface for the OpenLoops client. Both {@link LocalStore}
 * and {@link ApiStore} implement it; callers hold a `LoopStore` and never know
 * (or branch on) which one. Every method is async so the two transports share
 * one surface.
 */
export interface LoopStore {
  readonly transport: StoreTransport;
  close(): Promise<void>;

  // ── Loops ──────────────────────────────────────────────────────────────────
  createLoop(input: CreateLoopInput, from?: Date): Promise<Loop>;
  getLoop(id: string): Promise<Loop | undefined>;
  findLoopByName(name: string): Promise<Loop | undefined>;
  requireLoop(idOrName: string): Promise<Loop>;
  requireUniqueLoop(idOrName: string): Promise<Loop>;
  listLoops(opts?: {
    status?: LoopStatus;
    limit?: number;
    offset?: number;
    archived?: boolean;
    includeArchived?: boolean;
    name?: string;
  }): Promise<Loop[]>;
  countLoops(status?: LoopStatus, opts?: { archived?: boolean; includeArchived?: boolean }): Promise<number>;
  updateLoop(id: string, patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor" | "expiresAt">>): Promise<Loop>;
  renameLoop(id: string, name: string): Promise<Loop>;
  archiveLoop(idOrName: string): Promise<Loop>;
  unarchiveLoop(idOrName: string): Promise<Loop>;
  deleteLoop(idOrName: string): Promise<boolean>;

  // ── Workflows ────────────────────────────────────────────────────────────────
  createWorkflow(input: CreateWorkflowInput): Promise<WorkflowSpec>;
  getWorkflow(id: string): Promise<WorkflowSpec | undefined>;
  findWorkflowByName(name: string): Promise<WorkflowSpec | undefined>;
  requireWorkflow(idOrName: string): Promise<WorkflowSpec>;
  listWorkflows(opts?: { status?: WorkflowSpec["status"]; limit?: number; offset?: number }): Promise<WorkflowSpec[]>;
  countWorkflows(opts?: { status?: WorkflowSpec["status"] }): Promise<number>;
  archiveWorkflow(idOrName: string): Promise<WorkflowSpec>;

  // ── Workflow runs ────────────────────────────────────────────────────────────
  getWorkflowRun(id: string): Promise<WorkflowRun | undefined>;
  requireWorkflowRun(id: string): Promise<WorkflowRun>;
  listWorkflowRuns(opts?: { workflowId?: string; loopRunId?: string; limit?: number }): Promise<WorkflowRun[]>;
  listWorkflowStepRuns(workflowRunId: string): Promise<WorkflowStepRun[]>;
  listWorkflowEvents(workflowRunId: string, limit?: number): Promise<PublicWorkflowEvent[]>;
  recoverWorkflowRun(workflowRunId: string, reason?: string): Promise<{ run: WorkflowRun; recoveredSteps: WorkflowStepRun[] }>;
  cancelWorkflowRun(workflowRunId: string, reason?: string): Promise<WorkflowRun>;

  // ── Route work items / invocations ────────────────────────────────────────────
  listWorkflowWorkItems(opts?: { status?: WorkflowWorkItemStatus; routeKey?: string; limit?: number }): Promise<WorkflowWorkItem[]>;
  getWorkflowWorkItem(id: string): Promise<WorkflowWorkItem | undefined>;
  requeueWorkflowWorkItem(id: string, patch?: { reason?: string; resetAttempts?: boolean }): Promise<WorkflowWorkItem>;
  listWorkflowInvocations(opts?: { limit?: number }): Promise<WorkflowInvocation[]>;
  getWorkflowInvocation(id: string): Promise<WorkflowInvocation | undefined>;

  // ── Goals ────────────────────────────────────────────────────────────────────
  getGoal(id: string): Promise<Goal | undefined>;
  findGoalByLoop(idOrName: string): Promise<Goal | undefined>;
  findGoalByRunId(id: string): Promise<Goal | undefined>;
  listGoals(opts?: { status?: GoalStatus; limit?: number }): Promise<Goal[]>;
  listGoalPlanNodes(goalIdOrPlanId: string): Promise<GoalPlanNode[]>;
  listGoalRuns(opts?: { goalId?: string; runId?: string; limit?: number }): Promise<GoalRun[]>;

  // ── Runs & receipts ────────────────────────────────────────────────────────────
  listRuns(opts?: { loopId?: string; status?: RunStatus; limit?: number; offset?: number }): Promise<LoopRun[]>;
  getRun(id: string): Promise<LoopRun | undefined>;
  writeRunReceipt(input: WriteRunReceiptInput): Promise<RunReceipt>;
  getRunReceipt(runId: string): Promise<RunReceipt | undefined>;
  listRunReceipts(opts?: {
    loopId?: string;
    repo?: string;
    taskId?: string;
    knowledgeId?: string;
    status?: string;
    limit?: number;
  }): Promise<RunReceipt[]>;

  // ── History ──────────────────────────────────────────────────────────────────
  pruneHistory(opts: PruneHistoryOptions): Promise<PruneHistorySummary>;
}

// ── LocalStore ────────────────────────────────────────────────────────────────

/**
 * On-box SQLite transport. Wraps a single {@link Store} and awaits its
 * synchronous methods so callers see the async {@link LoopStore} surface.
 */
export class LocalStore implements LoopStore {
  readonly transport = "local" as const;
  private readonly store: Store;

  constructor(store: Store = new Store()) {
    this.store = store;
  }

  /**
   * The underlying on-box sqlite {@link Store}. Exposed ONLY for genuinely
   * local-runtime operations that cannot route over HTTP — the scheduler
   * (tick/run-now inline execution), migration import/export, and local
   * diagnostics (doctor/health/daemon status). Callers must gate on
   * `transport === "local"` first; the hosted ApiStore has no `raw` store, so
   * these operations fail loudly in cloud mode instead of touching an island.
   */
  get raw(): Store {
    return this.store;
  }

  async close(): Promise<void> {
    this.store.close();
  }

  async createLoop(input: CreateLoopInput, from?: Date): Promise<Loop> {
    return from ? this.store.createLoop(input, from) : this.store.createLoop(input);
  }
  async getLoop(id: string): Promise<Loop | undefined> {
    return this.store.getLoop(id);
  }
  async findLoopByName(name: string): Promise<Loop | undefined> {
    return this.store.findLoopByName(name);
  }
  async requireLoop(idOrName: string): Promise<Loop> {
    return this.store.requireLoop(idOrName);
  }
  async requireUniqueLoop(idOrName: string): Promise<Loop> {
    return this.store.requireUniqueLoop(idOrName);
  }
  async listLoops(opts: Parameters<Store["listLoops"]>[0] = {}): Promise<Loop[]> {
    return this.store.listLoops(opts);
  }
  async countLoops(status?: LoopStatus, opts: { archived?: boolean; includeArchived?: boolean } = {}): Promise<number> {
    return this.store.countLoops(status, opts);
  }
  async updateLoop(
    id: string,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor" | "expiresAt">>,
  ): Promise<Loop> {
    return this.store.updateLoop(id, patch);
  }
  async renameLoop(id: string, name: string): Promise<Loop> {
    return this.store.renameLoop(id, name);
  }
  async archiveLoop(idOrName: string): Promise<Loop> {
    return this.store.archiveLoop(idOrName);
  }
  async unarchiveLoop(idOrName: string): Promise<Loop> {
    return this.store.unarchiveLoop(idOrName);
  }
  async deleteLoop(idOrName: string): Promise<boolean> {
    return this.store.deleteLoop(idOrName);
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowSpec> {
    return this.store.createWorkflow(input);
  }
  async getWorkflow(id: string): Promise<WorkflowSpec | undefined> {
    return this.store.getWorkflow(id);
  }
  async findWorkflowByName(name: string): Promise<WorkflowSpec | undefined> {
    return this.store.findWorkflowByName(name);
  }
  async requireWorkflow(idOrName: string): Promise<WorkflowSpec> {
    return this.store.requireWorkflow(idOrName);
  }
  async listWorkflows(opts: Parameters<Store["listWorkflows"]>[0] = {}): Promise<WorkflowSpec[]> {
    return this.store.listWorkflows(opts);
  }
  async countWorkflows(opts: { status?: WorkflowSpec["status"] } = {}): Promise<number> {
    return this.store.countWorkflows(opts);
  }
  async archiveWorkflow(idOrName: string): Promise<WorkflowSpec> {
    return this.store.archiveWorkflow(idOrName);
  }

  async getWorkflowRun(id: string): Promise<WorkflowRun | undefined> {
    return this.store.getWorkflowRun(id);
  }
  async requireWorkflowRun(id: string): Promise<WorkflowRun> {
    return this.store.requireWorkflowRun(id);
  }
  async listWorkflowRuns(opts: Parameters<Store["listWorkflowRuns"]>[0] = {}): Promise<WorkflowRun[]> {
    return this.store.listWorkflowRuns(opts);
  }
  async listWorkflowStepRuns(workflowRunId: string): Promise<WorkflowStepRun[]> {
    return this.store.listWorkflowStepRuns(workflowRunId);
  }
  async listWorkflowEvents(workflowRunId: string, limit?: number): Promise<PublicWorkflowEvent[]> {
    const events = limit === undefined
      ? this.store.listWorkflowEvents(workflowRunId)
      : this.store.listWorkflowEvents(workflowRunId, limit);
    return events.map(publicWorkflowEvent);
  }
  async recoverWorkflowRun(workflowRunId: string, reason?: string): Promise<{ run: WorkflowRun; recoveredSteps: WorkflowStepRun[] }> {
    return reason === undefined ? this.store.recoverWorkflowRun(workflowRunId) : this.store.recoverWorkflowRun(workflowRunId, reason);
  }
  async cancelWorkflowRun(workflowRunId: string, reason?: string): Promise<WorkflowRun> {
    return reason === undefined ? this.store.cancelWorkflowRun(workflowRunId) : this.store.cancelWorkflowRun(workflowRunId, reason);
  }

  async listWorkflowWorkItems(opts: Parameters<Store["listWorkflowWorkItems"]>[0] = {}): Promise<WorkflowWorkItem[]> {
    return this.store.listWorkflowWorkItems(opts);
  }
  async getWorkflowWorkItem(id: string): Promise<WorkflowWorkItem | undefined> {
    return this.store.getWorkflowWorkItem(id);
  }
  async requeueWorkflowWorkItem(id: string, patch: { reason?: string; resetAttempts?: boolean } = {}): Promise<WorkflowWorkItem> {
    return this.store.requeueWorkflowWorkItem(id, patch);
  }
  async listWorkflowInvocations(opts: Parameters<Store["listWorkflowInvocations"]>[0] = {}): Promise<WorkflowInvocation[]> {
    return this.store.listWorkflowInvocations(opts);
  }
  async getWorkflowInvocation(id: string): Promise<WorkflowInvocation | undefined> {
    return this.store.getWorkflowInvocation(id);
  }

  async getGoal(id: string): Promise<Goal | undefined> {
    return this.store.getGoal(id);
  }
  async findGoalByLoop(idOrName: string): Promise<Goal | undefined> {
    return this.store.findGoalByLoop(idOrName);
  }
  async findGoalByRunId(id: string): Promise<Goal | undefined> {
    return this.store.findGoalByRunId(id);
  }
  async listGoals(opts: Parameters<Store["listGoals"]>[0] = {}): Promise<Goal[]> {
    return this.store.listGoals(opts);
  }
  async listGoalPlanNodes(goalIdOrPlanId: string): Promise<GoalPlanNode[]> {
    return this.store.listGoalPlanNodes(goalIdOrPlanId);
  }
  async listGoalRuns(opts: Parameters<Store["listGoalRuns"]>[0] = {}): Promise<GoalRun[]> {
    return this.store.listGoalRuns(opts);
  }

  async listRuns(opts: Parameters<Store["listRuns"]>[0] = {}): Promise<LoopRun[]> {
    return this.store.listRuns(opts);
  }
  async getRun(id: string): Promise<LoopRun | undefined> {
    return this.store.getRun(id);
  }
  async writeRunReceipt(input: WriteRunReceiptInput): Promise<RunReceipt> {
    return this.store.writeRunReceipt(input);
  }
  async getRunReceipt(runId: string): Promise<RunReceipt | undefined> {
    return this.store.getRunReceipt(runId);
  }
  async listRunReceipts(opts: Parameters<Store["listRunReceipts"]>[0] = {}): Promise<RunReceipt[]> {
    return this.store.listRunReceipts(opts);
  }

  async pruneHistory(opts: PruneHistoryOptions): Promise<PruneHistorySummary> {
    return this.store.pruneHistory(opts);
  }
}

// ── ApiStore ────────────────────────────────────────────────────────────────

type Query = Record<string, string | number | boolean | undefined>;

function clean(query: Query): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

/** Pull `key` out of an `{ ok, <key>: [...] }` list envelope, else `fallback`. */
function pickArray<T>(raw: unknown, key: string, fallback: T[] = []): T[] {
  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)[key])) {
    return (raw as Record<string, T[]>)[key]!;
  }
  return fallback;
}

/** Pull `key` out of an `{ ok, <key>: {...} }` object envelope, else the raw value. */
function pickObject<T>(raw: unknown, key: string): T | undefined {
  if (raw && typeof raw === "object") {
    const value = (raw as Record<string, unknown>)[key];
    return value == null ? undefined : (value as T);
  }
  return raw == null ? undefined : (raw as T);
}

/**
 * Self_hosted / cloud transport: routes every read+write through the hosted
 * `/v1` API. Loop/name resolution (requireLoop/requireUniqueLoop/find*) is done
 * client-side by listing and matching, mirroring the local Store behaviour, so a
 * server that ignores a name filter can never return the wrong row.
 */
export class ApiStore implements LoopStore {
  readonly transport = "cloud-http" as const;
  constructor(
    private readonly client: HasnaStorageClient,
    readonly baseUrl: string,
  ) {}

  private get t() {
    return this.client.transport;
  }

  async close(): Promise<void> {
    /* HTTP transport holds no resources to release. */
  }

  // ── Loops ──────────────────────────────────────────────────────────────────
  async createLoop(input: CreateLoopInput): Promise<Loop> {
    return pickObject<Loop>(await this.t.post("/loops", input), "loop")!;
  }
  async getLoop(id: string): Promise<Loop | undefined> {
    try {
      return pickObject<Loop>(await this.t.get(`/loops/${encodeURIComponent(id)}`), "loop");
    } catch {
      return undefined;
    }
  }
  async findLoopByName(name: string): Promise<Loop | undefined> {
    const matches = (await this.listLoops({ name, limit: 1000 })).filter((loop) => loop.name === name);
    return matches[0];
  }
  async requireLoop(idOrName: string): Promise<Loop> {
    const loop = await this.resolveLoop(idOrName);
    if (!loop) throw new LoopNotFoundError(idOrName);
    return loop;
  }
  async requireUniqueLoop(idOrName: string): Promise<Loop> {
    const byId = await this.getLoop(idOrName);
    if (byId) return byId;
    const matches = (await this.listLoops({ name: idOrName, limit: 1000 })).filter((loop) => loop.name === idOrName);
    if (matches.length === 0) throw new LoopNotFoundError(idOrName);
    if (matches.length === 1) return matches[0]!;
    const active = matches.filter((loop) => !loop.archivedAt);
    if (active.length !== 1) throw new AmbiguousNameError(idOrName);
    return active[0]!;
  }
  private async resolveLoop(idOrName: string): Promise<Loop | undefined> {
    const byId = await this.getLoop(idOrName);
    if (byId) return byId;
    const matches = (await this.listLoops({ name: idOrName, limit: 1000 })).filter((loop) => loop.name === idOrName);
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0];
    const active = matches.filter((loop) => !loop.archivedAt);
    if (active.length === 1) return active[0];
    throw new AmbiguousNameError(idOrName);
  }
  async listLoops(opts: Parameters<LoopStore["listLoops"]>[0] = {}): Promise<Loop[]> {
    const raw = await this.t.get("/loops", { query: clean({ ...opts }) });
    return pickArray<Loop>(raw, "loops");
  }
  async countLoops(status?: LoopStatus, opts: { archived?: boolean; includeArchived?: boolean } = {}): Promise<number> {
    const raw = await this.t.get("/loops/count", { query: clean({ status, ...opts }) });
    return Number(pickObject<number>(raw, "count") ?? 0);
  }
  async updateLoop(
    id: string,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor" | "expiresAt">>,
  ): Promise<Loop> {
    return pickObject<Loop>(await this.t.patch(`/loops/${encodeURIComponent(id)}`, patch), "loop")!;
  }
  async renameLoop(id: string, name: string): Promise<Loop> {
    return pickObject<Loop>(await this.t.post(`/loops/${encodeURIComponent(id)}/rename`, { name }), "loop")!;
  }
  async archiveLoop(idOrName: string): Promise<Loop> {
    const loop = await this.requireLoop(idOrName);
    return pickObject<Loop>(await this.t.post(`/loops/${encodeURIComponent(loop.id)}/archive`), "loop")!;
  }
  async unarchiveLoop(idOrName: string): Promise<Loop> {
    const loop = await this.requireLoop(idOrName);
    return pickObject<Loop>(await this.t.post(`/loops/${encodeURIComponent(loop.id)}/unarchive`), "loop")!;
  }
  async deleteLoop(idOrName: string): Promise<boolean> {
    const loop = await this.resolveLoop(idOrName);
    if (!loop) return false;
    const raw = await this.t.request("DELETE", `/loops/${encodeURIComponent(loop.id)}`);
    return Boolean(pickObject<boolean>(raw, "deleted") ?? true);
  }

  // ── Workflows ────────────────────────────────────────────────────────────────
  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowSpec> {
    return pickObject<WorkflowSpec>(await this.t.post("/workflows", input), "workflow")!;
  }
  async getWorkflow(id: string): Promise<WorkflowSpec | undefined> {
    try {
      return pickObject<WorkflowSpec>(await this.t.get(`/workflows/${encodeURIComponent(id)}`), "workflow");
    } catch {
      return undefined;
    }
  }
  async findWorkflowByName(name: string): Promise<WorkflowSpec | undefined> {
    const matches = (await this.listWorkflows({ limit: 1000 })).filter((wf) => wf.name === name);
    return matches[0];
  }
  async requireWorkflow(idOrName: string): Promise<WorkflowSpec> {
    const byId = await this.getWorkflow(idOrName);
    if (byId) return byId;
    const byName = await this.findWorkflowByName(idOrName);
    if (byName) return byName;
    throw new Error(`workflow not found: ${idOrName}`);
  }
  async listWorkflows(opts: Parameters<LoopStore["listWorkflows"]>[0] = {}): Promise<WorkflowSpec[]> {
    const raw = await this.t.get("/workflows", { query: clean({ ...opts }) });
    return pickArray<WorkflowSpec>(raw, "workflows");
  }
  async countWorkflows(opts: { status?: WorkflowSpec["status"] } = {}): Promise<number> {
    const raw = await this.t.get("/workflows/count", { query: clean({ ...opts }) });
    return Number(pickObject<number>(raw, "count") ?? 0);
  }
  async archiveWorkflow(idOrName: string): Promise<WorkflowSpec> {
    const wf = await this.requireWorkflow(idOrName);
    return pickObject<WorkflowSpec>(await this.t.post(`/workflows/${encodeURIComponent(wf.id)}/archive`), "workflow")!;
  }

  // ── Workflow runs ────────────────────────────────────────────────────────────
  async getWorkflowRun(id: string): Promise<WorkflowRun | undefined> {
    try {
      return pickObject<WorkflowRun>(await this.t.get(`/workflow-runs/${encodeURIComponent(id)}`), "workflowRun");
    } catch {
      return undefined;
    }
  }
  async requireWorkflowRun(id: string): Promise<WorkflowRun> {
    const run = await this.getWorkflowRun(id);
    if (!run) throw new Error(`workflow run not found: ${id}`);
    return run;
  }
  async listWorkflowRuns(opts: Parameters<LoopStore["listWorkflowRuns"]>[0] = {}): Promise<WorkflowRun[]> {
    const raw = await this.t.get("/workflow-runs", { query: clean({ ...opts }) });
    return pickArray<WorkflowRun>(raw, "workflowRuns");
  }
  async listWorkflowStepRuns(workflowRunId: string): Promise<WorkflowStepRun[]> {
    const raw = await this.t.get(`/workflow-runs/${encodeURIComponent(workflowRunId)}/steps`);
    return pickArray<WorkflowStepRun>(raw, "steps");
  }
  async listWorkflowEvents(workflowRunId: string, limit?: number): Promise<PublicWorkflowEvent[]> {
    const raw = await this.t.get(`/workflow-runs/${encodeURIComponent(workflowRunId)}/events`, { query: clean({ limit }) });
    return pickArray<StoredWorkflowEvent>(raw, "events").map(publicWorkflowEvent);
  }
  async recoverWorkflowRun(workflowRunId: string, reason?: string): Promise<{ run: WorkflowRun; recoveredSteps: WorkflowStepRun[] }> {
    const raw = await this.t.post(`/workflow-runs/${encodeURIComponent(workflowRunId)}/recover`, { reason });
    return {
      run: pickObject<WorkflowRun>(raw, "workflowRun")!,
      recoveredSteps: pickArray<WorkflowStepRun>(raw, "recoveredSteps"),
    };
  }
  async cancelWorkflowRun(_workflowRunId: string, _reason?: string): Promise<WorkflowRun> {
    // Not yet exposed by the hosted storage contract; fail loudly rather than
    // silently mutate the on-box island while flipped to cloud.
    throw new CloudUnsupportedError("workflows cancel");
  }

  // ── Route work items / invocations ────────────────────────────────────────────
  async listWorkflowWorkItems(opts: Parameters<LoopStore["listWorkflowWorkItems"]>[0] = {}): Promise<WorkflowWorkItem[]> {
    const raw = await this.t.get("/work-items", { query: clean({ ...opts }) });
    return pickArray<WorkflowWorkItem>(raw, "workItems");
  }
  async getWorkflowWorkItem(id: string): Promise<WorkflowWorkItem | undefined> {
    try {
      return pickObject<WorkflowWorkItem>(await this.t.get(`/work-items/${encodeURIComponent(id)}`), "workItem");
    } catch {
      return undefined;
    }
  }
  async requeueWorkflowWorkItem(_id: string, _patch: { reason?: string; resetAttempts?: boolean } = {}): Promise<WorkflowWorkItem> {
    // Not yet exposed by the hosted storage contract; fail loudly rather than
    // silently mutate the on-box island while flipped to cloud.
    throw new CloudUnsupportedError("routes requeue");
  }
  async listWorkflowInvocations(opts: Parameters<LoopStore["listWorkflowInvocations"]>[0] = {}): Promise<WorkflowInvocation[]> {
    const raw = await this.t.get("/invocations", { query: clean({ ...opts }) });
    return pickArray<WorkflowInvocation>(raw, "invocations");
  }
  async getWorkflowInvocation(id: string): Promise<WorkflowInvocation | undefined> {
    try {
      return pickObject<WorkflowInvocation>(await this.t.get(`/invocations/${encodeURIComponent(id)}`), "invocation");
    } catch {
      return undefined;
    }
  }

  // ── Goals ────────────────────────────────────────────────────────────────────
  async getGoal(id: string): Promise<Goal | undefined> {
    try {
      return pickObject<Goal>(await this.t.get(`/goals/${encodeURIComponent(id)}`), "goal");
    } catch {
      return undefined;
    }
  }
  async findGoalByLoop(idOrName: string): Promise<Goal | undefined> {
    try {
      return pickObject<Goal>(await this.t.get("/goals", { query: clean({ loop: idOrName }) }), "goal");
    } catch {
      return undefined;
    }
  }
  async findGoalByRunId(id: string): Promise<Goal | undefined> {
    try {
      return pickObject<Goal>(await this.t.get("/goals", { query: clean({ runId: id }) }), "goal");
    } catch {
      return undefined;
    }
  }
  async listGoals(opts: Parameters<LoopStore["listGoals"]>[0] = {}): Promise<Goal[]> {
    const raw = await this.t.get("/goals", { query: clean({ ...opts }) });
    return pickArray<Goal>(raw, "goals");
  }
  async listGoalPlanNodes(goalIdOrPlanId: string): Promise<GoalPlanNode[]> {
    const raw = await this.t.get(`/goals/${encodeURIComponent(goalIdOrPlanId)}/plan-nodes`);
    return pickArray<GoalPlanNode>(raw, "nodes");
  }
  async listGoalRuns(opts: Parameters<LoopStore["listGoalRuns"]>[0] = {}): Promise<GoalRun[]> {
    const raw = await this.t.get("/goal-runs", { query: clean({ ...opts }) });
    return pickArray<GoalRun>(raw, "goalRuns");
  }

  // ── Runs & receipts ────────────────────────────────────────────────────────────
  async listRuns(opts: Parameters<LoopStore["listRuns"]>[0] = {}): Promise<LoopRun[]> {
    const raw = await this.t.get("/runs", { query: clean({ ...opts, showOutput: true }) });
    return pickArray<LoopRun>(raw, "runs");
  }
  async getRun(id: string): Promise<LoopRun | undefined> {
    try {
      return pickObject<LoopRun>(await this.t.get(`/runs/${encodeURIComponent(id)}`, { query: { showOutput: true } }), "run");
    } catch {
      return undefined;
    }
  }
  async writeRunReceipt(input: WriteRunReceiptInput): Promise<RunReceipt> {
    return pickObject<RunReceipt>(await this.t.post("/receipts", input), "receipt")!;
  }
  async getRunReceipt(runId: string): Promise<RunReceipt | undefined> {
    try {
      return pickObject<RunReceipt>(await this.t.get(`/receipts/${encodeURIComponent(runId)}`), "receipt");
    } catch {
      return undefined;
    }
  }
  async listRunReceipts(opts: Parameters<LoopStore["listRunReceipts"]>[0] = {}): Promise<RunReceipt[]> {
    const raw = await this.t.get("/receipts", { query: clean({ ...opts }) });
    return pickArray<RunReceipt>(raw, "receipts");
  }

  // ── History ──────────────────────────────────────────────────────────────────
  async pruneHistory(opts: PruneHistoryOptions): Promise<PruneHistorySummary> {
    const raw = await this.t.post("/history/prune", {
      maxAgeDays: opts.maxAgeDays,
      keepPerLoop: opts.keepPerLoop,
      dryRun: opts.dryRun,
    });
    return pickObject<PruneHistorySummary>(raw, "history")!;
  }
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve the client store for the current environment: an {@link ApiStore} when
 * the client-flip contract resolves to cloud-http (self_hosted/cloud), else a
 * {@link LocalStore}. Callers hold a {@link LoopStore} and never branch on mode.
 */
export function getStore(env: Env = process.env): LoopStore {
  const resolution = resolveCloudStorage("loops", env as Record<string, string | undefined>);
  if (resolution.transport === "cloud-http") return new ApiStore(resolution.client, resolution.baseUrl);
  return new LocalStore();
}

/** True when the resolved store is the hosted HTTP transport (cloud/self_hosted). */
export function isCloudStore(env: Env = process.env): boolean {
  return resolveCloudStorage("loops", env as Record<string, string | undefined>).transport === "cloud-http";
}
