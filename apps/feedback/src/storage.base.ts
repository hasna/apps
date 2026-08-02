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
import type { FeedbackTaskSink } from "./tasks.js";
import {
  feedbackKinds,
  feedbackStatuses,
  isFeedbackLinkageDelta,
  parseFeedbackInput,
  parseFeedbackLinkageDelta,
  parseStoredFeedbackItem,
  truncateTaskError,
} from "./validation.js";
import type { FeedbackLinkageDelta } from "./validation.js";
import {
  buildFeedbackCreatedEvent,
  buildFeedbackTriagedEvent,
  emitFeedbackEvent,
} from "./events.js";
import type { FeedbackEventSink } from "./events.js";

function emptyStats(): FeedbackStats {
  return {
    total: 0,
    byApp: {},
    byKind: Object.fromEntries(feedbackKinds.map((kind) => [kind, 0])) as FeedbackStats["byKind"],
    byStatus: Object.fromEntries(feedbackStatuses.map((status) => [status, 0])) as FeedbackStats["byStatus"],
    bySeverity: {},
  };
}

/**
 * Aggregate a set of items into the SDK's canonical {@link FeedbackStats} shape.
 *
 * Every kind and status is zero-filled rather than omitted, so a caller can index
 * the result without guarding for undefined. Exported alongside
 * {@link applyFeedbackFilter} so a custom store reports stats identically to the
 * bundled ones.
 */
export function computeFeedbackStats(items: readonly FeedbackItem[]): FeedbackStats {
  const stats = emptyStats();
  for (const item of items) {
    stats.total += 1;
    stats.byApp[item.appId] = (stats.byApp[item.appId] ?? 0) + 1;
    stats.byKind[item.kind] += 1;
    stats.byStatus[item.status] += 1;
    if (item.severity) stats.bySeverity[item.severity] = (stats.bySeverity[item.severity] ?? 0) + 1;
  }
  return stats;
}

function parseDateFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Fold every searchable field of an item into one lowercased string.
 *
 * Exported because a store backed by something other than the bundled JSONL
 * file has to reproduce this to keep `search` filtering consistent, and two
 * shipped consumers were hand-copying it for exactly that reason.
 */
