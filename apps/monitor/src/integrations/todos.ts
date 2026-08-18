/**
 * Todos native adapter (MON-V2-06).
 *
 * Uses one exact package-owned surface: `TodosV1Client` from `@hasna/todos/sdk`
 * (`createTask`, `createTaskComment`, `completeTask`). It never chooses between
 * SDK, CLI, HTTP, or MCP at runtime.
 *
 * Every action is keyed by an `effectKey`. A repeated effect key replays the
 * recorded effect and never calls the client again, so repeated effect keys do
 * not create duplicate tasks (or comments, or completions). Concurrent calls
 * with the same key coalesce onto one in-flight client mutation, so the
 * check-then-act sequence is atomic within the adapter.
 *
 * Failure behaviour: non-required actions record the failure and resolve
 * `ok:false` — the run continues. An action on an adapter created with
 * `required:true` rejects with the recorded failure — including replays of a
 * key whose first attempt failed, so a retried required effect cannot
 * silently resolve `ok:false`.
 *
 * Effect records are kept in a bounded in-memory store. Durability across
 * processes is owned by the shared effects registry (`effects.ts`, MON-V2-03
 * receipts); this adapter accepts any `TodosEffectStore` so the durable store
 * plugs in without changing the action surface.
 */

import { TodosV1Client } from "@hasna/todos/sdk";
import type { AlertRow } from "../db/schema.js";
import type { TodosIntegrationConfig } from "./index.js";

// ── Effect records ─────────────────────────────────────────────────────────

export type TodosEffectKind = "task.create" | "task.comment" | "task.complete";

export interface TodosEffectRecord {
  /** The exact effect key this record belongs to. */
  key: string;
  kind: TodosEffectKind;
  appliedAt: string;
  ok: boolean;
  error?: string;
  result?: unknown;
}

/**
 * Store for effect records. The in-memory implementation is bounded; the
 * future durable effects registry (`effects.ts`) can back this interface
 * without changing the adapter's action surface.
 */
export interface TodosEffectStore {
  get(key: string): TodosEffectRecord | undefined;
  put(record: TodosEffectRecord): void;
}

const DEFAULT_STORE_CAP = 10_000;

/** Bounded in-memory effect store with FIFO eviction. */
export class InMemoryTodosEffectStore implements TodosEffectStore {
  private readonly records = new Map<string, TodosEffectRecord>();
  private readonly cap: number;

  constructor(cap = DEFAULT_STORE_CAP) {
    this.cap = cap;
  }

  get(key: string): TodosEffectRecord | undefined {
    return this.records.get(key);
  }

