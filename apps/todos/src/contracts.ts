import { getPackageVersion } from "./lib/package-version.js";
import { createJsonContractsManifest } from "./json-contracts.js";
export {
  TODOS_JSON_CONTRACTS,
  TODOS_JSON_CONTRACTS_MANIFEST,
  createJsonContractsManifest,
  getJsonContract,
  validateJsonContract,
} from "./json-contracts.js";
export {
  TODOS_ONBOARDING_FIXTURE_LIBRARY_VERSION,
  TODOS_ONBOARDING_FIXTURE_SOURCE,
  getOnboardingFixture,
  getOnboardingFixtureBundle,
  importOnboardingFixture,
  listOnboardingFixtures,
  writeOnboardingFixtureFiles,
} from "./lib/onboarding-fixtures.js";
export {
  TODOS_LOCAL_BRIDGE_KIND,
  TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  validateLocalBridgeBundle,
} from "./lib/local-bridge.js";
export {
  TODOS_LOCAL_SNAPSHOT_SCHEMA_VERSION,
  getLocalSnapshot,
  listLocalSnapshotResources,
  pollLocalSnapshots,
  renderLocalSnapshotMarkdown,
} from "./lib/local-snapshots.js";
export {
  TODOS_SDK_INTEGRATION_FIXTURE_GENERATED_AT,
  TODOS_SDK_INTEGRATION_FIXTURE_SCHEMA_VERSION,
  createSdkIntegrationFixturePack,
  listSdkIntegrationExamples,
  writeSdkIntegrationFixtures,
} from "./lib/sdk-integration-fixtures.js";
export {
  approveReviewItem,
  claimReviewItem,
  listReviewQueue,
  listReviewRoutingRules,
  removeReviewRoutingRule,
  reopenReviewItem,
  requestReviewQueue,
  returnReviewItem,
  upsertReviewRoutingRule,
} from "./lib/review-queues.js";
export {
  LOCAL_ROADMAP_SCHEMA_VERSION,
  createMilestone,
  createRoadmap,
  deleteMilestone,
  deleteRoadmap,
  exportRoadmapBundle,
  getRoadmap,
  importRoadmapBundle,
  listMilestones,
  listReleaseGroups,
  listRoadmaps,
  renderRoadmapMarkdown,
  summarizeMilestone,
  summarizeRoadmap,
  updateMilestone,
  updateRoadmap,
  upsertReleaseGroup,
} from "./lib/roadmaps.js";
export {
  LOCAL_AUDIT_LEDGER_HASH_ALGORITHM,
  LOCAL_AUDIT_LEDGER_SCHEMA_VERSION,
  getLocalAuditLedger,
  listLocalAuditLedgerCheckpoints,
  renderLocalAuditLedgerMarkdown,
  sealLocalAuditLedger,
  verifyLocalAuditLedger,
} from "./lib/audit-ledger.js";
export {
  LOCAL_RELEASE_COMPATIBILITY_SCHEMA_VERSION,
  createReleaseCompatibilityReport,
  renderReleaseCompatibilityMarkdown,
} from "./lib/release-compatibility.js";
export {
  DEFAULT_ENCRYPTION_KEY_ENV,
  DEFAULT_ENCRYPTION_PROFILE,
  TODOS_ENCRYPTED_BRIDGE_KIND,
  TODOS_ENCRYPTED_VALUE_KIND,
  TODOS_ENCRYPTION_SCHEMA_VERSION,
  createEncryptedBridgeBundle,
  decryptBridgeBundle,
  decryptString,
  decryptValue,
  encryptSensitiveFields,
  encryptString,
  encryptValue,
  encryptionProfileStatus,
  isEncryptedBridgeBundle,
  isEncryptedValue,
  listEncryptionProfiles,
  removeEncryptionProfile,
  upsertEncryptionProfile,
} from "./lib/local-encryption.js";
export type {
  CreateJsonContractsManifestOptions,
  JsonContractValidationIssue,
  JsonContractValidationResult,
  TodosJsonContractPackageSource,
  TodosJsonContractsManifest,
  TodosJsonFieldContract,
  TodosJsonFieldType,
  TodosJsonObjectContract,
  TodosJsonStability,
  TodosJsonSurface,
} from "./json-contracts.js";
export type {
  LocalAuditLedger,
  LocalAuditLedgerEntry,
  LocalAuditLedgerInput,
  LocalAuditLedgerScope,
  LocalAuditLedgerSource,
  LocalAuditLedgerVerifyResult,
  SealLocalAuditLedgerInput,
} from "./lib/audit-ledger.js";
export type {
  CreateReleaseCompatibilityReportOptions,
  ReleaseCompatibilityCheck,
  ReleaseCompatibilityReport,
  ReleaseCompatibilityStatus,
} from "./lib/release-compatibility.js";
export type {
  ImportOnboardingFixtureOptions,
  OnboardingFixture,
  OnboardingFixtureSummary,
  WriteOnboardingFixtureResult,
} from "./lib/onboarding-fixtures.js";
export type {
  ExportLocalBridgeOptions,
  LocalBridgeImportConflict,
  LocalBridgeImportResult,
  LocalBridgeValidationResult,
  TodosLocalBridgeBundle,
  TodosLocalBridgeData,
  TodosLocalBridgePackageSource,
  TodosLocalBridgeSource,
} from "./lib/local-bridge.js";
export type {
  LocalSnapshot,
  LocalSnapshotCatalogEntry,
  LocalSnapshotOptions,
  LocalSnapshotPollResult,
  LocalSnapshotType,
} from "./lib/local-snapshots.js";
export type {
  SdkIntegrationExample,
  SdkIntegrationExampleSurface,
  SdkIntegrationFixtureDatabase,
  SdkIntegrationFixturePack,
  WriteSdkIntegrationFixturesResult,
} from "./lib/sdk-integration-fixtures.js";
export type {
  ClaimReviewInput,
  DecideReviewInput,
  RequestReviewQueueInput,
  ReviewQueueHistoryEntry,
  ReviewQueueItem,
  ReviewQueueListOptions,
  ReviewQueueMetadata,
  ReviewQueueState,
  UpsertReviewRoutingRuleInput,
} from "./lib/review-queues.js";
export type {
  CreateMilestoneInput,
  CreateRoadmapInput,
  ImportRoadmapBundleResult,
  LocalMilestoneConfig,
  LocalMilestoneStatus,
  LocalReleaseGroupConfig,
  LocalRoadmapConfig,
  LocalRoadmapStatus,
  LocalRoadmapStoreConfig,
  MilestoneSummary,
  RoadmapBundle,
  RoadmapProgressSummary,
  RoadmapSummary,
  UpdateMilestoneInput,
  UpdateRoadmapInput,
  UpsertReleaseGroupInput,
} from "./lib/roadmaps.js";
export type {
  CapacityProfileQuery,
  ForecastRiskFlag,
  LocalCapacityProfileConfig,
  LocalCapacityStoreConfig,
  PlanningForecast,
  PlanningForecastInput,
  PlanningForecastTask,
  UpsertCapacityProfileInput,
} from "./lib/capacity-forecasts.js";
export type {
  EncryptedLocalBridgeBundle,
  LocalEncryptionEnvelope,
  UpsertEncryptionProfileInput,
} from "./lib/local-encryption.js";
import {
  AgentNotFoundError,
  CompletionGuardError,
  DependencyCycleError,
  DISPATCH_STATUSES,
  DispatchNotFoundError,
  LockError,
  PLAN_STATUSES,
  PlanNotFoundError,
  ProjectNotFoundError,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskListNotFoundError,
  TaskNotFoundError,
  VersionConflictError,
} from "./types/index.js";
import type { DispatchStatus, PlanStatus, TaskPriority, TaskStatus } from "./types/index.js";
import type { TodosJsonContractsManifest } from "./json-contracts.js";