export function buildFeedbackSearchHaystack(item: FeedbackItem): string {
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

/**
 * Apply the SDK's canonical list semantics — field filters, date range, free-text
 * search, newest-first ordering, and the 1..500 limit clamp — to an already-loaded
 * set of items.
 *
 * Exported so that a custom {@link FeedbackStore} can guarantee parity with the
 * bundled stores instead of reimplementing the rules. Backends that can push these
 * predicates down into a query should still route their final result through this
 * function, or use it as the reference the query is tested against.
 */
export function applyFeedbackFilter(items: FeedbackItem[], filter: FeedbackListFilter = {}): FeedbackItem[] {
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
    .filter((item) => !search || buildFeedbackSearchHaystack(item).includes(search))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Merge a field-level linkage patch onto an item. `null` clears a field. */
export function applyLinkageDelta(item: FeedbackItem, delta: FeedbackLinkageDelta): FeedbackItem {
  const next: FeedbackItem = { ...item };
  if (delta.taskRef !== undefined) {
    if (delta.taskRef === null) delete next.taskRef;
    else next.taskRef = delta.taskRef;
  }
  if (delta.taskError !== undefined) {
    if (delta.taskError === null) delete next.taskError;
    else next.taskError = delta.taskError;
  }
  if (delta.taskAttempt !== undefined) {
    if (delta.taskAttempt === null) delete next.taskAttempt;
    else next.taskAttempt = delta.taskAttempt;
  }
  return next;
}

/**
 * Fold the JSONL log into one record per item.
 *
 * The file is an append-only log: a feedback item may appear more than once,
 * with later records superseding earlier ones (that is how task linkage is
 * recorded without rewriting the file). Fold by id, last record wins.
 *
 * Shared rather than duplicated because the SQLite migration has to read the
 * legacy file with byte-identical semantics — a migration that folded
 * differently would silently revert task links and status changes.
 */
export function foldFeedbackRecords(raw: string): FeedbackItem[] {
  const byId = new Map<string, FeedbackItem>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record: unknown = JSON.parse(trimmed);
    if (isFeedbackLinkageDelta(record)) {
      const delta = parseFeedbackLinkageDelta(record);
      const existing = byId.get(delta.id);
      // A patch for an item we have not seen has nothing to merge onto.
      if (existing) byId.set(delta.id, applyLinkageDelta(existing, delta));
      continue;
    }
    const item = parseStoredFeedbackItem(record);
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** Serialise items to the canonical JSONL export wire format. */
export function serialiseFeedbackJsonl(items: readonly FeedbackItem[]): string {
  return items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
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

export interface FeedbackStoreBaseOptions {
  eventSink?: FeedbackEventSink | null;
  taskSink?: FeedbackTaskSink | null;
}

/**
 * The behaviour every bundled backend shares: the create → event → task
 * sequence, the task repair path, and the read-side semantics.
 *
 * Backends supply four persistence primitives and inherit everything else, so
 * the JSONL and SQLite stores cannot drift apart on lifecycle rules. The split
 * is deliberate about WHICH primitive each path uses: creates append, updates
 * replace, and linkage arrives as a patch. Collapsing those into one "write"
 * would reintroduce two bugs the JSONL store already paid for — an O(n) rewrite
 * on the hot create path that blew the lock deadline under concurrency, and a
 * whole-item snapshot for task linkage that reverted any status change landing
 * meanwhile.
 */
export abstract class FeedbackStoreBase implements FeedbackStore {
  protected readonly eventSink: FeedbackEventSink | null;
  protected readonly taskSink: FeedbackTaskSink | null;
  private mutationTail: Promise<unknown> = Promise.resolve();

  protected constructor(eventSink: FeedbackEventSink | null, taskSink: FeedbackTaskSink | null) {
    this.eventSink = eventSink;
    this.taskSink = taskSink;
  }

  /**
   * Run `run` after every previously-queued mutation on this instance has
   * settled.
   *
   * A cross-process lock (a lock file, `BEGIN IMMEDIATE`) does not serialise
   * two `await`s issued from the SAME process against the same handle, and a
   * read-modify-write that interleaves loses an update. A depth counter is NOT
   * a substitute: a second concurrent caller observes the first caller's depth
   * and concludes it is already inside the critical section, which is exactly
   * how a lost-update regression got written here once.
   */
  protected serialise<T>(run: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(run, run);
    this.mutationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Persist a brand-new item. Must not rewrite existing records. */
  protected abstract appendNew(item: FeedbackItem): Promise<void>;

  /** Replace an existing item wholesale. Called only from inside {@link mutate}. */
  protected abstract putItem(item: FeedbackItem): Promise<void>;

  /** Apply a field-level linkage patch. A patch for an unknown id is a no-op. */
  protected abstract patchItem(delta: FeedbackLinkageDelta): Promise<void>;

  /** Serialise a read-modify-write against the backend. */
  protected abstract mutate<T>(run: () => Promise<T>): Promise<T>;

  abstract readAll(): Promise<FeedbackItem[]>;

  /** Backends with a targeted lookup should override this O(n) default. */
  protected async readItem(id: string): Promise<FeedbackItem | null> {
    return (await this.readAll()).find((item) => item.id === id) ?? null;
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
    // Durability first: the report is stored before anything downstream runs,
    // so a failing task sink can never cost us the feedback itself.
    //
    // The attempt marker goes in this SAME first write. Without it, a crash
    // between "task created" and "link recorded" is indistinguishable from
    // "never attempted", and the repair path files a duplicate task.
    const stored: FeedbackItem = this.taskSink
      ? { ...item, taskAttempt: { startedAt: now, attempts: 1 } }
      : item;
    await this.appendNew(stored);
    if (this.eventSink) await emitFeedbackEvent(buildFeedbackCreatedEvent(item), this.eventSink);
    return this.attachTask(stored);
  }

  /**
   * Create the task for a feedback item and record the outcome. Runs outside
   * the backend lock because task creation spawns a process.
   *
   * This never rejects once the report is stored. Rejecting here would drop
   * the caller's only copy of the feedback id while the report sat on disk.
   */
  private async attachTask(item: FeedbackItem): Promise<FeedbackItem> {
    if (!this.taskSink) return item;
    let taskRef: FeedbackItem["taskRef"];
    let taskError: string | undefined;
    try {
      taskRef = await this.taskSink.createTask(item);
    } catch (error) {
      taskError = truncateTaskError(error instanceof Error ? error.message : String(error));
    }

    const delta: FeedbackLinkageDelta = taskRef
      ? { patch: "task", id: item.id, taskRef, taskError: null }
      : { patch: "task", id: item.id, taskError: taskError! };

    try {
      await this.patchItem(delta);
    } catch (error) {
      // The linkage record could not be written. Report what is actually
      // stored — claiming a taskRef we failed to persist would assert a
      // durability we do not have. `sync-tasks` sees the attempt marker and
      // reports it as uncertain rather than duplicating the task.
      const detail = taskRef
        ? `task ${taskRef.taskId} was created but its link could not be stored`
        : "task creation failed and the failure could not be stored";
      const message = error instanceof Error ? error.message : String(error);
      return { ...item, taskRef: undefined, taskError: truncateTaskError(`${detail}: ${message}`) };
    }

    return taskRef ? { ...item, taskRef, taskError: undefined } : { ...item, taskError };
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
      const attempt = { startedAt: new Date().toISOString(), attempts };
      try {
        await this.patchItem({ patch: "task", id: item.id, taskAttempt: attempt });
      } catch {
        // Best effort: a missing marker only costs us duplicate-detection.
      }
      try {
        const taskRef = await this.taskSink.createTask(item);
        await this.patchItem({ patch: "task", id: item.id, taskRef, taskError: null });
        result.created += 1;
      } catch (error) {
        const message = truncateTaskError(error instanceof Error ? error.message : String(error));
        await this.patchItem({ patch: "task", id: item.id, taskError: message }).catch(() => {});
        result.failed += 1;
        result.errors.push(`${item.id}: ${message}`);
      }
    }
    return result;
  }

  async listFeedback(filter: FeedbackListFilter = {}): Promise<FeedbackItem[]> {
    return applyFeedbackFilter(await this.readAll(), filter);
  }

  async getFeedback(id: string): Promise<FeedbackItem | null> {
    return this.readItem(id);
  }

  async updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem | null> {
    const updated = await this.mutate(async () => {
      const current = await this.readItem(id);
      if (!current) return null;
      const next: FeedbackItem = { ...current, status, updatedAt: new Date().toISOString() };
      await this.putItem(next);
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
    const updated = await this.mutate(async () => {
      const current = await this.readItem(id);
      if (!current) return null;
      const now = new Date().toISOString();
      const next: FeedbackItem = { ...current, status: "shipped", changelogRef: ref, shippedAt: now, updatedAt: now };
      await this.putItem(next);
      return next;
    });
    if (updated && this.eventSink) {
      await emitFeedbackEvent(buildFeedbackTriagedEvent(updated, "shipped"), this.eventSink);
    }
    return updated;
  }

  async stats(): Promise<FeedbackStats> {
    return computeFeedbackStats(await this.readAll());
  }

  /**
   * JSONL is an EXPORT format here, not the storage format. Every backend
   * produces the same bytes for the same items.
   */
  async exportJsonl(filter: FeedbackListFilter = {}): Promise<string> {
    return serialiseFeedbackJsonl(await this.listFeedback({ ...filter, limit: filter.limit ?? 500 }));
  }
}
