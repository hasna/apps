import type {
  Agent,
  Plan,
  Project,
  Task,
  TaskHistory,
  TaskList,
  TaskTemplate,
} from "../types/index.js";
import {
  createLocalSqliteTodosStorageAdapter,
  type CreateLocalSqliteTodosStorageAdapterOptions,
} from "./local-sqlite.js";
import {
  createPostgresTodosSyncStore,
  type PostgresTodosSyncStore,
  type TodosPostgresQueryClient,
  type TodosPostgresSyncRecordType,
} from "./postgres-sync.js";
import type {
  TodosStorageAdapter,
  TodosStorageContext,
  TodosStorageSnapshot,
  TodosStorageTombstone,
} from "./interfaces.js";

/**
 * Object types the shadow mirror forwards. Comments are intentionally excluded:
 * the sync snapshot has no comment channel, so they stay local-only during the
 * shadow phase (documented gap; validated data is tasks/projects/plans/agents/
 * task-lists/templates and audit history).
 */
type ShadowSnapshotKey =
  | "tasks"
  | "projects"
  | "plans"
  | "agents"
  | "taskLists"
  | "templates"
  | "auditHistory";

const SNAPSHOT_TO_OBJECT_TYPE: Record<ShadowSnapshotKey, TodosPostgresSyncRecordType> = {
  tasks: "tasks",
  projects: "projects",
  plans: "plans",
  agents: "agents",
  taskLists: "task_lists",
  templates: "templates",
  auditHistory: "audit_history",
};

interface ShadowUpsertOp {
  kind: "upsert";
  key: ShadowSnapshotKey;
  record: Record<string, unknown>;
  context?: TodosStorageContext;
  enqueuedAt: number;
  attempts: number;
}

interface ShadowDeleteOp {
  kind: "delete";
  objectType: TodosPostgresSyncRecordType;
  id: string;
  context?: TodosStorageContext;
  enqueuedAt: number;
  attempts: number;
}

type ShadowOp = ShadowUpsertOp | ShadowDeleteOp;

export interface TodosShadowMirrorMetrics {
  enabled: true;
  /** Ops accepted into the mirror queue (one per successful local write). */
  enqueued: number;
  /** Ops successfully written to the remote sync tables. */
  mirrored: number;
  /** Individual push attempts that failed (includes retries). */
  retries: number;
  /** Ops permanently dropped after exhausting retries — the divergence source. */
  failed: number;
  /**
   * Divergence counter: ops that were written locally but never confirmed in
   * the cloud (currently == `failed`, plus anything still queued on shutdown).
   */
  divergence: number;
  /** Ops still waiting in the queue. */
  pending: number;
  /** Whether the mirror worker is actively draining. */
  inFlight: boolean;
  /** ISO timestamp of the last successful mirror write. */
  lastMirrorAt: string | null;
  /** Milliseconds between the local write and its confirmed mirror. */
  lastLagMs: number | null;
  /** Last mirror error message (redaction is the caller's responsibility). */
  lastError: string | null;
}

export interface CreateShadowTodosStorageAdapterOptions {
  localAdapter?: TodosStorageAdapter;
  local?: CreateLocalSqliteTodosStorageAdapterOptions;
  syncStore?: PostgresTodosSyncStore;
  postgresClient?: TodosPostgresQueryClient;
  sourceMachineId?: string;
  /** Retry attempts per op before it is counted as divergence. Default 5. */
  maxRetries?: number;
  /** Base backoff in ms (exponential). Default 250ms. */
  retryBaseMs?: number;
  /** Ensure the remote sync schema exists before the first push. Default true. */
  ensureSchema?: boolean;
  /** Sink for mirror lifecycle diagnostics (defaults to silent). */
  onEvent?: (event: TodosShadowMirrorEvent) => void;
}

export type TodosShadowMirrorEvent =
  | { type: "mirrored"; objectType: string; id: string; lagMs: number }
  | { type: "retry"; objectType: string; id: string; attempt: number; error: string }
  | { type: "dropped"; objectType: string; id: string; error: string };