export type TodosHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type TodosContractStability = "stable" | "experimental";

export interface CreateContractsManifestOptions {
  version?: string;
  generatedAt?: string;
}

export interface TodosContractPackageSource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosJsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: TodosJsonSchema;
}

export interface TodosApiRouteContract {
  id: string;
  method: TodosHttpMethod;
  path: string;
  description: string;
  auth: "optional-api-key" | "api-key";
  requestSchema: TodosJsonSchema | null;
  responseSchema: TodosJsonSchema;
  tags: string[];
  stability: TodosContractStability;
}

export interface TodosErrorContract {
  code: string;
  name: string;
  suggestion: string;
  httpStatus: number | null;
}

export interface TodosContractsManifest {
  schemaVersion: 1;
  generatedAt: string;
  package: TodosContractPackageSource;
  values: {
    taskStatuses: readonly TaskStatus[];
    taskPriorities: readonly TaskPriority[];
    planStatuses: readonly PlanStatus[];
    dispatchStatuses: readonly DispatchStatus[];
  };
  apiRoutes: TodosApiRouteContract[];
  errorCodes: TodosErrorContract[];
  jsonOutputs: TodosJsonContractsManifest;
}

const objectSchema: TodosJsonSchema = {
  type: "object",
  additionalProperties: true,
};

