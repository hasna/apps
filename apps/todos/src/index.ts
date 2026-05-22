// REST SDK Client (for cross-process/cross-machine use)
export { TodosClient, createClient } from "./sdk.js";
export type { TodosClientOptions } from "./sdk.js";

// Package capability manifest
export { TODOS_CAPABILITIES, createCapabilityManifest } from "./capabilities.js";
export type {
  CreateCapabilityManifestOptions,
  TodosCapability,
  TodosCapabilityKind,
  TodosCapabilityManifest,
  TodosCapabilitySource,
  TodosCapabilityStability,
} from "./capabilities.js";

// Stable integration contracts
export { TODOS_CONTRACTS, TODOS_API_ROUTES, TODOS_ERROR_CODES, createContractsManifest } from "./contracts.js";
export type {
  CreateContractsManifestOptions,
  TodosApiRouteContract,
  TodosContractPackageSource,
  TodosContractsManifest,
  TodosContractStability,
  TodosErrorContract,
  TodosHttpMethod,
  TodosJsonSchema,
} from "./contracts.js";
export {
  TODOS_JSON_CONTRACTS,
  TODOS_JSON_CONTRACTS_MANIFEST,
  createJsonContractsManifest,
  getJsonContract,
  validateJsonContract,
} from "./contracts.js";
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
} from "./contracts.js";

// Bundled local onboarding fixtures
export {
  TODOS_ONBOARDING_FIXTURE_LIBRARY_VERSION,
  TODOS_ONBOARDING_FIXTURE_SOURCE,
  getOnboardingFixture,
  getOnboardingFixtureBundle,
  importOnboardingFixture,
  listOnboardingFixtures,
  writeOnboardingFixtureFiles,
} from "./lib/onboarding-fixtures.js";
export type {
  ImportOnboardingFixtureOptions,
  OnboardingFixture,
  OnboardingFixtureSummary,
  WriteOnboardingFixtureResult,
} from "./lib/onboarding-fixtures.js";

// Local snapshot resources
export {
  TODOS_LOCAL_SNAPSHOT_SCHEMA_VERSION,
  getLocalSnapshot,
  listLocalSnapshotResources,
  pollLocalSnapshots,
  renderLocalSnapshotMarkdown,
} from "./lib/local-snapshots.js";
export type {
  LocalSnapshot,
  LocalSnapshotCatalogEntry,
  LocalSnapshotOptions,
  LocalSnapshotPollResult,
  LocalSnapshotType,
} from "./lib/local-snapshots.js";

// SDK integration fixtures
export {
  TODOS_SDK_INTEGRATION_FIXTURE_GENERATED_AT,
  TODOS_SDK_INTEGRATION_FIXTURE_SCHEMA_VERSION,
  createSdkIntegrationFixturePack,
  listSdkIntegrationExamples,
  writeSdkIntegrationFixtures,
} from "./lib/sdk-integration-fixtures.js";
export type {
  SdkIntegrationExample,
  SdkIntegrationExampleSurface,
  SdkIntegrationFixtureDatabase,
  SdkIntegrationFixturePack,
  WriteSdkIntegrationFixturesResult,
} from "./lib/sdk-integration-fixtures.js";

// Local review queues
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

// Side-effect-free MCP metadata
export {
  CORE_MCP_TOOLS,
  MCP_PROFILE_GROUPS,
  MCP_TOOL_GROUPS,
  TODOS_MCP_MANIFEST,
  createMcpManifest,
  getMcpToolNames,
  shouldRegisterToolForProfile,
} from "./mcp.js";
export type {
  CreateMcpManifestOptions,
  GetMcpToolNamesOptions,
  TodosMcpManifest,
  TodosMcpPackageSource,
  TodosMcpStability,
  TodosMcpToolContract,
} from "./mcp.js";

// CLI/MCP parity contract
export {
  TODOS_CLI_MCP_PARITY,
  TODOS_CLI_MCP_PARITY_MANIFEST,
  createCliMcpParityManifest,
} from "./cli-mcp-parity.js";
export type {
  CreateCliMcpParityManifestOptions,
  TodosCliMcpParityDomain,
  TodosCliMcpParityEntry,
  TodosCliMcpParityGap,
  TodosCliMcpParityManifest,
  TodosCliMcpParityPackageSource,
  TodosCliMcpParityStatus,
} from "./cli-mcp-parity.js";

// Package registry manifest
export { TODOS_PACKAGE_EXPORTS, TODOS_REGISTRY, createTodosRegistry } from "./registry.js";
export type {
  CreateTodosRegistryOptions,
  TodosPackageExportContract,
  TodosPackageSource,
  TodosRegistry,
} from "./registry.js";

// Core database
export { getDatabase, closeDatabase, resetDatabase, resolvePartialId, now, uuid } from "./db/database.js";

