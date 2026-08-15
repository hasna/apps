export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type FeedbackKind = "bug" | "idea" | "question" | "praise" | "other";
export type FeedbackSeverity = "low" | "medium" | "high" | "critical";
export type FeedbackStatus = "new" | "triaged" | "shipped" | "closed";
export type FeedbackSource = "api" | "cli" | "sdk" | "mcp" | "server";

export interface FeedbackContext {
  route?: string;
  screen?: string;
  url?: string;
  version?: string;
  commit?: string;
  environment?: string;
  userAgent?: string;
  sessionId?: string;
  locale?: string;
  viewport?: string;
  [key: string]: JsonValue | undefined;
}

export interface FeedbackInput {
  appId: string;
  message: string;
  kind?: FeedbackKind;
  severity?: FeedbackSeverity;
  userId?: string;
  email?: string;
  url?: string;
  rating?: number;
  tags?: string[];
  metadata?: JsonObject;
  context?: FeedbackContext;
}

/**
 * Link from a feedback item to the task an executor can pick up. This is the
 * hop that closes the loop: report → task → PR.
 */
export interface FeedbackTaskRef {
  /** Which sink created it, e.g. "todos" or a custom command name. */
  provider: string;
  taskId: string;
  /** Human-facing id when the provider has one, e.g. "ALU-00042". */
  shortId?: string;
  project?: string;
  createdAt: string;
}

export interface FeedbackItem extends FeedbackInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: FeedbackStatus;
  source: FeedbackSource;
  kind: FeedbackKind;
  tags: string[];
  /**
   * Changelog-entry linkage: id/URI of the changelog entry that shipped this
   * feedback (set by `feedback shipped <id>`).
   */
  changelogRef?: string;
  /** When the feedback was marked shipped. */
  shippedAt?: string;
  /** The task created for this feedback, when a task sink is configured. */
  taskRef?: FeedbackTaskRef;
  /**
   * Why task creation failed, when it did. Recorded rather than swallowed so
   * `feedback sync-tasks` can retry it and operators can see an open loop.
   * Truncated on write to the schema bound — see `truncateTaskError`.
   */
  taskError?: string;
  /**
   * Written BEFORE task creation is attempted. Its presence without a
   * `taskRef` or a `taskError` means the outcome is unknown — a task may
   * already exist — so the repair path must not blindly file another one.
   */
  taskAttempt?: {
    startedAt: string;
    attempts: number;
  };
}

export interface FeedbackListFilter {
  appId?: string;
  status?: FeedbackStatus;
  tag?: string;
  search?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface FeedbackStats {
  total: number;
  byApp: Record<string, number>;
  byKind: Record<FeedbackKind, number>;
  byStatus: Record<FeedbackStatus, number>;
  bySeverity: Partial<Record<FeedbackSeverity, number>>;
}

export interface FeedbackCreateOptions {
  source?: FeedbackSource;
  now?: Date;
}

/** Outcome of retrying task creation for feedback that has no task yet. */
export interface FeedbackSyncTasksResult {
  /** False when no task sink is configured — distinguishes "nothing to do" from "disabled". */
  sinkConfigured: boolean;
  created: number;
  failed: number;
  /** Items that already had a task and were left alone. */
  skipped: number;
  /**
   * Items whose previous attempt recorded no outcome. A task may already exist
   * for them, so re-filing blindly would duplicate it. Skipped unless
   * `retryUncertain` is set.
   */
  uncertain: number;
  /** Items left unprocessed because `limit` was reached. */
  remaining: number;
  errors: string[];
}

export interface FeedbackStore {
  createFeedback(input: FeedbackInput, options?: FeedbackCreateOptions): Promise<FeedbackItem>;
  listFeedback(filter?: FeedbackListFilter): Promise<FeedbackItem[]>;
  getFeedback(id: string): Promise<FeedbackItem | null>;
  updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem | null>;
  /** Mark feedback shipped and link it to the changelog entry that shipped it. */
  markFeedbackShipped?(id: string, changelogRef: string): Promise<FeedbackItem | null>;
  /** Retry task creation for feedback that has no task yet. */
  syncTasks?(options?: { limit?: number; retryUncertain?: boolean }): Promise<FeedbackSyncTasksResult>;
  stats(): Promise<FeedbackStats>;
  exportJsonl(filter?: FeedbackListFilter): Promise<string>;
}