/**
 * Fire-and-forget mirror queue: single-flight worker, bounded retries, and a
 * divergence counter for ops that never made it to the cloud. Enqueue calls
 * never throw and never block the local write path.
 */
export class TodosShadowMirror {
  private readonly queue: ShadowOp[] = [];
  private readonly syncStore: PostgresTodosSyncStore;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly onEvent?: (event: TodosShadowMirrorEvent) => void;
  private schemaReady: Promise<void> | null;
  private pumping = false;
  private scheduledRetries = 0;
  private idleResolvers: Array<() => void> = [];

  private metrics = {
    enqueued: 0,
    mirrored: 0,
    retries: 0,
    failed: 0,
    lastMirrorAt: null as string | null,
    lastLagMs: null as number | null,
    lastError: null as string | null,
  };

  constructor(options: CreateShadowTodosStorageAdapterOptions) {
    const syncStore = options.syncStore
      ?? (options.postgresClient
        ? createPostgresTodosSyncStore(options.postgresClient, {
            ...(options.sourceMachineId ? { sourceMachineId: options.sourceMachineId } : {}),
          })
        : null);
    if (!syncStore) {
      throw new Error("shadow mirror requires a Postgres sync store or query client");
    }
    this.syncStore = syncStore;
    this.maxRetries = Math.max(0, options.maxRetries ?? 5);
    this.retryBaseMs = Math.max(1, options.retryBaseMs ?? 250);
    if (options.onEvent) this.onEvent = options.onEvent;
    this.schemaReady = options.ensureSchema === false ? Promise.resolve() : null;
  }

  getMetrics(): TodosShadowMirrorMetrics {
    return {
      enabled: true,
      enqueued: this.metrics.enqueued,
      mirrored: this.metrics.mirrored,
      retries: this.metrics.retries,
      failed: this.metrics.failed,
      divergence: this.metrics.failed + this.queue.length + this.scheduledRetries,
      pending: this.queue.length + this.scheduledRetries,
      inFlight: this.pumping || this.scheduledRetries > 0,
      lastMirrorAt: this.metrics.lastMirrorAt,
      lastLagMs: this.metrics.lastLagMs,
      lastError: this.metrics.lastError,
    };
  }

  enqueueUpsert(key: ShadowSnapshotKey, record: unknown, context?: TodosStorageContext): void {
    if (!record || typeof record !== "object") return;
    const payload = record as Record<string, unknown>;
    if (typeof payload["id"] !== "string" || !payload["id"]) return;
    this.metrics.enqueued += 1;
    this.queue.push({
      kind: "upsert",
      key,
      record: payload,
      ...(context ? { context } : {}),
      enqueuedAt: Date.now(),
      attempts: 0,
    });
    this.pump();
  }

  enqueueDelete(objectType: TodosPostgresSyncRecordType, id: string, context?: TodosStorageContext): void {
    if (!id) return;
    this.metrics.enqueued += 1;
    this.queue.push({
      kind: "delete",
      objectType,
      id,
      ...(context ? { context } : {}),
      enqueuedAt: Date.now(),
      attempts: 0,
    });
    this.pump();
  }