// Tasks
export {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  countTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  getTaskLockStatus,
  addDependency,
  removeDependency,
  getTaskDependencies,
  getTaskDependents,
  getBlockingDeps,
  bulkUpdateTasks,
  bulkCreateTasks,
  cloneTask,
  getTaskStats,
  getTaskGraph,
  moveTask,
  getNextTask,
  claimNextTask,
  stealTask,
  claimOrSteal,
  logCost,
  getActiveWork,
  failTask,
  getTasksChangedSince,
  getStaleTasks,
  getStatus,
  decomposeTasks,
  setTaskStatus,
  setTaskPriority,
  redistributeStaleTasks,
  getOverdueTasks,
  getEscalatedTasks,
  archiveTasks,
  unarchiveTask,
  logTime,
  getTimeLogs,
  getTimeReport,
  startFocusSession,
  getFocusSession,
  listFocusSessions,
  pauseFocusSession,
  resumeFocusSession,
  stopFocusSession,
  getIdleFocusSessionPrompts,
  buildTaskBoardSnapshot,
  createTaskBoard,
  deleteTaskBoard,
  exportTaskBoardBundle,
  getTaskBoard,
  importTaskBoardBundle,
  listTaskBoards,
  moveBoardCard,
  renderTaskBoard,
  updateTaskBoard,
  createCalendarItem,
  exportCalendarIcs,
  getCalendarItem,
  importCalendarIcs,
  listCalendarEvents,
  listCalendarItems,
} from "./db/tasks.js";
export type { TaskGraphNode, TaskGraph, BulkCreateTaskInput, EscalatedTask, ActiveWorkItem, StatusSummary, DecomposeSubtaskInput, StaleTaskQuery, TaskLockStatus, FocusSessionQuery, IdleFocusSessionPrompt, LogTimeInput, StartFocusSessionInput, StopFocusSessionInput, TimeReportEntry, CreateTaskBoardInput, MoveBoardCardInput, TaskBoardBundle, TaskBoardQuery, UpdateTaskBoardInput, CalendarQuery, CreateCalendarItemInput, IcsExportOptions, IcsImportResult } from "./db/tasks.js";

// Cycles
export {
  createCycle,
  getCycle,
  getCycleByNumber,
  listCycles,
  updateCycle,
  deleteCycle,
  generateCycles,
  getCurrentCycle,
  getNextCycle,
  getCycleStats,
  listCyclesWithStats,
} from "./db/cycles.js";
export type { Cycle, CycleWithStats, CreateCycleInput, CycleUpdateInput, CycleQueryOptions } from "./db/cycles.js";

// Projects
export {
  createProject,
  getProject,
  getProjectByPath,
  getProjectWithSources,
  listProjects,
  updateProject,
  deleteProject,
  ensureProject,
  nextTaskShortId,
  slugify,
  addProjectSource,
  removeProjectSource,
  listProjectSources,
  renameProject,
  setMachineLocalPath,
  getMachineLocalPath,
  listMachineLocalPaths,
  removeMachineLocalPath,
} from "./db/projects.js";
export type { ProjectMachinePath } from "./db/projects.js";

