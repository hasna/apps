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

// The ONE credential/authority resolver for this surface — the @hasna/contracts
// client chain (Keychain, ~/.hasna/todos/config/credentials, the canonical
// HASNA_TODOS_* env names, then the fleet gateway default). Exported so a
// consumer can read WHERE its credential came from, and build the hosted /v1
// client, without writing a private copy of the chain (hasna/apps#1720).
export {
  createTodosV1Client,
  resolveTodosSdkTransport,
  TODOS_LOCAL_SERVE_URL,
  __resetTodosSdkLocalNotice,
} from "./resolve.js";
export type { ResolveTodosSdkTransportOptions, TodosSdkTransport } from "./resolve.js";

// Versioned /v1 cloud client, generated from the serve OpenAPI document
// (src/server/openapi.ts). Regenerate with `bun run scripts/generate-sdk.ts`.
export { TodosV1Client, ApiError as TodosV1ApiError } from "./v1.generated.js";
export type {
  TodosV1ClientOptions,
  Task as TodosV1Task,
  Project as TodosV1Project,
  TaskManifestBindingLookupRequest as TodosV1TaskManifestBindingLookupRequest,
  TaskManifestBindingLookupResult as TodosV1TaskManifestBindingLookupResult,
  TaskManifestBindingLookupResponse as TodosV1TaskManifestBindingLookupResponse,
  TaskSubtreeTransferExpectedTask as TodosV1TaskSubtreeTransferExpectedTask,
  TaskSubtreeTransferSharedPlanSplit as TodosV1TaskSubtreeTransferSharedPlanSplit,
  TaskSubtreeTransferInspectRequest as TodosV1TaskSubtreeTransferInspectRequest,
  TaskSubtreeTransferInspection as TodosV1TaskSubtreeTransferInspection,
  TaskSubtreeTransferApplyRequest as TodosV1TaskSubtreeTransferApplyRequest,
  TaskSubtreeTransferTaskImage as TodosV1TaskSubtreeTransferTaskImage,
  TaskSubtreeTransferPlanImage as TodosV1TaskSubtreeTransferPlanImage,
  TaskSubtreeTransferImage as TodosV1TaskSubtreeTransferImage,
  TaskSubtreeTransferReceipt as TodosV1TaskSubtreeTransferReceipt,
  TaskSubtreeTransferResult as TodosV1TaskSubtreeTransferResult,
  TaskSubtreeTransferCapability as TodosV1TaskSubtreeTransferCapability,
  TaskSubtreeTransferRollbackRequest as TodosV1TaskSubtreeTransferRollbackRequest,
  TaskSubtreeTransferReadExactRequest as TodosV1TaskSubtreeTransferReadExactRequest,
  ProjectRegistrationCapability as TodosV1ProjectRegistrationCapability,
  ProjectRegistrationReceipt as TodosV1ProjectRegistrationReceipt,
  ProjectRegistrationRequest as TodosV1ProjectRegistrationRequest,
  ProjectRegistrationLookupRequest as TodosV1ProjectRegistrationLookupRequest,
  ProjectResource as TodosV1ProjectResource,
  ProjectResourcePage as TodosV1ProjectResourcePage,
  TaskComment as TodosV1TaskComment,
  CreateTaskInput as TodosV1CreateTaskInput,
  UpdateTaskInput as TodosV1UpdateTaskInput,
  FailTaskInput as TodosV1FailTaskInput,
  TaskFailureResult as TodosV1TaskFailureResult,
  CreateProjectInput as TodosV1CreateProjectInput,
  ProjectTaskListEnsureApplyInput as TodosV1ProjectTaskListEnsureApplyInput,
  ProjectTaskListRollbackInput as TodosV1ProjectTaskListRollbackInput,
  ProjectTaskListEnsureReceipt as TodosV1ProjectTaskListEnsureReceipt,
  ProjectTaskListEnsureResult as TodosV1ProjectTaskListEnsureResult,
  ProjectTaskListRollbackResult as TodosV1ProjectTaskListRollbackResult,
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
