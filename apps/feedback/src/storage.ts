import { existsSync, mkdirSync } from "node:fs";
import { appendFile, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  FeedbackCreateOptions,
  FeedbackInput,
  FeedbackItem,
  FeedbackListFilter,
  FeedbackStats,
  FeedbackStatus,
  FeedbackStore,
  FeedbackSyncTasksResult,
} from "./types.js";
import { createTaskSink } from "./tasks.js";
import type { FeedbackTaskSink } from "./tasks.js";
import {
  feedbackKinds,
  feedbackStatuses,
  parseFeedbackInput,
  parseStoredFeedbackItem,
  truncateTaskError,
} from "./validation.js";
import {
  buildFeedbackCreatedEvent,
  buildFeedbackTriagedEvent,
  createDefaultFeedbackEventSink,
  emitFeedbackEvent,
} from "./events.js";
import type { FeedbackEventSink } from "./events.js";

export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "feedback");
export const DEFAULT_FEEDBACK_FILE = "feedback.jsonl";

export interface LocalFeedbackStoreOptions {
  dataDir?: string;
  filePath?: string;
  /**
   * Sink for `feedback.created` / `feedback.triaged` event envelopes
   * (distribution event catalog). Defaults to emitting through
   * `@hasna/events`; pass `null` to disable emission.
   */
  eventSink?: FeedbackEventSink | null;
  /**
   * Sink that turns new feedback into a task an executor can pick up. Defaults
   * to the environment-resolved sink (`todos` when its CLI is present); pass
   * `null` to disable task creation.
   */
  taskSink?: FeedbackTaskSink | null;
}

export type FeedbackStoreRuntimeMode = "local" | "cloud";
export type FeedbackStoreRuntimeDiagnosticMode = FeedbackStoreRuntimeMode | "invalid";

export interface FeedbackStoreRuntimeOptions {
  env?: Record<string, string | undefined>;
  local?: LocalFeedbackStoreOptions;
  cloudStore?: FeedbackStore;
}

export interface FeedbackCloudRuntimeDiagnostics {
  provider: string;
  databaseUrlConfigured: boolean;
  resourceArnConfigured: boolean;
  secretArnConfigured: boolean;
  tableNameConfigured: boolean;
  adapterProvided: boolean;
  ready: boolean;
  blockers: string[];
}

export interface FeedbackStoreRuntimeDiagnostics {
  mode: FeedbackStoreRuntimeDiagnosticMode;
  requestedMode: FeedbackStoreRuntimeDiagnosticMode;
  activeStore: "local-jsonl" | "cloud-adapter" | "unavailable";
  ok: boolean;
  local?: {
    dataFile: string;
  };
  cloud?: FeedbackCloudRuntimeDiagnostics;
  blockers: string[];
}

export function resolveFeedbackDataDir(dataDir = process.env["FEEDBACK_DATA_DIR"]): string {
  return dataDir && dataDir.trim() ? dataDir : DEFAULT_DATA_DIR;
}

export function resolveFeedbackFilePath(options: LocalFeedbackStoreOptions = {}): string {
  return options.filePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_FEEDBACK_FILE);
}

function runtimeModeFromEnv(env: Record<string, string | undefined>): FeedbackStoreRuntimeDiagnostics["mode"] {
  const rawMode = (env["FEEDBACK_STORE"] ?? env["FEEDBACK_STORAGE_BACKEND"] ?? "local").trim().toLowerCase();
  if (!rawMode || rawMode === "local" || rawMode === "jsonl" || rawMode === "file") return "local";
  if (rawMode === "cloud" || rawMode === "rds" || rawMode === "postgres" || rawMode === "postgresql") return "cloud";
  return "invalid";
}

function cloudDiagnostics(options: FeedbackStoreRuntimeOptions): FeedbackCloudRuntimeDiagnostics {
  const env = options.env ?? process.env;
  const adapterProvided = Boolean(options.cloudStore);
  const provider = env["FEEDBACK_CLOUD_PROVIDER"]?.trim() || "custom";
  const databaseUrlConfigured = Boolean(env["FEEDBACK_CLOUD_DATABASE_URL"]?.trim());
  const resourceArnConfigured = Boolean(env["FEEDBACK_CLOUD_RESOURCE_ARN"]?.trim());
  const secretArnConfigured = Boolean(env["FEEDBACK_CLOUD_SECRET_ARN"]?.trim());
  const tableNameConfigured = Boolean(env["FEEDBACK_CLOUD_TABLE"]?.trim());
  const blockers: string[] = [];

  if (!adapterProvided) {
    blockers.push("Cloud storage mode requires a host-provided FeedbackStore adapter.");
  }

  return {
    provider,
    databaseUrlConfigured,
    resourceArnConfigured,
    secretArnConfigured,
    tableNameConfigured,
    adapterProvided,
    ready: blockers.length === 0,
    blockers,
  };
}