// Plans
export {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "./db/plans.js";

// Local project knowledge records
export {
  createKnowledgeExportReport,
  createKnowledgeRecord,
  createKnowledgeSnapshot,
  getKnowledgeRecord,
  listKnowledgeRecords,
  renderKnowledgeExportMarkdown,
  searchKnowledgeRecords,
} from "./db/project-knowledge.js";
export type {
  CreateKnowledgeRecordInput,
  CreateKnowledgeSnapshotInput,
  KnowledgeExportFormat,
  KnowledgeExportReport,
  KnowledgeRecordType,
  ListKnowledgeRecordsOptions,
  ProjectKnowledgeRecord,
  SearchKnowledgeRecordsOptions,
} from "./db/project-knowledge.js";

// Local risk register and health scoring
export {
  closeRisk,
  createRisk,
  createRiskRegisterExport,
  getRisk,
  listRisks,
  renderRiskRegisterMarkdown,
  scorePlanHealth,
  scoreProjectHealth,
  updateRisk,
} from "./db/project-risks.js";
export type {
  CreateRiskInput,
  ListRisksOptions,
  ProjectHealthReport,
  ProjectHealthStatus,
  ProjectRiskProbability,
  ProjectRiskRecord,
  ProjectRiskSeverity,
  ProjectRiskStatus,
  RiskExportFormat,
  RiskRegisterExport,
  UpdateRiskInput,
} from "./db/project-risks.js";

// Local retrospectives and lessons learned
export {
  createRetrospective,
  createRetrospectiveExport,
  getRetrospective,
  listRetrospectives,
  renderRetrospectiveMarkdown,
} from "./db/retrospectives.js";
export type {
  CreateRetrospectiveInput,
  ListRetrospectivesOptions,
  RetrospectiveExport,
  RetrospectiveExportFormat,
  RetrospectiveRecord,
  RetrospectiveReport,
  RetrospectiveScope,
} from "./db/retrospectives.js";

// Project bootstrap and workspace discovery
export {
  bootstrapProject,
  discoverProjectWorkspace,
} from "./lib/project-bootstrap.js";
export type {
  ProjectBootstrapOptions,
  ProjectBootstrapResult,
  ProjectWorkspaceDiscovery,
} from "./lib/project-bootstrap.js";

// Comments
export {
  addComment,
  getComment,
  listComments,
  deleteComment,
  logProgress,
} from "./db/comments.js";

// Agents
export {
  registerAgent,
  isAgentConflict,
  releaseAgent,
  autoReleaseStaleAgents,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgent,
  updateAgentActivity,
  deleteAgent,
  archiveAgent,
  unarchiveAgent,
  getDirectReports,
  getOrgChart,
  matchCapabilities,
  getCapableAgents,
  normalizeGeneratedAgentNames,
  suggestAgentNames,
} from "./db/agents.js";
export type { OrgNode } from "./db/agents.js";

// API keys
export {
  createApiKey,
  listApiKeys,
  hasActiveApiKeys,
  verifyApiKey,
  revokeApiKey,
} from "./db/api-keys.js";
export type { ApiKeyRecord, CreateApiKeyInput, CreatedApiKey } from "./db/api-keys.js";

// Task Lists
export {
  createTaskList,
  getTaskList,
  getTaskListBySlug,
  listTaskLists,
  updateTaskList,
  deleteTaskList,
  ensureTaskList,
} from "./db/task-lists.js";

// Sessions
export {
  createSession,
  getSession,
  listSessions,
  updateSessionActivity,
  deleteSession,
} from "./db/sessions.js";

// Audit
export { logTaskChange, getTaskHistory, getRecentActivity, getRecap } from "./db/audit.js";
export type { RecapSummary } from "./db/audit.js";

// Training data gatherer (for @hasna/brains fine-tuning integration)
export { gatherTrainingData } from "./lib/gatherer.js";

// Model config (active fine-tuned model ID)
export {
  getActiveModel,
  setActiveModel,
  clearActiveModel,
  DEFAULT_MODEL,
} from "./lib/model-config.js";

// Webhooks
export { createWebhook, getWebhook, listWebhooks, deleteWebhook, dispatchWebhook, listDeliveries } from "./db/webhooks.js";
export type { WebhookDelivery } from "./db/webhooks.js";

// Templates
export { createTemplate, getTemplate, listTemplates, deleteTemplate, updateTemplate, taskFromTemplate, addTemplateTasks, getTemplateWithTasks, getTemplateTasks, tasksFromTemplate, previewTemplate, resolveVariables, evaluateCondition, exportTemplate, importTemplate, getTemplateVersion, listTemplateVersions } from "./db/templates.js";
export type { TemplatePreview, TemplatePreviewTask, UpdateTemplateInput, TemplateExport } from "./db/templates.js";

// Built-in Templates
export {
  BUILTIN_TEMPLATE_LIBRARY_SOURCE,
  BUILTIN_TEMPLATE_LIBRARY_VERSION,
  BUILTIN_TEMPLATES,
  exportBuiltinTemplate,
  exportBuiltinTemplateFiles,
  getBuiltinTemplate,
  initBuiltinTemplates,
  listBuiltinTemplates,
  writeBuiltinTemplateFiles,
} from "./db/builtin-templates.js";
export type { BuiltinTemplate } from "./db/builtin-templates.js";

// Checklists
export {
  getChecklist,
  addChecklistItem,
  checkChecklistItem,
  updateChecklistItemText,
  removeChecklistItem,
  clearChecklist,
  getChecklistStats,
} from "./db/checklists.js";

// Handoffs
export {
  acknowledgeHandoff,
  createHandoff,
  createSessionRecoveryHandoff,
  exportHandoffBundle,
  getHandoff,
  getLatestHandoff,
  importHandoffBundle,
  listHandoffs,
} from "./db/handoffs.js";
export type {
  CreateHandoffInput,
  CreateSessionRecoveryHandoffInput,
  Handoff,
  HandoffBundle,
  ImportHandoffBundleResult,
  ListHandoffsOptions,
} from "./db/handoffs.js";

// Task Files
export { addTaskFile, getTaskFile, listTaskFiles, findTasksByFile, updateTaskFileStatus, removeTaskFile, bulkAddTaskFiles } from "./db/task-files.js";
export type { TaskFile, AddTaskFileInput } from "./db/task-files.js";

// Locks
export { acquireLock, releaseLock, checkLock, cleanExpiredLocks } from "./db/locks.js";
export type { ResourceLock } from "./db/locks.js";

// Machines
export {
  getOrCreateLocalMachine,
  getMachineId,
  resetMachineId,
  getMachine,
  getMachineByName,
  listMachines,
  registerMachine,
  updateMachineHeartbeat,
  getMachineTopologyDiagnostics,
  deleteMachine,
} from "./db/machines.js";
export type {
  MachineTopologyOptions,
} from "./db/machines.js";
export type {
  MachinePathIssue,
  MachineTopologyDiagnostics,
  MachineTopologyMetadata,
  MachineTopologySummary,
} from "./types/index.js";

// Orgs
export { createOrg, getOrg, getOrgByName, listOrgs, updateOrg, deleteOrg } from "./db/orgs.js";

// Task Relationships
export {
  addTaskRelationship,
  getTaskRelationship,
  removeTaskRelationship,
  removeTaskRelationshipByPair,
  getTaskRelationships,
  findRelatedTaskIds,
  autoDetectFileRelationships,
} from "./db/task-relationships.js";
export { RELATIONSHIP_TYPES } from "./db/task-relationships.js";
export type { TaskRelationship, AddTaskRelationshipInput, RelationshipType } from "./db/task-relationships.js";

// Knowledge Graph
export { syncKgEdges, getRelated, findPath, getImpactAnalysis, getCriticalPath, addKgEdge, removeKgEdges } from "./db/kg.js";
export type { KgEdge } from "./db/kg.js";

// Patrol & Review
export { patrolTasks, getReviewQueue } from "./db/patrol.js";
export type { PatrolIssue, PatrolResult } from "./db/patrol.js";

// Agent Metrics
export {
  createAgentReliabilityExport,
  getAgentMetrics,
  getAgentReliabilityScorecard,
  getLeaderboard,
  listAgentReliabilityScorecards,
  renderAgentReliabilityMarkdown,
  scoreTask,
} from "./db/agent-metrics.js";
export type {
  AgentMetrics,
  AgentReliabilityExport,
  AgentReliabilityGrade,
  AgentReliabilityScorecard,
  AgentReliabilityScorecardOptions,
  LeaderboardEntry,
} from "./db/agent-metrics.js";

// Search
export { searchTasks } from "./lib/search.js";
export type { SearchOptions } from "./lib/search.js";
export {
  deleteSearchView,
  getSearchView,
  listSearchViews,
  normalizeScope,
  runSavedSearch,
  runSearchView,
  saveSearchView,
} from "./lib/saved-search-views.js";
export type {
  SavedSearchFilters,
  SavedSearchResult,
  SavedSearchRunResult,
  SavedSearchScope,
  SavedSearchView,
  SaveSearchViewInput,
} from "./lib/saved-search-views.js";

// Sync
export { defaultSyncAgents, syncWithAgent, syncWithAgents } from "./lib/sync.js";
export type { SyncResult } from "./lib/sync-types.js";

// Extract
export { buildCodebaseIndex, extractTodos, extractFromSource, tagToPriority, watchSourceTodos, EXTRACT_TAGS } from "./lib/extract.js";

// Burndown
export { getBurndown } from "./lib/burndown.js";
export type { BurndownData } from "./lib/burndown.js";

// GitHub import
export { parseGitHubUrl, fetchGitHubIssue, issueToTask } from "./lib/github.js";
export type { GitHubIssue } from "./lib/github.js";

// Traces
export { logTrace, getTaskTraces, getTraceStats } from "./db/traces.js";
export type { TaskTrace, LogTraceInput, TraceType } from "./db/traces.js";

// Context Snapshots
export { saveSnapshot, getLatestSnapshot, listSnapshots } from "./db/snapshots.js";
export type { ContextSnapshot, SaveSnapshotInput, SnapshotType } from "./db/snapshots.js";

// Agent Budgets
export { setBudget, getBudget, checkBudget } from "./db/budgets.js";
export type { AgentBudget, BudgetCheck } from "./db/budgets.js";
export type {
  CodebaseIndex,
  ExtractedComment,
  ExtractOptions,
  ExtractResult,
  ExtractTag,
  SourceIndexFile,
  SourceSymbol,
  SourceSymbolKind,
  SourceTodoWatchResult,
  SourceTodoWatchRun,
  WatchSourceTodosOptions,
} from "./lib/extract.js";

// Config
export {
  loadConfig,
  updateConfig,
  getCompletionGuardConfig,
  getLocalApiConfig,
  normalizeApiUrl,
} from "./lib/config.js";
export type {
  TodosConfig,
  AgentConfig,
  AgentRunAdapterConfig,
  CompletionGuardConfig,
  LocalApiConfig,
  LocalEncryptionAlgorithm,
  LocalEncryptionKdf,
  LocalEncryptionProfileConfig,
  LocalEventHookConfig,
  LocalEventHookRetryConfig,
  LocalEventHookTarget,
  PolicyPackConfig,
  RunnerSandboxNetworkPolicy,
  RunnerSandboxProfile,
  WorkspacePermissionPreset,
  WorkspaceTrustProfile,
} from "./lib/config.js";
export {
  checkWorkspacePermission,
  getWorkspaceTrustStatus,
  listWorkspaceTrustProfiles,
  removeWorkspaceTrustProfile,
  upsertWorkspaceTrustProfile,
} from "./lib/workspace-trust.js";
export type {
  UpsertWorkspaceTrustInput,
  WorkspacePermissionCheck,
  WorkspacePermissionCheckInput,
  WorkspaceTrustStatus,
} from "./lib/workspace-trust.js";
export {
  checkRunnerSandbox,
  explainRunnerSandbox,
  getRunnerSandboxProfile,
  listRunnerSandboxProfiles,
  removeRunnerSandboxProfile,
  upsertRunnerSandboxProfile,
} from "./lib/runner-sandbox.js";
export {
  cancelAgentRunDispatch,
  listAgentRunAdapters,
  listAgentRunQueue,
  queueAgentRun,
  removeAgentRunAdapter,
  retryAgentRunDispatch,
  runNextAgentDispatch,
  upsertAgentRunAdapter,
} from "./lib/agent-run-dispatcher.js";
export type {
  AgentRunDispatchMetadata,
  AgentRunDispatchState,
  QueueAgentRunInput,
  QueuedAgentRun,
  RunAgentDispatchResult,
  RunNextAgentDispatchInput,
  UpsertAgentRunAdapterInput,
} from "./lib/agent-run-dispatcher.js";
export type {
  RunnerSandboxCheck,
  RunnerSandboxCheckInput,
  UpsertRunnerSandboxInput,
} from "./lib/runner-sandbox.js";
export {
  explainPolicyPack,
  getPolicyPack,
  listPolicyPacks,
  removePolicyPack,
  upsertPolicyPack,
  validatePolicyPack,
} from "./lib/policy-packs.js";
export type {
  PolicyEvidenceSummary,
  PolicyFindingSeverity,
  PolicyFindingStatus,
  PolicyPackFinding,
  PolicyPackValidationResult,
  UpsertPolicyPackInput,
  ValidatePolicyPackInput,
} from "./lib/policy-packs.js";
export {
  approveApprovalGate,
  assertApprovalGate,
  checkApprovalGate,
  expireApprovalGate,
  listApprovalGates,
  rejectApprovalGate,
  requestApprovalGate,
} from "./lib/approval-gates.js";
export type {
  ApprovalGate,
  ApprovalGateStatus,
  CheckApprovalGateResult,
  DecideApprovalGateInput,
  RequestApprovalGateInput,
} from "./lib/approval-gates.js";
export {
  LOCAL_EVENT_TYPES,
  emitLocalEventHooks,
  emitLocalEventHooksQuiet,
  getLocalEventHook,
  listLocalEventHooks,
  removeLocalEventHook,
  testLocalEventHook,
  upsertLocalEventHook,
} from "./lib/event-hooks.js";
export type {
  LocalEventEnvelope,
  LocalEventHookDispatchInput,
  LocalEventHookDispatchResult,
  LocalEventHookInput,
  LocalEventType,
} from "./lib/event-hooks.js";
export {
  describeTerminalNotificationRule,
  evaluateTerminalWatchRules,
  getTerminalNotificationRule,
  listTerminalNotificationRules,
  removeTerminalNotificationRule,
  renderTerminalNotification,
  testTerminalNotificationRule,
  upsertTerminalNotificationRule,
} from "./lib/terminal-notifications.js";
export type {
  TerminalNotification,
  TerminalNotificationEvaluation,
  TerminalNotificationRuleInput,
  TerminalWatchEventInput,
} from "./lib/terminal-notifications.js";
export { createBranchWorkPlan } from "./lib/branch-work-plans.js";
export type {
  BranchWorkPlan,
  BranchWorkPlanConflict,
  BranchWorkPlanGitStatus,
  CreateBranchWorkPlanInput,
} from "./lib/branch-work-plans.js";
export { previewNaturalLanguageIntake } from "./lib/natural-language-intake.js";
export type {
  NaturalLanguageIntakeInput,
  NaturalLanguageIntakePreview,
  NaturalLanguageTaskPreview,
} from "./lib/natural-language-intake.js";
export { resolveMentions } from "./lib/mention-resolver.js";
export type {
  MentionBacklink,
  MentionReferenceKind,
  MentionResolution,
  MentionResolutionReport,
  MentionResolverInput,
} from "./lib/mention-resolver.js";
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
  EncryptedLocalBridgeBundle,
  LocalEncryptionEnvelope,
  UpsertEncryptionProfileInput,
} from "./lib/local-encryption.js";
export {
  getTaskLocalFields,
  queryTasksByLocalFields,
  setTaskLocalFields,
} from "./lib/local-fields.js";
export type {
  LocalTaskFieldQuery,
  LocalTaskFields,
  LocalTaskSeverity,
  SetTaskLocalFieldsInput,
} from "./lib/local-fields.js";
export {
  getTaskWorkflowState,
  listWorkflowStates,
  migrateWorkflowStates,
  queryTasksByWorkflowState,
  renderWorkflowStatesMarkdown,
  resolveWorkflowState,
  setTaskWorkflowState,
} from "./lib/workflow-states.js";
export type {
  SetTaskWorkflowStateOptions,
  TaskWorkflowStateResult,
  WorkflowState,
  WorkflowStateMigrationItem,
  WorkflowStateMigrationOptions,
  WorkflowStateMigrationReport,
  WorkflowStateQuery,
  WorkflowStateQueryResult,
  WorkflowStateResolution,
} from "./lib/workflow-states.js";
export {
  findDuplicateTasks,
  mergeDuplicateTask,
} from "./lib/task-dedupe.js";
export type {
  DuplicateTaskCandidate,
  FindDuplicateTasksOptions,
  MergeDuplicateTaskInput,
  TaskMergeMovedCounts,
  TaskMergeResult,
} from "./lib/task-dedupe.js";
export {
  discoverVerificationProviderCapabilities,
  listVerificationProviders,
  removeVerificationProvider,
  runVerificationProvider,
  upsertVerificationProvider,
} from "./lib/verification-providers.js";
export type {
  RunVerificationProviderInput,
  UpsertVerificationProviderInput,
  VerificationProviderCapabilities,
  VerificationProviderResult,
  VerificationProviderStatus,
} from "./lib/verification-providers.js";
export {
  createAgentContextPack,
  renderAgentContextPack,
  renderAgentContextPackCompactMarkdown,
  renderAgentContextPackMarkdown,
} from "./lib/context-packs.js";
export type {
  AgentContextPack,
  AgentContextPackFormat,
  AgentContextPackProfile,
  AgentContextPackRelatedTask,
  AgentContextPackSection,
  AgentContextPackTask,
  CreateAgentContextPackInput,
} from "./lib/context-packs.js";
export {
  generateReleaseNotes,
  renderReleaseNotesMarkdown,
} from "./lib/release-notes.js";
export type {
  GenerateReleaseNotesInput,
  ReleaseNotesDocument,
  ReleaseNotesPlan,
  ReleaseNotesScope,
  ReleaseNotesTask,
} from "./lib/release-notes.js";
export {
  renderAgentReplaySimulationMarkdown,
  simulateAgentReplay,
  simulateAgentReplayFile,
} from "./lib/agent-replay-simulator.js";
export type {
  AgentReplayOptions,
  AgentReplaySimulation,
  AgentReplayStep,
} from "./lib/agent-replay-simulator.js";
export {
  discoverLocalExtensions,
  getLocalExtension,
  inspectExtensionSource,
  installLocalExtension,
  listLocalExtensions,
  removeLocalExtension,
  renderExtensionSummary,
  validateExtensionManifest,
  verifyExtensionSignature,
} from "./lib/local-extensions.js";
export type {
  DiscoverLocalExtensionsOptions,
  ExtensionCompatibilityReport,
  ExtensionSandboxCheck,
  ExtensionSourceInspection,
  ExtensionValidationResult,
  InstallLocalExtensionInput,
  LocalExtensionDiscoveryReport,
  VerifyExtensionSignatureInput,
} from "./lib/local-extensions.js";
export {
  getWorkflowPrompt,
  listWorkflowPrompts,
  renderWorkflowPrompt,
  renderWorkflowPromptMarkdown,
  WORKFLOW_PROMPTS,
} from "./lib/workflow-prompts.js";
export type {
  WorkflowPromptArgument,
  WorkflowPromptDefinition,
  WorkflowPromptRender,
  WorkflowPromptRenderInput,
} from "./lib/workflow-prompts.js";

