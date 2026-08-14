/**
 * SDK-specific types — error classes, pagination, response wrappers.
 */

import type {
  Task,
  Agent,
  Plan,
  TaskComment,
  StatusSummaryResponse,
} from "../types/index.js";

// ── API Error Classes ────────────────────────────────────────────────────────

export class TodosAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(message);
    this.name = "TodosAPIError";
  }
}

export class TodosNotFoundError extends TodosAPIError {
  constructor(message: string, body?: unknown) {
    super(message, 404, "Not Found", body);
    this.name = "TodosNotFoundError";
  }
}

export class TodosConflictError extends TodosAPIError {
  constructor(message: string, body?: unknown) {
    super(message, 409, "Conflict", body);
    this.name = "TodosConflictError";
  }
}

export class TodosUnauthorizedError extends TodosAPIError {
  constructor(message: string, body?: unknown) {
    super(message, 401, "Unauthorized", body);
    this.name = "TodosUnauthorizedError";
  }
}

export class TodosRateLimitError extends TodosAPIError {
  constructor(
    message: string,
    public retryAfter: number,
    body?: unknown,
  ) {
    super(message, 429, "Too Many Requests", body);
    this.name = "TodosRateLimitError";
  }
}

export class TodosTimeoutError extends Error {
  constructor(public ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TodosTimeoutError";
  }
}

// ── Pagination ───────────────────────────────────────────────────────────────

export interface CursorPage<T> {
  data: T[];
  has_more: boolean;
  next_cursor?: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
}

// ── Task List Responses ──────────────────────────────────────────────────────

export interface TaskListResponse {
  tasks: Task[];
  count: number;
  has_more?: boolean;
  next_cursor?: string;
}

export interface TaskStatusResponse extends StatusSummaryResponse {}

export interface TaskNextResponse {
  task: Task | null;
}

export interface TaskActiveResponse {
  active: {
    id: string;
    short_id: string | null;
    title: string;
    priority: string;
    assigned_to: string | null;
    locked_by: string | null;
    updated_at: string;
  }[];
  count: number;
}

export interface TaskStaleResponse {
  tasks: Task[];
  count: number;
}

export interface TaskChangedResponse {
  tasks: Task[];
  count: number;
  since: string;
}

export interface TaskContextResponse {
  status: StatusSummaryResponse;
  next_task: Task | null;
}

export interface TaskExportResponse {
  tasks: Task[];
}

export interface TaskBulkResponse {
  results: { id: string; success: boolean; error?: string }[];
  succeeded: number;
  failed: number;
}

export interface TaskProgressResponse {
  task_id: string;
  progress_entries: TaskComment[];
  latest: TaskComment | null;
  count: number;
  summary?: {
    total: number;
    returned: number;
    omitted: number;
    format: string;
  };
}

export interface TaskAttachmentsResponse {
  task_id: string;
  short_id: string | null;
  attachment_ids: string[];
  count: number;
  files_changed?: string[];
  commit_hash?: string;
  notes?: string;
}

export interface TaskFailResponse {
  task: Task;
  retry_task: Task | null;
}

// ── Agent Responses ──────────────────────────────────────────────────────────

export interface AgentMeResponse {
  agent: Agent;
  pending_tasks: Task[];
  in_progress_tasks: Task[];
  stats: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    completion_rate: number;
  };
}

export interface AgentQueueResponse extends Array<Task> {}

export interface OrgNode {
  agent: Agent;
  reports: OrgNode[];
}

// ── Plan Responses ───────────────────────────────────────────────────────────

export interface PlanWithTasks extends Plan {
  tasks: Task[];
}

// ── Report Responses ─────────────────────────────────────────────────────────

export interface ReportResponse {
  days: number;
  period_since: string;
  total: number;
  stats: Record<string, number>;
  changed: number;
  completed: number;
  failed: number;
  completion_rate: number;
  by_day: Record<string, number>;
}

// ── Doctor Response ──────────────────────────────────────────────────────────

export interface DoctorIssue {
  severity: "info" | "warn" | "error";
  type: string;
  message: string;
  count?: number;
  repairable?: boolean;
}

export interface DoctorResponse {
  /**
   * False when an error-severity check failed, a referential-integrity condition
   * has matching rows, OR a condition could not be measured. It is NOT a
   * "the request succeeded" flag.
   */
  ok: boolean;
  /** Status the `doctor` process RETURNS (0 clean, 1 findings, 2 incomplete). */
  exit_code?: 0 | 1 | 2;
  /** Status the reported rows IMPLY, ignoring `--no-fail-on-findings`. */
  verdict_exit_code?: 0 | 1 | 2;
  /** False when the findings gate was opted out of, making `exit_code` 0 regardless. */
  fail_on_findings?: boolean;
  dry_run?: boolean;
  database_path?: string;
  migration?: { current: number; expected: number };
  issues?: DoctorIssue[];
  checks?: DoctorIssue[];
  repairs?: Array<{ type: string; message: string; applied: boolean; count?: number }>;
  backup?: { path: string; files: string[] };
  summary?: {
    errors: number;
    warnings: number;
    infos: number;
    repairable: number;
    applied: number;
    integrity_findings?: number;
    integrity_rows?: number;
    integrity_unverified?: number;
  };
  /**
   * Per-condition referential-integrity breakdown (`todos.integrity.v1`). A
   * condition with `count: null` was NOT measured — it is never a zero.
   */
  integrity?: {
    schema_version: string;
    generated_at: string;
    source: string;
    conditions: Array<{
      id: string;
      count: number | null;
      open_count: number | null;
      severity: "warn" | "error" | null;
      verified: boolean;
      unverified_reason?: string;
      message: string;
      impact: string;
    }>;
    summary: {
      ok: boolean;
      findings: number;
      rows: number;
      errors: number;
      warnings: number;
      unverified: number;
      complete: boolean;
    };
  };
}

// ── SSE Event ────────────────────────────────────────────────────────────────

export interface SSEEvent {
  type: string;
  action: string;
  task_id?: string;
  agent_id?: string | null;
  project_id?: string | null;
  timestamp: string;
}

// ── Client Options ───────────────────────────────────────────────────────────

export interface TodosClientOptions {
  /** Base URL of the todos server. Default: http://localhost:19427 */
  baseUrl?: string;
  /** Request timeout in ms. Default: 10000 */
  timeout?: number;
  /** API key for auth (sent as x-api-key header). Default: TODOS_API_KEY env */
  apiKey?: string;
  /** Max retries on 5xx/429. Default: 0 */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default: 1000 */
  retryDelay?: number;
}