export function describeFeedbackStoreRuntime(options: FeedbackStoreRuntimeOptions = {}): FeedbackStoreRuntimeDiagnostics {
  const env = options.env ?? process.env;
  const mode = runtimeModeFromEnv(env);
  const requestedMode = mode;

  if (mode === "local") {
    const dataFile = resolveFeedbackFilePath({
      dataDir: options.local?.dataDir ?? env["FEEDBACK_DATA_DIR"],
      filePath: options.local?.filePath,
    });
    return {
      mode,
      requestedMode,
      activeStore: "local-jsonl",
      ok: true,
      local: { dataFile },
      blockers: [],
    };
  }

  if (mode === "cloud") {
    const cloud = cloudDiagnostics(options);
    return {
      mode,
      requestedMode,
      activeStore: cloud.adapterProvided ? "cloud-adapter" : "unavailable",
      ok: cloud.ready,
      cloud,
      blockers: cloud.blockers,
    };
  }

  return {
    mode,
    requestedMode,
    activeStore: "unavailable",
    ok: false,
    blockers: [
      "Unsupported FEEDBACK_STORE/FEEDBACK_STORAGE_BACKEND value. Use \"local\" or \"cloud\".",
    ],
  };
}

export function createFeedbackStore(options: FeedbackStoreRuntimeOptions = {}): FeedbackStore {
  const runtime = describeFeedbackStoreRuntime(options);
  if (runtime.mode === "local") {
    return new LocalFeedbackStore({
      dataDir: options.local?.dataDir ?? options.env?.["FEEDBACK_DATA_DIR"],
      filePath: options.local?.filePath,
    });
  }
  if (runtime.mode === "cloud" && options.cloudStore) {
    return options.cloudStore;
  }
  throw new Error(runtime.blockers.join(" "));
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function emptyStats(): FeedbackStats {
  return {
    total: 0,
    byApp: {},
    byKind: Object.fromEntries(feedbackKinds.map((kind) => [kind, 0])) as FeedbackStats["byKind"],
    byStatus: Object.fromEntries(feedbackStatuses.map((status) => [status, 0])) as FeedbackStats["byStatus"],
    bySeverity: {},
  };
}

function parseDateFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function searchHaystack(item: FeedbackItem): string {
  return [
    item.appId,
    item.message,
    item.kind,
    item.severity,
    item.status,
    item.userId,
    item.email,
    item.url,
    item.tags.join(" "),
    item.context ? JSON.stringify(item.context) : "",
    item.metadata ? JSON.stringify(item.metadata) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyFilter(items: FeedbackItem[], filter: FeedbackListFilter = {}): FeedbackItem[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 500));
  const since = parseDateFilter(filter.since);
  const until = parseDateFilter(filter.until);
  const search = filter.search?.trim().toLowerCase();
  return items
    .filter((item) => !filter.appId || item.appId === filter.appId)
    .filter((item) => !filter.status || item.status === filter.status)
    .filter((item) => !filter.tag || item.tags.includes(filter.tag.toLowerCase()))
    .filter((item) => !since || item.createdAt >= since)
    .filter((item) => !until || item.createdAt <= until)
    .filter((item) => !search || searchHaystack(item).includes(search))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/**
 * Raised when the data lock could not be acquired. Typed so callers can tell
 * "server is busy, retry" from "your request was bad" — an HTTP 400 tells a
 * client not to retry, which is exactly wrong for contention.
 */
export class FeedbackStoreBusyError extends Error {
  readonly code = "FEEDBACK_STORE_BUSY";
  constructor(message: string) {
    super(message);
    this.name = "FeedbackStoreBusyError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock<T>(filePath: string, run: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      try {
        return await run();
      } finally {
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > 30_000) await rm(lockPath, { force: true });
      } catch {
        // Lock disappeared between attempts.
      }
      if (Date.now() > deadline) throw new FeedbackStoreBusyError(`Timed out waiting for feedback data lock: ${lockPath}`);
      await delay(50);
    }
  }
}