// Completion Guard
export { checkCompletionGuard } from "./lib/completion-guard.js";

// Recurrence
export { parseRecurrenceRule, isValidRecurrenceRule, nextOccurrence } from "./lib/recurrence.js";
export type { ParsedRule } from "./lib/recurrence.js";

// Types
export type {
  Task,
  TaskWithRelations,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  TaskStatus,
  TaskPriority,
  TaskDependency,
  TaskComment,
  CreateCommentInput,
  Project,
  CreateProjectInput,
  ProjectSource,
  ProjectSourceRow,
  CreateProjectSourceInput,
  ChecklistItem,
  ChecklistItemRow,
  CreateChecklistItemInput,
  Plan,
  CreatePlanInput,
  UpdatePlanInput,
  PlanStatus,
  Session,
  CreateSessionInput,
  Agent,
  AgentRow,
  RegisterAgentInput,
  TaskList,
  TaskListRow,
  CreateTaskListInput,
  UpdateTaskListInput,
  LockResult,
  TaskRow,
  SessionRow,
  TaskHistory,
  Webhook,
  CreateWebhookInput,
  TaskTemplate,
  CreateTemplateInput,
  TemplateTask,
  TemplateTaskInput,
  TemplateWithTasks,
  TemplateVariable,
  TemplateVersion,
  Org,
  CreateOrgInput,
} from "./types/index.js";

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  PLAN_STATUSES,
  DISPATCH_STATUSES,
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  PlanNotFoundError,
  LockError,
  DependencyCycleError,
  AgentNotFoundError,
  TaskListNotFoundError,
  CompletionGuardError,
  DispatchNotFoundError,
} from "./types/index.js";

