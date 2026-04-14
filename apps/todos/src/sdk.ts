/**
 * @hasna/todos REST SDK Client — Backward Compatibility Layer
 *
 * This file re-exports the new SDK from src/sdk/client.ts.
 * All old method signatures are preserved via deprecated aliases.
 *
 * New code should import from "@hasna/todos/sdk" for the namespaced API:
 *   const client = new TodosClient();
 *   await client.tasks.list({ status: "pending" });
 *
 * Old code continues to work unchanged:
 *   await client.listTasks({ status: "pending" });
 */

export { TodosClient, createClient } from "./sdk/client.js";
export type { TodosClientOptions } from "./sdk/client.js";

// Re-export SDK types for consumers
export type {
  SSEEvent,
  CursorPage,
  TaskListResponse,
  TaskStatusResponse,
  TaskNextResponse,
  TaskActiveResponse,
  TaskStaleResponse,
  TaskChangedResponse,
  TaskContextResponse,
  TaskProgressResponse,
  TaskAttachmentsResponse,
  TaskFailResponse,
  TaskBulkResponse,
  AgentMeResponse,
  AgentQueueResponse,
  OrgNode,
  PlanWithTasks,
  ReportResponse,
  DoctorResponse,
  DoctorIssue,
} from "./sdk/types.js";

// Re-export error classes
export {
  TodosAPIError,
  TodosNotFoundError,
  TodosConflictError,
  TodosUnauthorizedError,
  TodosRateLimitError,
  TodosTimeoutError,
} from "./sdk/types.js";

// Re-export types that were previously defined only in this file
export type {
  TaskSummary,
  ProgressEntry,
  DashboardStats,
  StatusSummaryResponse,
} from "./types/index.js";