export class LocalFeedbackStore implements FeedbackStore {
  readonly filePath: string;
  private readonly eventSink: FeedbackEventSink | null;
  private readonly taskSink: FeedbackTaskSink | null;

  constructor(options: LocalFeedbackStoreOptions = {}) {
    this.filePath = resolveFeedbackFilePath(options);
    ensureParentDir(this.filePath);
    this.eventSink = options.eventSink === null ? null : options.eventSink ?? createDefaultFeedbackEventSink();
    this.taskSink = options.taskSink === null ? null : options.taskSink ?? createTaskSink();
  }

  async createFeedback(input: FeedbackInput, options: FeedbackCreateOptions = {}): Promise<FeedbackItem> {
    const now = (options.now ?? new Date()).toISOString();
    const parsed = parseFeedbackInput(input);
    const item: FeedbackItem = {
      ...parsed,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "new",
      source: options.source ?? "server",
      kind: parsed.kind ?? "other",
      tags: parsed.tags ?? [],
    };
    // Durability first: the report is on disk before anything downstream runs,
    // so a failing task sink can never cost us the feedback itself.
    //
    // The attempt marker goes in this SAME first write. Without it, a crash
    // between "task created" and "link recorded" is indistinguishable from
    // "never attempted", and the repair path files a duplicate task.
    const stored: FeedbackItem = this.taskSink
      ? { ...item, taskAttempt: { startedAt: now, attempts: 1 } }
      : item;
    await this.appendItem(stored);
    if (this.eventSink) await emitFeedbackEvent(buildFeedbackCreatedEvent(item), this.eventSink);
    return this.attachTask(stored);
  }