const taskSchema: TodosJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: TASK_STATUSES },
    priority: { type: "string", enum: TASK_PRIORITIES },
  },
  required: ["id", "title", "status", "priority"],
  additionalProperties: true,
};

const taskArraySchema: TodosJsonSchema = {
  type: "array",
  items: taskSchema,
};

export const TODOS_API_ROUTES: TodosApiRouteContract[] = [
  {
    id: "health.read",
    method: "GET",
    path: "/api/health",
    description: "Read local server health and stale task counts.",
    auth: "optional-api-key",
    requestSchema: null,
    responseSchema: objectSchema,
    tags: ["server", "health"],
    stability: "stable",
  },
  {
    id: "tasks.list",
    method: "GET",
    path: "/api/tasks",
    description: "List tasks with query filters for status, project, session, agent, limit, and offset.",
    auth: "optional-api-key",
    requestSchema: null,
    responseSchema: taskArraySchema,
    tags: ["tasks", "query"],
    stability: "stable",
  },
  {
    id: "tasks.create",
    method: "POST",
    path: "/api/tasks",
    description: "Create a task with a title, optional description, priority, and project.",
    auth: "optional-api-key",
    requestSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: TASK_PRIORITIES },
        project_id: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    responseSchema: taskSchema,
    tags: ["tasks", "mutation"],
    stability: "stable",
  },
  {
    id: "tasks.read",
    method: "GET",
    path: "/api/tasks/:id",
    description: "Read a single task by full or partial id.",
    auth: "optional-api-key",
    requestSchema: null,
    responseSchema: taskSchema,
    tags: ["tasks", "query"],
    stability: "stable",
  },
  {
    id: "tasks.update",
    method: "PATCH",
    path: "/api/tasks/:id",
    description: "Update a task with optimistic locking through the current version.",
    auth: "optional-api-key",
    requestSchema: objectSchema,
    responseSchema: taskSchema,
    tags: ["tasks", "mutation"],
    stability: "stable",
  },
  {
    id: "tasks.complete",
    method: "POST",
    path: "/api/tasks/:id/complete",
    description: "Mark a task complete and return its updated summary.",
    auth: "optional-api-key",
    requestSchema: null,
    responseSchema: taskSchema,
    tags: ["tasks", "workflow"],
    stability: "stable",
  },
  {
    id: "tasks.claim",
    method: "POST",
    path: "/api/tasks/claim",
    description: "Atomically claim the next available task for an agent.",
    auth: "optional-api-key",
    requestSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        project_id: { type: "string" },
      },
      additionalProperties: false,
    },
    responseSchema: objectSchema,
    tags: ["tasks", "agents", "workflow"],
    stability: "stable",
  },
  {
    id: "agents.register",
    method: "POST",
    path: "/api/agents",
    description: "Register an agent for local task coordination.",
    auth: "optional-api-key",
    requestSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
      },
      required: ["name"],
      additionalProperties: true,
    },
    responseSchema: objectSchema,
    tags: ["agents"],
    stability: "stable",
  },
  {
    id: "plans.create",
    method: "POST",
    path: "/api/plans",
    description: "Create a plan for grouping related task work.",
    auth: "optional-api-key",
    requestSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        project_id: { type: "string" },
        task_list_id: { type: "string" },
        agent_id: { type: "string" },
        status: { type: "string", enum: PLAN_STATUSES },
      },
      required: ["name"],
      additionalProperties: false,
    },
    responseSchema: objectSchema,
    tags: ["plans"],
    stability: "stable",
  },
  {
    id: "streams.tasks",
    method: "GET",
    path: "/api/tasks/stream",
    description: "Subscribe to server-sent task events with optional agent, project, and event filters.",
    auth: "optional-api-key",
    requestSchema: null,
    responseSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        timestamp: { type: "string" },
      },
      additionalProperties: true,
    },
    tags: ["tasks", "events"],
    stability: "experimental",
  },
];

