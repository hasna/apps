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

// Versioned /v1 cloud client, generated from the serve OpenAPI document
// (src/server/openapi.ts). Regenerate with `bun run scripts/generate-sdk.ts`.
export { TodosV1Client, ApiError as TodosV1ApiError } from "./v1.generated.js";
export type {
  TodosV1ClientOptions,
  Task as TodosV1Task,
  Project as TodosV1Project,
  TaskComment as TodosV1TaskComment,
  CreateTaskInput as TodosV1CreateTaskInput,
  UpdateTaskInput as TodosV1UpdateTaskInput,
  CreateProjectInput as TodosV1CreateProjectInput,
  CreateTaskCommentInput as TodosV1CreateTaskCommentInput,
  AdmitPrGroupInput as TodosV1AdmitPrGroupInput,
  RecoverPrGroupInput as TodosV1RecoverPrGroupInput,
  AppendPrGroupEventInput as TodosV1AppendPrGroupEventInput,
  PrGroupCiProof as TodosV1PrGroupCiProof,
  PrGroupCleanupProof as TodosV1PrGroupCleanupProof,
  PrGroupRecord as TodosV1PrGroupRecord,
  PrGroupAttemptRecord as TodosV1PrGroupAttemptRecord,
  PrGroupEventRecord as TodosV1PrGroupEventRecord,
  PrGroupStateView as TodosV1PrGroupStateView,
  PrGroupEventPage as TodosV1PrGroupEventPage,
  PrGroupMutationResult as TodosV1PrGroupMutationResult,
} from "./v1.generated.js";

export type {
  AdmitPrGroupInput,
  AppendPrGroupEventInput,
  PrGroupAdapterViews,
  PrGroupAttemptRecord,
  PrGroupCiProof,
  PrGroupCleanupProof,
  PrGroupDecisionEnvelopeAdapter,
  PrGroupEventListOptions,
  PrGroupEventPage,
  PrGroupEventRecord,
  PrGroupEvidenceRefAdapter,
  PrGroupMutationResult,
  PrGroupProofBundleAdapter,
  PrGroupRecord,
  PrGroupStateView,
  PrGroupWorkRunAdapter,
  RecoverPrGroupInput,
} from "../pr-groups/types.js";

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