  put(record: TodosEffectRecord): void {
    this.records.set(record.key, record);
    if (this.records.size > this.cap) {
      // FIFO eviction: the oldest inserted key is dropped first.
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
  }
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface TodosEffectResult<T> {
  key: string;
  /** Whether the underlying action succeeded (or its replay succeeded). */
  ok: boolean;
  /**
   * false when the result was replayed from the effect store — the client was
   * not called again.
   */
  applied: boolean;
  error?: string;
  result?: T;
}

// ── Action specs ────────────────────────────────────────────────────────────

export interface TodosTaskSpec {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  projectId?: string;
  tags?: string[];
}

export interface TodosCommentSpec {
  taskId: string;
  content: string;
  type?: "comment" | "progress" | "note";
}

export interface TodosCompleteInput {
  agent_id?: string;
  test_results?: string;
  commit_hash?: string;
  notes?: string;
}

export interface TodosAdapterOptions {
  client: TodosV1Client;
  effectStore?: TodosEffectStore;
  /** Confirmed failures reject when true (default false). */
  required?: boolean;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export class TodosAdapter {
  private readonly client: TodosV1Client;
  private readonly store: TodosEffectStore;
  private readonly required: boolean;
  /**
   * In-flight effects keyed by effect key. Concurrent calls with the same key
   * coalesce onto the first call's mutation instead of both observing an empty
   * store and issuing duplicate client calls.
   */
  private readonly inFlight = new Map<string, Promise<TodosEffectResult<unknown>>>();

  constructor(options: TodosAdapterOptions) {
    this.client = options.client;
    // Per-adapter store by default: effect keys dedupe within one adapter
    // instance unless a shared store is supplied.
    this.store = options.effectStore ?? new InMemoryTodosEffectStore();
    this.required = options.required ?? false;
  }

  /** Create a task through `TodosV1Client.createTask`. */
  async createTask(
    effectKey: string,
    spec: TodosTaskSpec
  ): Promise<TodosEffectResult<{ taskId: string }>> {
    return this.apply("task.create", effectKey, async () => {
      const res = await this.client.createTask({
        title: spec.title,
        description: spec.description,
        priority: spec.priority,
        project_id: spec.projectId,
        tags: spec.tags,
      });
      const taskId = res.task?.id;
      if (!taskId) {
        throw new Error("todos createTask returned no task id");
      }
      return { taskId };
    });
  }

  /** Post evidence through `TodosV1Client.createTaskComment`. */
  async commentTask(
    effectKey: string,
    spec: TodosCommentSpec
  ): Promise<TodosEffectResult<{ commentId: string }>> {
    return this.apply("task.comment", effectKey, async () => {
      const res = await this.client.createTaskComment(spec.taskId, {
        content: spec.content,
        type: spec.type,
      });
      const commentId = res.comment?.id;
      if (!commentId) {
        throw new Error("todos createTaskComment returned no comment id");
      }
      return { commentId };
    });
  }

  /** Complete a task through `TodosV1Client.completeTask`. */
  async completeTask(
    effectKey: string,
    taskId: string,
    input?: TodosCompleteInput
  ): Promise<TodosEffectResult<{ taskId: string }>> {
    return this.apply("task.complete", effectKey, async () => {
      const res = await this.client.completeTask(taskId, input);
      const completedId = res.task?.id;
      if (!completedId) {
        throw new Error("todos completeTask returned no task id");
      }
      return { taskId: completedId };
    });
  }

  private async apply<T>(
    kind: TodosEffectKind,
    effectKey: string,
    run: () => Promise<T>
  ): Promise<TodosEffectResult<T>> {
    // Atomicity: when the same key is already being applied, join the
    // in-flight effect instead of issuing a second client mutation. The
    // check-store-then-mutate sequence is only safe once per key, so the
    // first caller owns it and concurrent callers await its outcome.
    const pending = this.inFlight.get(effectKey);
    if (pending !== undefined) {
      const joined = (await pending) as TodosEffectResult<T>;
      // The joiner never called the client itself.
      return { ...joined, applied: false };
    }

    const task = this.applyOnce(kind, effectKey, run);
    this.inFlight.set(effectKey, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(effectKey);
    }
  }

  private async applyOnce<T>(
    kind: TodosEffectKind,
    effectKey: string,
    run: () => Promise<T>
  ): Promise<TodosEffectResult<T>> {
    const recorded = this.store.get(effectKey);
    if (recorded !== undefined) {
      if (!recorded.ok && this.required) {
        // A required effect that already failed must keep rejecting on
        // replay — resolving ok:false would silently accept the failure.
        throw new Error(
          recorded.error ?? `todos effect '${effectKey}' previously failed`
        );
      }
      return {
        key: effectKey,
        ok: recorded.ok,
        applied: false,
        error: recorded.error,
        result: recorded.result as T | undefined,
      };
    }

    try {
      const result = await run();
      this.store.put({
        key: effectKey,
        kind,
        appliedAt: new Date().toISOString(),
        ok: true,
        result,
      });
      return { key: effectKey, ok: true, applied: true, result };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      this.store.put({
        key: effectKey,
        kind,
        appliedAt: new Date().toISOString(),
        ok: false,
        error: message,
      });
      if (this.required) {
        throw err instanceof Error ? err : new Error(message);
      }
      return { key: effectKey, ok: false, applied: true, error: message };
    }
  }
}

// ── Transitional alert glue ─────────────────────────────────────────────────

/**
 * Shared store for the transitional alert flow so that processing the same
 * alert row twice in one process replays instead of duplicating.
 */
const alertEffectStore = new InMemoryTodosEffectStore();

const DEFAULT_ALERT_BASE_URL = "http://localhost:3000";

function alertPriority(severity: AlertRow["severity"]): "critical" | "high" | "medium" {
  switch (severity) {
    case "critical":
      return "critical";
    case "warn":
      return "high";
    default:
      return "medium";
  }
}

function taskTitle(alert: AlertRow): string {
  return `ALERT: ${alert.machine_id} ${alert.check_name} — ${alert.message}`;
}

function taskDescription(alert: AlertRow): string {
  return [
    `**Machine:** ${alert.machine_id}`,
    `**Check:** ${alert.check_name}`,
    `**Severity:** ${alert.severity}`,
    `**Message:** ${alert.message}`,
    `**Triggered at:** ${new Date(alert.triggered_at * 1000).toISOString()}`,
    "",
    "Created automatically by Hasna Monitor.",
  ].join("\n");
}

export interface TodosAlertOutcome {
  ok: boolean;
  error?: string;
  /** True when creation was skipped because an open task already exists. */
  skipped?: boolean;
}

/** Size of one listTasks page while hunting for an open task. */
const OPEN_TASK_PAGE_SIZE = 50;
/** Safety bound against a server that never reports its total. */
const OPEN_TASK_MAX_SCANNED = 10_000;

/**
 * Create a task for the given alert through the native todos client.
 *
 * Transitional glue that preserves the legacy behaviour exactly: it skips
 * creation when an open (pending/in_progress) task already exists for the same
 * machine + check, and it dedupes repeated processing of the same alert row via
 * a deterministic effect key. The client comes from the config when injected,
 * otherwise from the configured base URL. Failures are non-fatal to the run —
 * the outcome is returned so the CLI integration test can gate on it.
 */
export async function createTaskForAlert(
  alert: AlertRow,
  config: TodosIntegrationConfig
): Promise<TodosAlertOutcome> {
  const client =
    config.client ??
    new TodosV1Client({
      baseUrl: (config.base_url ?? DEFAULT_ALERT_BASE_URL).replace(/\/$/, ""),
    });

  const adapter = new TodosAdapter({ client, effectStore: alertEffectStore });

  // Legacy dedup: skip when an open task already exists for machine + check.
  // The search failure path preserves the legacy "better to duplicate than
  // miss" behaviour. The search is paged by offset until the server-reported
  // total is exhausted, so a matching task on a later page is not missed.
  let alreadyOpen = false;
  try {
    const checkLower = alert.check_name.toLowerCase();
    const machineLower = alert.machine_id.toLowerCase();
    let offset = 0;
    let scanned = 0;
    while (!alreadyOpen && scanned < OPEN_TASK_MAX_SCANNED) {
      const existing = await client.listTasks({
        project_id: config.project_id,
        limit: OPEN_TASK_PAGE_SIZE,
        offset,
      });
      const tasks = Array.isArray(existing?.tasks) ? existing.tasks : [];
      const total = typeof existing?.total === "number" ? existing.total : -1;
      alreadyOpen = tasks.some(
        (t) =>
          (t.status === "pending" || t.status === "in_progress") &&
          String(t.title ?? "").toLowerCase().includes(machineLower) &&
          String(t.title ?? "").toLowerCase().includes(checkLower)
      );
      scanned += tasks.length;
      if (tasks.length === 0 || (total >= 0 && offset + tasks.length >= total)) {
        break;
      }
      offset += tasks.length;
    }
    if (alreadyOpen) {
      console.error(
        `[monitor:integrations:todos] skipping — open task already exists for ${alert.machine_id}/${alert.check_name}`
      );
      return { ok: true, skipped: true };
    }
  } catch (err) {
    console.error(
      `[monitor:integrations:todos] open-task search failed, proceeding: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // The effect key names this exact alert occurrence. `alert.id` is not
  // unique for synthetic alerts (the MCP doctor caller emits every
  // observation with id: 0), so the key also carries `triggered_at`: two
  // occurrences of the same machine/check at different times must not replay
  // each other's recorded effect, or a later incident would be silently
  // suppressed while its predecessor's task record still exists. Re-processing
  // the SAME row (same id and triggered_at) still replays.
  const effectKey = `alert:${alert.machine_id}:${alert.check_name}:${alert.id}:${alert.triggered_at}`;

  const out = await adapter.createTask(effectKey, {
    title: taskTitle(alert),
    description: taskDescription(alert),
    priority: alertPriority(alert.severity),
    projectId: config.project_id,
    tags: ["monitor", "alert", alert.severity, alert.machine_id],
  });

  if (out.ok) {
    console.error(
      `[monitor:integrations:todos] created task for ${alert.machine_id}/${alert.check_name}`
    );
    return { ok: true };
  }
  console.error(
    `[monitor:integrations:todos] failed to create task for ${alert.machine_id}/${alert.check_name}: ${out.error}`
  );
  return { ok: false, error: out.error };
}
