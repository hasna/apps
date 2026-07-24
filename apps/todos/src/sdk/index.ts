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

// Versioned /v1 future-positive client, generated from the explicitly non-live
// contract in src/server/openapi.ts. Stage A exports the fail-closed class stub.
// Regenerate with `bun run scripts/generate-sdk.ts`.
export { TodosV1Client, ApiError as TodosV1ApiError } from "./v1-stage-a.js";
export type {
  TodosV1ClientOptions,
  Task as TodosV1Task,
  Project as TodosV1Project,
  TaskComment as TodosV1TaskComment,
  CreateTaskInput as TodosV1CreateTaskInput,
  UpdateTaskInput as TodosV1UpdateTaskInput,
  CreateProjectInput as TodosV1CreateProjectInput,
  CreateTaskCommentInput as TodosV1CreateTaskCommentInput,
} from "./v1.generated.js";

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
