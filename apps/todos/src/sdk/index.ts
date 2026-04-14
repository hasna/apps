/**
 * @hasna/todos SDK — comprehensive REST client
 *
 * Import from here for the new namespaced API:
 *   import { TodosClient } from "@hasna/todos/sdk";
 *
 * Or from the root for backward compat:
 *   import { TodosClient } from "@hasna/todos";
 */

export { TodosClient, createClient } from "./client.js";
export type { TodosClientOptions } from "./client.js";

export {
  TodosAPIError,
  TodosNotFoundError,
  TodosConflictError,
  TodosUnauthorizedError,
  TodosRateLimitError,
  TodosTimeoutError,
} from "./types.js";
export type {
  SSEEvent,
  CursorPage,
  ListOptions,
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
} from "./types.js";