export const TODOS_ERROR_CODES: TodosErrorContract[] = [
  {
    code: VersionConflictError.code,
    name: "VersionConflictError",
    suggestion: VersionConflictError.suggestion,
    httpStatus: 409,
  },
  {
    code: TaskNotFoundError.code,
    name: "TaskNotFoundError",
    suggestion: TaskNotFoundError.suggestion,
    httpStatus: 404,
  },
  {
    code: ProjectNotFoundError.code,
    name: "ProjectNotFoundError",
    suggestion: ProjectNotFoundError.suggestion,
    httpStatus: 404,
  },
  {
    code: PlanNotFoundError.code,
    name: "PlanNotFoundError",
    suggestion: PlanNotFoundError.suggestion,
    httpStatus: 404,
  },
  {
    code: LockError.code,
    name: "LockError",
    suggestion: LockError.suggestion,
    httpStatus: 409,
  },
  {
    code: AgentNotFoundError.code,
    name: "AgentNotFoundError",
    suggestion: AgentNotFoundError.suggestion,
    httpStatus: 404,
  },
  {
    code: TaskListNotFoundError.code,
    name: "TaskListNotFoundError",
    suggestion: TaskListNotFoundError.suggestion,
    httpStatus: 404,
  },
  {
    code: DependencyCycleError.code,
    name: "DependencyCycleError",
    suggestion: DependencyCycleError.suggestion,
    httpStatus: 409,
  },
  {
    code: CompletionGuardError.code,
    name: "CompletionGuardError",
    suggestion: CompletionGuardError.suggestion,
    httpStatus: 409,
  },
  {
    code: DispatchNotFoundError.code,
    name: "DispatchNotFoundError",
    suggestion: DispatchNotFoundError.suggestion,
    httpStatus: 404,
  },
];

function source(version: string): TodosContractPackageSource {
  return {
    packageName: "@hasna/todos",
    repository: "hasna/todos",
    version,
  };
}

export function createContractsManifest(
  options: CreateContractsManifestOptions = {},
): TodosContractsManifest {
  const version = options.version ?? getPackageVersion(import.meta.url);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt,
    package: source(version),
    values: {
      taskStatuses: TASK_STATUSES,
      taskPriorities: TASK_PRIORITIES,
      planStatuses: PLAN_STATUSES,
      dispatchStatuses: DISPATCH_STATUSES,
    },
    apiRoutes: TODOS_API_ROUTES,
    errorCodes: TODOS_ERROR_CODES,
    jsonOutputs: createJsonContractsManifest({ version, generatedAt }),
  };
}

export const TODOS_CONTRACTS = createContractsManifest({
  generatedAt: "1970-01-01T00:00:00.000Z",
});