// Dispatch types
export type {
  Dispatch,
  DispatchStatus,
  DispatchLog,
  TmuxTarget,
  CreateDispatchInput,
  ListDispatchesFilter,
} from "./types/index.js";

// Dispatch DB functions
export {
  createDispatch,
  getDispatch,
  listDispatches,
  cancelDispatch,
  updateDispatchStatus,
  createDispatchLog,
  listDispatchLogs,
  getDueDispatches,
} from "./db/dispatches.js";

// Dispatch engine
export { executeDispatch, runDueDispatches, dispatchToMultiple } from "./lib/dispatch.js";
export {
  addTaskRunArtifact,
  addTaskRunCommand,
  addTaskRunEvent,
  addTaskRunFile,
  finishTaskRun,
  getTaskRun,
  getTaskRunLedger,
  listTaskRuns,
  redactEvidenceText,
  resolveTaskRunId,
  startTaskRun,
  verifyTaskRunArtifacts,
} from "./db/task-runs.js";
export {
  getSecretSafetyConfig,
  hasSecretFindings,
  listSecretFindings,
  redactValue,
  upsertSecretSafetyConfig,
} from "./lib/redaction.js";
export type {
  SecretFinding,
} from "./lib/redaction.js";
export type {
  SecretSafetyConfig,
} from "./lib/config.js";
export {
  RETENTION_CLEANUP_CONFIRMATION,
  applyRetentionCleanup,
  previewRetentionCleanup,
} from "./lib/retention-cleanup.js";
export type {
  ApplyRetentionCleanupInput,
  RetentionCleanupArtifactFileCandidate,
  RetentionCleanupCounts,
  RetentionCleanupInput,
  RetentionCleanupRecordCandidate,
  RetentionCleanupReport,
  RetentionCleanupRunStatus,
  RetentionCleanupScope,
} from "./lib/retention-cleanup.js";
export {
  compactScaleStorage,
  createScalePerformanceReport,
  renderScalePerformanceReportMarkdown,
} from "./lib/scale-hardening.js";
export type {
  CompactScaleStorageOptions,
  CreateScalePerformanceReportOptions,
  ScaleBenchmark,
  ScaleCompactionResult,
  ScalePerformanceReport,
} from "./lib/scale-hardening.js";
export {
  artifactStorePath,
  artifactStoreRoot,
  exportStoredArtifactContent,
  importStoredArtifactContent,
  storeArtifactContent,
  verifyStoredArtifact,
} from "./lib/artifact-store.js";
export type {
  ArtifactIntegrityReport,
  ArtifactIntegrityStatus,
  ExportedArtifactContent,
  StoredArtifactContent,
  StoredArtifactMetadata,
} from "./lib/artifact-store.js";
export type {
  TaskRun,
  TaskRunArtifact,
  TaskRunCommand,
  TaskRunCommandStatus,
  TaskRunEvent,
  TaskRunEventType,
  TaskRunLedger,
  TaskRunStatus,
} from "./db/task-runs.js";
export {
  createInboxItem,
  deriveInboxTitle,
  detectInboxSourceType,
  fingerprintInboxInput,
  getInboxItem,
  listInboxItems,
} from "./db/inbox.js";
export type { CreateInboxItemInput, InboxItem, InboxSourceType, InboxStatus } from "./db/inbox.js";
export {
  TODOS_LOCAL_BRIDGE_KIND,
  TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  validateLocalBridgeBundle,
} from "./lib/local-bridge.js";
export {
  LOCAL_BACKUP_CHECKSUM_ALGORITHM,
  TODOS_LOCAL_BACKUP_KIND,
  TODOS_LOCAL_BACKUP_SCHEMA_VERSION,
  TODOS_LOCAL_INTEGRITY_KIND,
  TODOS_LOCAL_INTEGRITY_SCHEMA_VERSION,
  checkLocalIntegrity,
  createLocalBackup,
  readLocalBackupFile,
  restoreLocalBackup,
  verifyLocalBackup,
  writeLocalBackupFile,
} from "./lib/local-backups.js";
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
  CreateLocalBackupOptions,
  LocalBackupBundle,
  LocalBackupManifest,
  LocalBackupRestoreResult,
  LocalBackupSqliteIntegrity,
  LocalBackupVerification,
  LocalIntegrityReport,
  RestoreLocalBackupOptions,
} from "./lib/local-backups.js";
export {
  TODOS_MARKDOWN_BRIDGE_MARKER,
  TODOS_MARKDOWN_SCHEMA,
  exportTodosMarkdown,
  importTodosMarkdown,
} from "./lib/todos-md.js";
export type { ImportTodosMarkdownOptions, TodosMarkdownImportResult } from "./lib/todos-md.js";
export { getLocalActivityTimeline } from "./lib/activity-timeline.js";
export type {
  LocalActivityTimelineEntityType,
  LocalActivityTimelineEntry,
  LocalActivityTimelineOptions,
  LocalActivityTimelineOrder,
  LocalActivityTimelinePage,
  LocalActivityTimelineSource,
} from "./lib/activity-timeline.js";
export { runTodosDoctor } from "./lib/doctor.js";
export type {
  DoctorBackup,
  DoctorCheck,
  DoctorRepair,
  DoctorResult,
  DoctorSeverity,
  DoctorSummary,
  RunTodosDoctorOptions,
} from "./lib/doctor.js";
export {
  captureEnvironmentSnapshot,
  compareEnvironmentSnapshotFiles,
  compareEnvironmentSnapshots,
  readEnvironmentSnapshot,
  recordEnvironmentSnapshot,
  writeEnvironmentSnapshot,
} from "./lib/environment-snapshots.js";
export type {
  CaptureEnvironmentSnapshotInput,
  EnvironmentSnapshot,
  EnvironmentSnapshotComparison,
  EnvironmentSnapshotFile,
  EnvironmentSnapshotManifest,
  RecordedEnvironmentSnapshot,
  RecordEnvironmentSnapshotInput,
} from "./lib/environment-snapshots.js";
export {
  checkTaskDoneContract,
  getTaskContract,
  getTaskReview,
  recordTaskReview,
  requestTaskReview,
  setTaskContract,
} from "./lib/task-contracts.js";
export type {
  RecordTaskReviewInput,
  RecordableTaskReviewState,
  RequestTaskReviewInput,
  SetTaskContractInput,
  TaskContract,
  TaskDoneContractResult,
  TaskReview,
  TaskReviewHistoryEntry,
  TaskReviewState,
  TaskRiskLevel,
} from "./lib/task-contracts.js";
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

