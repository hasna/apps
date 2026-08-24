/**
 * Curated public API for @hasna/loops.
 *
 * Stable exports are safe to build on and follow semver. Experimental exports
 * may change shape between minor versions; import them knowingly. The
 * `@hasna/loops/storage` subpath (the raw Store) is internal plumbing kept
 * only for advanced integrations and may change without notice.
 */

// ---------------------------------------------------------------------------
// Stable: SDK client
// ---------------------------------------------------------------------------
export { LoopsClient, loops, openAutomationsRuntimeBinding } from "./sdk/index.js";
export type { ListLoopsFilters, ListRunsFilters, LoopsClientOptions } from "./sdk/index.js";

// ---------------------------------------------------------------------------
// Stable: MCP server factory and tool metadata
// ---------------------------------------------------------------------------
export { createLoopsMcpServer, listToolsForCli, LOOPS_MCP_TOOLS } from "./mcp/index.js";
export type { LoopsMcpToolMetadata } from "./mcp/index.js";

// ---------------------------------------------------------------------------
// Stable: coded errors (branch on `.code` instead of message text)
// ---------------------------------------------------------------------------
export { AmbiguousNameError, CodedError, LoopArchivedError, LoopNotFoundError, ValidationError } from "./lib/errors.js";

// ---------------------------------------------------------------------------
// Stable: core domain types
// ---------------------------------------------------------------------------
export type {
  // loops and runs
  CatchUpPolicy,
  CreateLoopInput,
  ExecutorResult,
  IntervalAnchor,
  Loop,
  LoopRun,
  LoopStatus,
  OverlapPolicy,
  RunStatus,
  TimeoutMs,
  // schedules
  CronSchedule,
  DynamicSchedule,
  IntervalSchedule,
  OnceSchedule,
  ScheduleSpec,
  // targets
  AccountRef,
  AgentAllowlistSpec,
  AgentConfigIsolation,
  AgentPermissionMode,
  AgentPromptSource,
  AgentProvider,
  AgentRoutingSpec,
  AgentSandbox,
  AgentSessionContract,
  AgentTarget,
  AgentTargetBase,
  AgentWorktreeMode,
  AgentWorktreeSpec,
  CommandTarget,
  ExecutableTarget,
  ExecutableTargetInput,
  LoopTarget,
  LoopTargetInput,
  PromptFileAgentTarget,
  RuntimePreflightPolicy,
  WorkflowTarget,
  // workflows
  AgentSessionContractWorkflowEvent,
  CreateWorkflowInput,
  CustomWorkflowEvent,
  GenericWorkflowEvent,
  PublicWorkflowEvent,
  WorkflowEvent,
  WorkflowEventBase,
  WorkflowLifecycleEventType,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSpec,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepInput,
  WorkflowStepRun,
  WorkflowStepRunStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Stable: diagnostics and schedule helpers
// ---------------------------------------------------------------------------
export { runDoctor } from "./lib/doctor.js";
export type { DoctorCheck, DoctorReport, DoctorSeverity } from "./lib/doctor.js";
export { buildHealthReport, buildHealthScan, classifyRunFailure, expectationForLoop, writeHealthScanReports } from "./lib/health.js";
export type {
  BuildHealthScanOptions,
  HealthScanFinding,
  HealthScanFindingKind,
  HealthScanFindingSeverity,
  HealthScanSelfHealAction,
  HealthScanStatus,
  LoopExpectationResult,
  LoopsHealthReport,
  LoopsHealthScan,
  RunFailureClassification,
  RunFailureSignal,
  WriteHealthScanReportsOptions,
} from "./lib/health.js";
export { computeNextAfter, initialNextRun, nextCronRun, parseCron, parseDuration } from "./lib/recurrence.js";

// ---------------------------------------------------------------------------
// Experimental: scheduler internals shared by CLI/SDK/MCP
// ---------------------------------------------------------------------------
export { runLoopNow, tick } from "./lib/scheduler.js";
export type {
  ManualRunSource,
  RunLoopNowDeps,
  RunLoopNowExecuted,
  RunLoopNowMode,
  RunLoopNowResult,
  RunLoopNowScheduled,
} from "./lib/scheduler.js";

// ---------------------------------------------------------------------------
// Experimental: storage contracts (prefer LoopsClient; kept for advanced consumers)
// ---------------------------------------------------------------------------
export { Store } from "./lib/store.js";
export {
  POSTGRES_MIGRATION_LEDGER_TABLE,
  POSTGRES_STORAGE_MIGRATIONS,
  PostgresStorage,
  SqliteLoopStorage,
  checksumStorageSql,
  createPostgresStorage,
  createSqliteLoopStorage,
} from "./lib/storage/index.js";
export type {
  AppliedStorageMigration,
  AuditEventRecord,
  LoopStorageBackend,
  LoopStorageContract,
  LoopStorageMethodName,
  PostgresQueryExecutor,
  RunnerLeaseRecord,
  RunnerLeaseStatus,
  RunnerMachineRecord,
  RunnerMachineStatus,
  SchemaMigrationStorage,
  StorageMigration,
  StorageMigrationPlanItem,
  StorageMigrationResult,
} from "./lib/storage/index.js";

// ---------------------------------------------------------------------------
// Experimental: runtime configuration (storage backend + connection transport)
// ---------------------------------------------------------------------------
export {
  ROUTE_ADMISSION_GATES,
  displayControlPlaneUrl,
  loopControlPlaneConfig,
  resolveRuntimeConfig,
  runtimeStorage,
  runtimeStorageBackend,
} from "./lib/runtime-config.js";
export type {
  LoopControlPlaneConfig,
  LoopRouteAdmissionGate,
  RuntimeConfig,
  RuntimeConnection,
  RuntimeStorage,
  RuntimeStorageBackend,
} from "./lib/runtime-config.js";
export {
  buildStorageConnectionReport,
  schedulerStateForConnection,
  storageConnectionReportLine,
} from "./lib/runtime-status.js";
export type {
  LoopRemoteArtifactStore,
  LoopRemoteSchedulerBackend,
  LoopRouteAdmissionStateStore,
  LoopSchedulerStateStatus,
  StorageConnectionReport,
} from "./lib/runtime-status.js";

// ---------------------------------------------------------------------------
// Experimental: execution and workflow engines
// ---------------------------------------------------------------------------
export { executeLoop, executeTarget, preflightTarget } from "./lib/executor.js";
export { executeLoopTarget, executeWorkflow, preflightWorkflow } from "./lib/workflow-runner.js";
export { workflowBodyFromJson, workflowExecutionOrder } from "./lib/workflow-spec.js";

// ---------------------------------------------------------------------------
// Experimental: machines, templates, hygiene, goals
// ---------------------------------------------------------------------------
export { listOpenMachines, refreshLoopMachine, resolveLoopMachine } from "./lib/machines.js";
export {
  BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID,
  EVENT_WORKER_VERIFIER_TEMPLATE_ID,
  TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
  getLoopTemplate,
  listLoopTemplates,
  renderBoundedAgentWorkerVerifierWorkflow,
  renderEventWorkerVerifierWorkflow,
  renderLoopTemplate,
  renderTodosTaskWorkerVerifierWorkflow,
} from "./lib/templates.js";
export { buildDuplicateOverlapReport, buildNameHygieneReport, buildScriptInventoryReport } from "./lib/hygiene.js";
export {
  LOOPS_MIGRATION_SCHEMA,
  applyImportMigrationBundle,
  buildImportMigrationPlan,
  buildControlPlaneMigrationPlan,
  exportLoopsMigrationBundle,
  migrationHash,
  publicMigrationBundle,
  controlPlaneSummary,
  validateLoopsMigrationBundle,
} from "./lib/migration.js";
export { runGoal } from "./lib/goal/runner.js";
export { resolveGoalModel } from "./lib/goal/model-factory.js";
export { isTerminal as isGoalTerminal, readyNodeKeys, rollupSummary } from "./lib/goal/status.js";

// ---------------------------------------------------------------------------
// Experimental: integration and template types
// ---------------------------------------------------------------------------
export type {
  CreateWorkflowInvocationInput,
  Goal,
  GoalAutoExecute,
  GoalExecutorResult,
  GoalPlan,
  GoalPlanNode,
  GoalPlanNodeStatus,
  GoalPlanStatus,
  GoalRollup,
  GoalRun,
  GoalSpec,
  GoalStatus,
  LoopMachineConfidence,
  LoopMachineRef,
  LoopMachineRoute,
  LoopTemplateKind,
  LoopTemplateSource,
  LoopTemplateSummary,
  LoopTemplateVariable,
  LoopTemplateVariableType,
  OpenAutomationsRuntimeBinding,
  PersistGuardOptions,
  UpsertWorkflowWorkItemInput,
  WorkflowInvocation,
  WorkflowInvocationIntent,
  WorkflowInvocationOutputPolicy,
  WorkflowInvocationRef,
  WorkflowInvocationScope,
  WorkflowInvocationSourceKind,
  WorkflowInvocationSubjectKind,
  WorkflowWorkItem,
  WorkflowWorkItemStatus,
} from "./types.js";
export type {
  ApplyLoopsMigrationResult,
  ExportLoopsMigrationOptions,
  ImportLoopsMigrationOptions,
  LoopsMigrationAction,
  LoopsMigrationBundle,
  LoopsMigrationPlan,
  LoopsMigrationPlanRow,
  LoopsMigrationPlanSummary,
  LoopsMigrationResource,
  ControlPlanePlanOptions,
} from "./lib/migration.js";

export {
  LOOP_BUNDLE_SCHEMA_VERSION,
  LOOPS_ESTATE_PREFIX,
  createLoopsEstateSync,
  loopDir,
  loopPromptDir,
  loopScriptsDir,
  loopsEstateRoot,
  packLoopDir,
  pullLoopFromEstate,
  pushLoopToEstate,
  resolveLoopsEstateSyncConfig,
  type LoopBundle,
  type LoopBundleFile,
  type LoopsEstateSyncConfig,
} from "./lib/estate-sync.js";