  /** Resolve once the queue and all scheduled retries are fully drained. */
  async flush(): Promise<void> {
    if (this.idle()) return;
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
      this.pump();
    });
  }

  private idle(): boolean {
    return this.queue.length === 0 && !this.pumping && this.scheduledRetries === 0;
  }

  private notifyIdle(): void {
    if (!this.idle()) return;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const op = this.queue.shift()!;
        await this.process(op);
      }
    } finally {
      this.pumping = false;
      this.notifyIdle();
    }
  }

  private async process(op: ShadowOp): Promise<void> {
    try {
      await this.ensureSchema();
      await this.push(op);
      const objectType = op.kind === "upsert" ? SNAPSHOT_TO_OBJECT_TYPE[op.key] : op.objectType;
      const id = op.kind === "upsert" ? String(op.record["id"]) : op.id;
      const lagMs = Date.now() - op.enqueuedAt;
      this.metrics.mirrored += 1;
      this.metrics.lastMirrorAt = new Date().toISOString();
      this.metrics.lastLagMs = lagMs;
      this.onEvent?.({ type: "mirrored", objectType, id, lagMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const objectType = op.kind === "upsert" ? SNAPSHOT_TO_OBJECT_TYPE[op.key] : op.objectType;
      const id = op.kind === "upsert" ? String(op.record["id"]) : op.id;
      this.metrics.retries += 1;
      this.metrics.lastError = message;
      op.attempts += 1;
      if (op.attempts <= this.maxRetries) {
        this.onEvent?.({ type: "retry", objectType, id, attempt: op.attempts, error: message });
        // Re-queue for a later attempt with exponential backoff; never blocks writes.
        const delay = this.retryBaseMs * 2 ** (op.attempts - 1);
        this.scheduledRetries += 1;
        setTimeout(() => {
          this.scheduledRetries -= 1;
          this.queue.push(op);
          this.pump();
        }, delay);
        return;
      }
      this.metrics.failed += 1;
      this.onEvent?.({ type: "dropped", objectType, id, error: message });
    }
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.syncStore.ensureSchema().catch((error) => {
        this.schemaReady = null; // retry schema creation on next op
        throw error;
      });
    }
    return this.schemaReady;
  }

  private async push(op: ShadowOp): Promise<void> {
    const snapshot = emptySnapshot();
    const context = op.context ?? {};
    if (op.kind === "upsert") {
      (snapshot[op.key] as unknown as Record<string, unknown>[]).push(op.record);
    } else {
      const now = new Date().toISOString();
      const tombstone: TodosStorageTombstone = {
        object_type: op.objectType,
        object_id: op.id,
        deleted_at: now,
        updated_at: now,
        payload: { id: op.id, deleted_at: now },
        version: null,
      };
      snapshot.tombstones = [tombstone];
    }
    await this.syncStore.pushSnapshot(snapshot, context);
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

export interface ShadowTodosStorageAdapter extends TodosStorageAdapter {
  readonly shadow: TodosShadowMirror;
}

/**
 * Wrap a local SQLite adapter so that every successful local write is also
 * mirrored (asynchronously, fire-and-forget) to the remote Postgres sync
 * tables. Reads and writes are served entirely by local storage — the remote
 * store is never read from in shadow mode.
 */
export function createShadowTodosStorageAdapter(
  options: CreateShadowTodosStorageAdapterOptions,
): ShadowTodosStorageAdapter {
  const local = options.localAdapter ?? createLocalSqliteTodosStorageAdapter(options.local);
  const mirror = new TodosShadowMirror(options);

  const adapter: ShadowTodosStorageAdapter = {
    ...local,
    kind: "sqlite",
    capabilities: { ...local.capabilities, remotePersistence: false, sync: true },
    tasks: {
      ...local.tasks,
      async create(input, context) {
        const task = await local.tasks.create(input, context);
        mirror.enqueueUpsert("tasks", task, context);
        return task;
      },
      async update(id, input, context) {
        const task = await local.tasks.update(id, input, context);
        mirror.enqueueUpsert("tasks", task, context);
        return task;
      },
      async start(id, agentId, context) {
        const task = await local.tasks.start(id, agentId, context);
        mirror.enqueueUpsert("tasks", task, context);
        return task;
      },
      async complete(id, agentId, opts, context) {
        const task = await local.tasks.complete(id, agentId, opts, context);
        mirror.enqueueUpsert("tasks", task, context);
        return task;
      },
      async fail(id, agentId, reason, opts, context) {
        const result = await local.tasks.fail(id, agentId, reason, opts, context);
        mirror.enqueueUpsert("tasks", result.task, context);
        if (result.retryTask) mirror.enqueueUpsert("tasks", result.retryTask, context);
        return result;
      },
      async claimNext(agentId, filters, context) {
        const task = await local.tasks.claimNext(agentId, filters, context);
        if (task) mirror.enqueueUpsert("tasks", task, context);
        return task;
      },
      async delete(id, context) {
        const deleted = await local.tasks.delete(id, context);
        if (deleted) mirror.enqueueDelete("tasks", id, context);
        return deleted;
      },
    },
    projects: {
      ...local.projects,
      async create(input, context) {
        const project = await local.projects.create(input, context);
        mirror.enqueueUpsert("projects", project, context);
        return project;
      },
      async update(id, input, context) {
        const project = await local.projects.update(id, input, context);
        mirror.enqueueUpsert("projects", project, context);
        return project;
      },
      async delete(id, context) {
        const deleted = await local.projects.delete(id, context);
        if (deleted) mirror.enqueueDelete("projects", id, context);
        return deleted;
      },
    },
    plans: {
      ...local.plans,
      async create(input, context) {
        const plan = await local.plans.create(input, context);
        mirror.enqueueUpsert("plans", plan, context);
        return plan;
      },
      async update(id, input, context) {
        const plan = await local.plans.update(id, input, context);
        mirror.enqueueUpsert("plans", plan, context);
        return plan;
      },
      async delete(id, context) {
        const deleted = await local.plans.delete(id, context);
        if (deleted) mirror.enqueueDelete("plans", id, context);
        return deleted;
      },
    },
    agents: {
      ...local.agents,
      async register(input, context) {
        const result = await local.agents.register(input, context);
        if (isAgent(result)) mirror.enqueueUpsert("agents", result, context);
        return result;
      },
      async update(id, input, context) {
        const agent = await local.agents.update(id, input, context);
        if (agent) mirror.enqueueUpsert("agents", agent, context);
        return agent;
      },
    },
    taskLists: {
      ...local.taskLists,
      async create(input, context) {
        const list = await local.taskLists.create(input, context);
        mirror.enqueueUpsert("taskLists", list, context);
        return list;
      },
      async update(id, input, context) {
        const list = await local.taskLists.update(id, input, context);
        mirror.enqueueUpsert("taskLists", list, context);
        return list;
      },
      async delete(id, context) {
        const deleted = await local.taskLists.delete(id, context);
        if (deleted) mirror.enqueueDelete("task_lists", id, context);
        return deleted;
      },
    },
    templates: {
      ...local.templates,
      async create(input, context) {
        const template = await local.templates.create(input, context);
        mirror.enqueueUpsert("templates", template, context);
        return template;
      },
      async update(id, input, context) {
        const template = await local.templates.update(id, input, context);
        if (template) mirror.enqueueUpsert("templates", template, context);
        return template;
      },
      async delete(id, context) {
        const deleted = await local.templates.delete(id, context);
        if (deleted) mirror.enqueueDelete("templates", id, context);
        return deleted;
      },
    },
    audit: {
      ...local.audit,
      async logTaskChange(taskId, action, field, oldValue, newValue, agentId, context) {
        const history = await local.audit.logTaskChange(
          taskId,
          action,
          field,
          oldValue,
          newValue,
          agentId,
          context,
        );
        mirror.enqueueUpsert("auditHistory", history, context);
        return history;
      },
    },
    shadow: mirror,
  };

  if (adapter.transaction) {
    const localTransaction = local.transaction!;
    adapter.transaction = <T>(
      fn: (a: TodosStorageAdapter) => T | Promise<T>,
      context?: TodosStorageContext,
    ) => localTransaction((): T | Promise<T> => fn(adapter), context);
  }

  return adapter;
}

function isAgent(value: Agent | { conflict: true; message: string }): value is Agent {
  return !(value as { conflict?: true }).conflict;
}

// Type-only guards so downstream refactors keep the mirror payloads honest.
export type ShadowMirroredTask = Task;
export type ShadowMirroredProject = Project;
export type ShadowMirroredPlan = Plan;
export type ShadowMirroredAgent = Agent;
export type ShadowMirroredTaskList = TaskList;
export type ShadowMirroredTemplate = TaskTemplate;
export type ShadowMirroredHistory = TaskHistory;