export {
  LOCAL_CAPACITY_SCHEMA_VERSION,
  getPlanningForecast,
  listCapacityProfiles,
  removeCapacityProfile,
  renderPlanningForecastMarkdown,
  upsertCapacityProfile,
} from "./lib/capacity-forecasts.js";
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

export {
  LOCAL_AUDIT_LEDGER_HASH_ALGORITHM,
  LOCAL_AUDIT_LEDGER_SCHEMA_VERSION,
  getLocalAuditLedger,
  listLocalAuditLedgerCheckpoints,
  renderLocalAuditLedgerMarkdown,
  sealLocalAuditLedger,
  verifyLocalAuditLedger,
} from "./lib/audit-ledger.js";
export type {
  LocalAuditLedger,
  LocalAuditLedgerEntry,
  LocalAuditLedgerInput,
  LocalAuditLedgerScope,
  LocalAuditLedgerSource,
  LocalAuditLedgerVerifyResult,
  SealLocalAuditLedgerInput,
} from "./lib/audit-ledger.js";

export {
  LOCAL_RELEASE_COMPATIBILITY_SCHEMA_VERSION,
  createReleaseCompatibilityReport,
  renderReleaseCompatibilityMarkdown,
} from "./lib/release-compatibility.js";
export type {
  CreateReleaseCompatibilityReportOptions,
  ReleaseCompatibilityCheck,
  ReleaseCompatibilityReport,
  ReleaseCompatibilityStatus,
} from "./lib/release-compatibility.js";