  /**
   * Append one record. The create path must stay append-only: rewriting the
   * whole file under the lock is O(n) and, under concurrency, blew the lock
   * deadline and dropped reports outright.
   */
  private async appendItem(item: FeedbackItem): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await appendFile(this.filePath, `${JSON.stringify(item)}\n`, "utf8");
    });
  }

  /**
   * Create the task for a feedback item and record the outcome by appending an
   * updated record. Runs outside the file lock because task creation spawns a
   * process.
   *
   * This never rejects once the report is stored. Rejecting here would drop
   * the caller's only copy of the feedback id while the report sat on disk.
   */
  private async attachTask(item: FeedbackItem): Promise<FeedbackItem> {
    if (!this.taskSink) return item;
    let next: FeedbackItem;
    try {
      next = { ...item, taskRef: await this.taskSink.createTask(item), taskError: undefined };
    } catch (error) {
      next = { ...item, taskError: truncateTaskError(error instanceof Error ? error.message : String(error)) };
    }
    try {
      await this.appendItem(next);
    } catch {
      // The linkage record could not be written. The report itself is already
      // durable, and its attempt marker is on disk, so `sync-tasks` will
      // report it as uncertain rather than silently duplicating the task.
    }
    return next;
  }

  /**
   * Retry task creation for feedback that has no task yet. This is the repair
   * path for feedback captured while the task sink was down or unconfigured —
   * without it, an outage would silently leave the loop open.
   *
   * Items whose previous attempt recorded no outcome are reported as
   * `uncertain` and skipped: a task may already exist for them, and filing a
   * second one is worse than leaving a human to check.
   */
  async syncTasks(options: { limit?: number; retryUncertain?: boolean } = {}): Promise<FeedbackSyncTasksResult> {
    const result: FeedbackSyncTasksResult = {
      sinkConfigured: Boolean(this.taskSink),
      created: 0,
      failed: 0,
      skipped: 0,
      uncertain: 0,
      remaining: 0,
      errors: [],
    };
    if (!this.taskSink) return result;

    const items = await this.readAll();
    const unlinked = items.filter((item) => !item.taskRef);
    result.skipped = items.length - unlinked.length;

    // A recorded taskError means we KNOW the attempt failed, so retrying is
    // safe. An attempt marker with no recorded outcome means we do not know.
    const uncertain = unlinked.filter((item) => item.taskAttempt && !item.taskError);
    const safe = unlinked.filter((item) => !(item.taskAttempt && !item.taskError));
    const queue = options.retryUncertain ? [...safe, ...uncertain] : safe;
    if (!options.retryUncertain) result.uncertain = uncertain.length;

    const batch = queue.slice(0, options.limit ?? queue.length);
    result.remaining = queue.length - batch.length;

    for (const item of batch) {
      const attempts = (item.taskAttempt?.attempts ?? 0) + 1;
      const attempted: FeedbackItem = {
        ...item,
        taskAttempt: { startedAt: new Date().toISOString(), attempts },
      };
      try {
        await this.appendItem(attempted);
      } catch {
        // Best effort: a missing marker only costs us duplicate-detection.
      }
      try {
        const taskRef = await this.taskSink.createTask(item);
        await this.appendItem({ ...attempted, taskRef, taskError: undefined });
        result.created += 1;
      } catch (error) {
        const message = truncateTaskError(error instanceof Error ? error.message : String(error));
        await this.appendItem({ ...attempted, taskError: message }).catch(() => {});
        result.failed += 1;
        result.errors.push(`${item.id}: ${message}`);
      }
    }
    return result;
  }

  async listFeedback(filter: FeedbackListFilter = {}): Promise<FeedbackItem[]> {
    return applyFilter(await this.readAll(), filter);
  }

  async getFeedback(id: string): Promise<FeedbackItem | null> {
    return (await this.readAll()).find((item) => item.id === id) ?? null;
  }

  async updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem | null> {
    const updated = await withFileLock(this.filePath, async () => {
      const items = await this.readAll();
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const current = items[index]!;
      const next: FeedbackItem = {
        ...current,
        status,
        updatedAt: new Date().toISOString(),
      };
      items[index] = next;
      await this.writeAll(items);
      return next;
    });
    if (updated && status !== "new" && this.eventSink) {
      await emitFeedbackEvent(buildFeedbackTriagedEvent(updated, status), this.eventSink);
    }
    return updated;
  }

  /**
   * Changelog-entry linkage: mark feedback as shipped, record the changelog
   * ref + shippedAt, and emit the `feedback.triaged` notification event with
   * disposition "shipped".
   */
  async markFeedbackShipped(id: string, changelogRef: string): Promise<FeedbackItem | null> {
    const ref = changelogRef?.trim();
    if (!ref) throw new Error("changelogRef is required to mark feedback shipped");
    const updated = await withFileLock(this.filePath, async () => {
      const items = await this.readAll();
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const current = items[index]!;
      const now = new Date().toISOString();
      const next: FeedbackItem = {
        ...current,
        status: "shipped",
        changelogRef: ref,
        shippedAt: now,
        updatedAt: now,
      };
      items[index] = next;
      await this.writeAll(items);
      return next;
    });
    if (updated && this.eventSink) {
      await emitFeedbackEvent(buildFeedbackTriagedEvent(updated, "shipped"), this.eventSink);
    }
    return updated;
  }

  async stats(): Promise<FeedbackStats> {
    const stats = emptyStats();
    for (const item of await this.readAll()) {
      stats.total += 1;
      stats.byApp[item.appId] = (stats.byApp[item.appId] ?? 0) + 1;
      stats.byKind[item.kind] += 1;
      stats.byStatus[item.status] += 1;
      if (item.severity) stats.bySeverity[item.severity] = (stats.bySeverity[item.severity] ?? 0) + 1;
    }
    return stats;
  }

  async exportJsonl(filter: FeedbackListFilter = {}): Promise<string> {
    const items = await this.listFeedback({ ...filter, limit: filter.limit ?? 500 });
    return items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
  }

  /**
   * The file is an append-only log: a feedback item may appear more than once,
   * with later records superseding earlier ones (that is how task linkage is
   * recorded without rewriting the file). Fold by id, last record wins.
   * `writeAll` compacts the log back to one record per item.
   */
  async readAll(): Promise<FeedbackItem[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf8");
    const byId = new Map<string, FeedbackItem>();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const item = parseStoredFeedbackItem(JSON.parse(trimmed));
      byId.set(item.id, item);
    }
    return [...byId.values()];
  }

  private async writeAll(items: FeedbackItem[]): Promise<void> {
    ensureParentDir(this.filePath);
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""), "utf8");
    await rename(tmpPath, this.filePath);
  }
}