export {
  EXTERNAL_ISSUE_IMPORT_SCHEMA_VERSION,
  importExternalIssues,
} from "./lib/external-issue-importers.js";
export {
  LOCAL_NOTIFICATION_SCHEMA_VERSION,
  checkLocalNotifications,
} from "./lib/local-notifications.js";
export {
  LOCAL_USAGE_LEDGER_SCHEMA_VERSION,
  createLocalUsageLedger,
  renderLocalUsageLedgerMarkdown,
} from "./lib/usage-ledger.js";
export {
  LOCAL_REPORT_SCHEMA_VERSION,
  LOCAL_REPORT_TYPES,
  createLocalReport,
  listLocalReportTypes,
  renderLocalReportMarkdown,
} from "./lib/local-reports.js";
export type {
  ExternalIssueExistingMatch,
  ExternalIssueImportInput,
  ExternalIssueImportResult,
  ExternalIssueProvider,
  ExternalIssueRecord,
} from "./lib/external-issue-importers.js";
export type {
  CheckLocalNotificationsInput,
  CheckLocalNotificationsResult,
  LocalNotificationAlert,
  LocalNotificationKind,
  LocalNotificationQuietHours,
  LocalNotificationSeverity,
} from "./lib/local-notifications.js";
export type {
  UsageLedgerOptions,
  UsageLedgerQuotaInput,
  UsageLedgerQuotaResult,
  UsageLedgerReport,
} from "./lib/usage-ledger.js";
export type {
  LocalReport,
  LocalReportAgentSummary,
  LocalReportBlockedTask,
  LocalReportOptions,
  LocalReportPlanSummary,
  LocalReportRunSummary,
  LocalReportTaskSummary,
  LocalReportTaskView,
  LocalReportType,
  LocalReportVerificationSummary,
} from "./lib/local-reports.js";
export {
  COMPLETION_SHELLS,
  collectCliCommandEntries,
  createCliManual,
  generateCompletionScript,
  renderCliManualMarkdown,
} from "./lib/cli-help.js";
export type {
  CliCommandEntry,
  CliManual,
  CliOptionEntry,
  CompletionShell,
} from "./lib/cli-help.js";
export {
  TUI_DASHBOARD_VIEWS,
  createTuiDashboardSnapshot,
  renderTuiDashboardSnapshot,
} from "./lib/tui-dashboard.js";
export type {
  CreateTuiDashboardSnapshotOptions,
  TuiDashboardDependency,
  TuiDashboardPlan,
  TuiDashboardProject,
  TuiDashboardSnapshot,
  TuiDashboardView,
} from "./lib/tui-dashboard.js";

// Dispatch formatter
export { formatDispatchMessage, formatSingleTask } from "./lib/dispatch-formatter.js";
export type { FormatOpts } from "./lib/dispatch-formatter.js";

// tmux primitives
export { parseTmuxTarget, formatTmuxTarget, validateTmuxTarget, sendToTmux, calculateDelay, DELAY_MIN, DELAY_MAX } from "./lib/tmux.js";

// Storage/service adapter boundary
export { createLocalSqliteTodosStorageAdapter } from "./storage.js";
export type {
  CreateLocalSqliteTodosStorageAdapterOptions,
  MaybePromise,
  TodosActiveWorkFilter,
  TodosAgentUpdateInput,
  TodosAgentStore,
  TodosAuditStore,
  TodosPlanStore,
  TodosProjectStore,
  TodosStorageAdapter,
  TodosStorageCapabilities,
  TodosStorageContext,
  TodosStorageImportResult,
  TodosStorageKind,
  TodosStorageSnapshot,
  TodosSyncStore,
  TodosTaskClaimFilter,
  TodosTaskCompletionOptions,
  TodosTaskFailureOptions,
  TodosTaskFailureResult,
  TodosTaskListStore,
  TodosTaskStore,
  TodosTemplateStore,
} from "./storage.js";
