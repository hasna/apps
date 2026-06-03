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

// Artifacts (local-only attachment store)
export {
  addArtifact,
  getArtifact,
  listArtifacts,
  softDeleteArtifact,
  purgeArtifact,
  cleanupArtifacts,
  exportArtifacts,
  importArtifactFromManifestEntry,
  updateArtifactRedaction,
  ARTIFACT_ENTITY_TYPES,
  ARTIFACT_STORAGE_MODES,
  ARTIFACT_REDACTION_STATUSES,
} from "./db/artifacts.js";
export type {
  Artifact,
  ArtifactEntityType,
  ArtifactStorageMode,
  ArtifactRedactionStatus,
  AddArtifactInput,
  ListArtifactsFilter,
  ImportArtifactInput,
} from "./db/artifacts.js";
export {
  getArtifactStoreRoot,
  computeContentHash,
  buildArtifactExportManifest,
  writeArtifactExportManifest,
  isArtifactExpired,
} from "./lib/artifact-store.js";
export type { ArtifactExportEntry, ArtifactExportManifest, CleanupPolicy, StoredArtifactFile } from "./lib/artifact-store.js";

// Headless boundaries
export {
  getHeadlessBoundaryManifest,
  isAllowedLocalApiUrl,
  assertHeadlessOutboundUrl,
  scanSourceForForbiddenWebPatterns,
  HEADLESS_BOUNDARY_VERSION,
  FORBIDDEN_HOSTED_HOSTS,
  FORBIDDEN_WEB_PATTERNS,
} from "./lib/headless-boundaries.js";
export type { HeadlessBoundaryManifest } from "./lib/headless-boundaries.js";

// Goal workflow (/goal compatibility)
export {
  parseGoalCommand,
  createGoalWorkflow,
  getGoalProgress,
  claimGoalStep,
  logGoalProgress,
  formatGoalHandoff,
  resolvePlanId,
  getGoalCommandRecipesMarkdown,
  GOAL_COMMAND_RECIPES,
  GOAL_WORKFLOW_VERSION,
} from "./lib/goal-workflow.js";
export type {
  GoalStep,
  GoalInput,
  GoalManifest,
  GoalProgress,
  ParsedGoalCommand,
} from "./lib/goal-workflow.js";

// Verification providers
export {
  loadVerificationProviders,
  saveVerificationProviders,
  getVerificationProvider,
  runVerification,
  listVerificationRecords,
  getVerificationRecord,
  getDefaultProviders,
  resetVerificationProviderCache,
  VERIFICATION_SCHEMA_VERSION,
  VERIFICATION_PROVIDER_TYPES,
  VERIFICATION_STATUSES,
} from "./lib/verification-providers.js";
export type {
  VerificationProviderConfig,
  VerificationEvidenceRecord,
  VerificationProviderType,
  VerificationStatus,
  RunVerificationInput,
  VerificationProvidersFile,
} from "./lib/verification-providers.js";

// Portable verification evidence
export {
  VERIFICATION_EVIDENCE_SCHEMA,
  createVerificationEvidence,
  listVerificationEvidence,
  getVerificationEvidence,
  exportVerificationEvidence,
  writeVerificationExport,
  toPortableEvidence,
} from "./lib/verification-evidence.js";
export type {
  PortableVerificationEvidence,
  CreateVerificationEvidenceInput,
  VerificationExportBundle,
  VerificationCommandEntry,
  VerificationTestResult,
  VerificationLinkRef,
} from "./lib/verification-evidence.js";

// Local encryption
export {
  encryptValue,
  decryptValue,
  encryptSensitiveFields,
  decryptSensitiveFields,
  redactObject,
  applyExportProfile,
  assertExportProfileAllowed,
  initEncryptionKeyFile,
  loadEncryptionKey,
  getEncryptionKeySource,
  isEncryptedPayload,
  ENCRYPTION_SCHEMA_VERSION,
  EXPORT_PROFILES,
} from "./lib/local-encryption.js";
export type { EncryptedPayload, ExportProfile, ExportBundleOptions } from "./lib/local-encryption.js";

// Context packs
export {
  buildContextPack,
  formatContextPackMarkdown,
  formatContextPackJson,
  CONTEXT_PACK_VERSION,
} from "./lib/context-packs.js";
export type { ContextPack, ContextPackInput } from "./lib/context-packs.js";

// Policy packs
export {
  loadPolicyPacks,
  savePolicyPacks,
  getPolicyPack,
  validateTaskAgainstPolicyPack,
  assertPolicyPackPassed,
  resolveProjectPolicyPack,
  getDefaultPolicyPacks,
  resetPolicyPackCache,
  POLICY_PACK_VERSION,
} from "./lib/policy-packs.js";
export type { PolicyPack, PolicyRule, PolicyRuleType, PolicyValidationResult } from "./lib/policy-packs.js";

// Resource snapshots
export {
  buildResourceSnapshot,
  subscribeResource,
  unsubscribeResource,
  listSubscriptions,
  isSnapshotStale,
  getChangedResourcesSince,
  resourceDiagnostics,
  resetSubscriptions,
  RESOURCE_URIS,
  RESOURCE_SNAPSHOT_VERSION,
} from "./lib/resource-snapshots.js";
export type { ResourceSnapshot, ResourceSubscription, ResourceUri } from "./lib/resource-snapshots.js";

// Sandbox profiles
export {
  loadSandboxProfiles,
  saveSandboxProfiles,
  getSandboxProfile,
  checkSandboxCommand,
  getDefaultSandboxProfiles,
  resetSandboxProfileCache,
  SANDBOX_PROFILE_VERSION,
} from "./lib/sandbox-profiles.js";
export type { SandboxProfile, SandboxCheckInput, SandboxCheckResult } from "./lib/sandbox-profiles.js";

// Agent run dispatcher
export {
  loadAgentAdapters,
  saveAgentAdapters,
  getAgentAdapter,
  getDefaultAgentAdapters,
  resetAgentAdapterCache,
  enqueueAgentRun,
  claimNextAgentRun,
  completeAgentRun,
  failAgentRun,
  cancelAgentRun,
  retryAgentRun,
  listAgentRuns,
  getAgentRun,
  AGENT_RUN_SCHEMA_VERSION,
} from "./lib/agent-run-dispatcher.js";
export type {
  AgentAdapterConfig,
  AgentRun,
  AgentRunStatus,
  EnqueueAgentRunInput,
  ListAgentRunsFilter,
} from "./lib/agent-run-dispatcher.js";

// Git traceability
export {
  linkTaskToCommit,
  getTaskCommits,
  findTaskByCommit,
  unlinkTaskCommit,
  getTaskTraceability,
} from "./db/task-commits.js";
export type { TaskCommit, CiSnapshot, TaskTraceabilityReport, LinkTaskToCommitInput } from "./db/task-commits.js";
export {
  linkTaskGitTrace,
  inspectGitCommit,
  getHeadSha,
  getCurrentBranch,
  resolveGitRoot,
  loadCiSnapshot,
  detectPrForBranch,
  formatTraceabilityReport,
  GIT_TRACEABILITY_SCHEMA_VERSION,
} from "./lib/git-traceability.js";
export type { GitCommitInfo, LinkGitTraceInput } from "./lib/git-traceability.js";

// Mention resolver
export {
  MENTION_RESOLVER_SCHEMA,
  MENTION_KINDS,
  parseMentions,
  resolveMention,
  resolveMentionsInText,
  formatResolvedMention,
  formatMentionResolutionResult,
  getMentionResolverDocs,
} from "./lib/mention-resolver.js";
export type {
  MentionKind,
  MentionStatus,
  ParsedMention,
  ResolvedMention,
  MentionResolutionResult,
  ResolveMentionOptions,
} from "./lib/mention-resolver.js";

// Labels and custom fields
export {
  createLabel, getLabel, listLabels, updateLabel, deleteLabel,
  assignLabelToTask, removeLabelFromTask, getTaskLabels,
} from "./db/labels.js";
export type { Label, CreateLabelInput, UpdateLabelInput } from "./db/labels.js";
export {
  createCustomFieldDefinition, getCustomFieldDefinition, listCustomFieldDefinitions,
  deleteCustomFieldDefinition, setTaskCustomField, getTaskCustomFields,
  setTaskPriorityMeta, exportTaskFields, CUSTOM_FIELD_TYPES,
} from "./db/custom-fields.js";
export type { CustomFieldDefinition, CustomFieldType, TaskCustomFieldValue } from "./db/custom-fields.js";

// Task dedupe and merge
export {
  findDuplicateCandidates,
  scoreDuplicatePair,
  mergeTasks,
  formatDuplicatePreview,
  DEDUPE_SCHEMA_VERSION,
} from "./lib/task-dedupe.js";
export type { DuplicateCandidate, DuplicateSignal, FindDuplicatesFilter, MergeTasksInput, MergeTasksResult } from "./lib/task-dedupe.js";

// todos.md markdown
export {
  parseTodosMd,
  serializeTodosMd,
  exportTodosMd,
  importTodosMd,
  syncTodosMd,
  startTodosMdWatch,
  stopTodosMdWatch,
  TODOS_MD_VERSION,
  TODOS_MD_SCHEMA,
} from "./lib/todos-md.js";
export type { TodosMdDocument, TodosMdTaskLine, ImportTodosMdResult, ExportTodosMdOptions, SyncTodosMdResult } from "./lib/todos-md.js";

// Workspace trust
export {
  loadWorkspaceTrustConfig,
  saveWorkspaceTrustConfig,
  getWorkspaceTrustProfile,
  getAgentTrustProfile,
  checkPermission,
  assertPermission,
  trustWorkspace,
  untrustWorkspace,
  isWorkspaceTrusted,
  getDefaultWorkspaceTrustProfiles,
  resetWorkspaceTrustCache,
  WorkspacePermissionError,
  WORKSPACE_TRUST_VERSION,
  PERMISSION_OPERATIONS,
} from "./lib/workspace-trust.js";
export type { WorkspaceTrustProfile, WorkspaceTrustConfig, PermissionOperation } from "./lib/workspace-trust.js";

// Approval gates
export {
  requestApproval,
  approveGate,
  rejectGate,
  listPendingApprovals,
  getTaskGateStatus,
  createManualCheckpoint,
  enablePlanApprovalGates,
  assertTaskGate,
  approveTaskViaGate,
  listTasksAwaitingApproval,
  APPROVAL_GATE_SCHEMA,
  GATE_TYPES,
} from "./lib/approval-gates.js";
export type { ApprovalRequest, GateType, TaskGateStatus, RequestApprovalInput } from "./lib/approval-gates.js";

// Agent coordination leases
export {
  acquireTaskLease,
  renewTaskLease,
  releaseTaskLease,
  stealTaskLease,
  recoverStaleLeases,
  listActiveLeases,
  listExpiredLeases,
  getTaskLease,
  formatLockConflict,
  AGENT_COORDINATION_SCHEMA,
  DEFAULT_LEASE_MINUTES,
} from "./lib/agent-coordination.js";
export type { TaskLease, LeaseAcquireResult, LockConflict, StaleRecoveryResult } from "./lib/agent-coordination.js";

// Project bootstrap
export {
  discoverWorkspace,
  bootstrapWorkspace,
  getBootstrapStatus,
  formatBootstrapReport,
  BOOTSTRAP_SCHEMA,
} from "./lib/project-bootstrap.js";
export type { WorkspaceDiscovery, BootstrapResult } from "./lib/project-bootstrap.js";

// CLI MCP parity
export {
  CLI_MCP_PARITY_MANIFEST,
  getParityReport,
  validateParityManifest,
  findParityForMcpTool,
  findParityForCliCommand,
  normalizeErrorContract,
  PARITY_SCHEMA_VERSION,
} from "./lib/cli-mcp-parity.js";
export type { ParityEntry, ParityReport, ParityDomain, ErrorContract } from "./lib/cli-mcp-parity.js";

// Secret redaction
export {
  scanTextForSecrets,
  redactText,
  scanAndRedactText,
  scanFileForSecrets,
  safeStringify,
  assertNoSecrets,
  redactCommentContent,
  redactHandoffPayload,
  redactExportRecord,
  getDefaultSecretPatterns,
  registerCustomRedactor,
  resetCustomRedactors,
  SECRET_REDACTION_SCHEMA,
  REDACTION_PLACEHOLDER,
} from "./lib/secret-redaction.js";
export type { SecretMatch, SecretScanResult, RedactionOptions, SecretPattern } from "./lib/secret-redaction.js";

// Access profiles
export {
  ACCESS_PROFILES,
  resolveAccessProfile,
  getAccessProfileMeta,
  listAccessProfiles,
  shouldRegisterToolForProfile as shouldRegisterToolForAccessProfile,
  assertToolAllowed,
  getHeadlessUsageNotes,
  getProfileToolCount,
  ACCESS_PROFILE_SCHEMA,
} from "./lib/access-profiles.js";
export type { AccessProfile, AccessProfileMeta } from "./lib/access-profiles.js";

// Agent adapter docs
export {
  ADAPTER_DOCS_SCHEMA_VERSION,
  AGENT_ADAPTER_HOSTS,
  AGENT_ADAPTER_DOCS,
  normalizeAdapterHost,
  getAgentAdapterDoc,
  listAgentAdapterDocs,
  validateAdapterDocs,
  renderAdapterDocMarkdown,
  renderAllAdapterDocsMarkdown,
  getAdapterDocsFingerprint,
} from "./lib/agent-adapter-docs.js";
export type { AgentAdapterHost, AgentAdapterDoc, AdapterWorkflowStep, AdapterFailureMode } from "./lib/agent-adapter-docs.js";

// Inbox intake
export {
  INBOX_INTAKE_SCHEMA,
  INTAKE_SOURCE_TYPES,
  INTAKE_TRIAGE_STATUSES,
  detectSourceType,
  parseCiLog,
  parseErrorPaste,
  parseFeedback,
  previewInboxIntake,
  createInboxIntake,
  formatIntakePreviewText,
} from "./lib/inbox-intake.js";
export type { IntakeSourceType, IntakeTriageStatus, IntakeInput, IntakePreview, IntakeResult, IntakeOptions } from "./lib/inbox-intake.js";

// Natural-language intake
export {
  NL_INTAKE_SCHEMA,
  parseNaturalLanguageTask,
  previewNlIntake,
  createNlIntake,
  formatNlIntakePreviewText,
} from "./lib/nl-intake.js";
export type {
  ParsedNlFields,
  NlIntakeExplain,
  NlIntakeInput,
  NlIntakePreview,
  NlIntakeResult,
  ParseNaturalLanguageOptions,
} from "./lib/nl-intake.js";

// External issue importers
export {
  ISSUE_IMPORT_SCHEMA,
  ISSUE_SOURCES,
  detectIssueExportSource,
  parseIssueExport,
  loadIssueExportFromFile,
  previewIssueImport,
  importIssues,
  formatIssueImportPreviewText,
  getIssueImportDocs,
} from "./lib/issue-importers.js";
export type {
  IssueSource,
  ResolvedIssueSource,
  NormalizedExternalIssue,
  IssueImportInput,
  IssueImportPreviewItem,
  IssueImportPreview,
  IssueImportOptions,
  IssueImportResult,
} from "./lib/issue-importers.js";

// Run records
export {
  RUN_RECORD_SCHEMA,
  RUN_RECORD_STATUSES,
  createRunRecord,
  getRunRecord,
  listRunRecords,
  appendRunCommand,
  recordFilesTouched,
  linkRunVerification,
  linkRunArtifact,
  completeRunRecord,
  failRunRecord,
  buildRunReplayBundle,
  exportRunReplay,
  formatRunRecordMarkdown,
  getDefaultReplayDir,
} from "./lib/run-records.js";
export type {
  RunRecordStatus,
  RunRecord,
  RunCommandEntry,
  RunStatusTransition,
  RunVerificationRef,
  CreateRunRecordInput,
  ListRunRecordsFilter,
  RunReplayBundle,
} from "./lib/run-records.js";

// Release checks
export {
  RELEASE_CHECK_SCHEMA,
  auditPackageContents,
  scanDistArtifacts,
  validateReleaseScripts,
  runReleaseChecks,
  formatReleaseCheckReport,
  getReleaseWorkflowDocs,
} from "./lib/release-checks.js";
export type { ReleaseCheckSeverity, ReleaseCheckItem, ReleaseCheckReport, ReleaseCheckOptions } from "./lib/release-checks.js";

// Release notes
export {
  RELEASE_NOTES_SCHEMA,
  CHANGELOG_CATEGORIES,
  parseConventionalCommit,
  mapCommitTypeToCategory,
  getLatestGitTag,
  resolveSinceRef,
  getGitLogSince,
  getCompletedTasksForRelease,
  buildReleaseNotes,
  formatReleaseNotesMarkdown,
  formatChangelogSection,
  updateChangelog,
  getReleaseNotesDocs,
} from "./lib/release-notes.js";
export type {
  ChangelogCategory,
  GitCommitEntry,
  TaskReleaseEntry,
  ReleaseNotesReport,
  BuildReleaseNotesInput,
  UpdateChangelogInput,
} from "./lib/release-notes.js";

// Database backup
export {
  DB_BACKUP_SCHEMA,
  backupDatabase,
  restoreDatabase,
  checkDatabaseIntegrity,
  compactDatabase,
  migrationDryRun,
  defaultBackupPath,
  writeBackupManifest,
  readBackupManifest,
} from "./lib/db-backup.js";
export type { BackupResult, IntegrityResult, MigrationDryRunResult } from "./lib/db-backup.js";

// JSON schemas
export {
  JSON_SCHEMA_CATALOG_VERSION,
  SCHEMA_SEMVER,
  SCHEMA_ENTITIES,
  JSON_SCHEMAS,
  SCHEMA_CONTRACT_FIXTURES,
  validateSchemaPayload,
  validateAllContractFixtures,
  checkSchemaCompatibility,
  listJsonSchemas,
  getJsonSchema,
  getSchemaSemverGuidance,
  exportSchemasToDirectory,
  wrapWithSchemaVersion,
} from "./lib/json-schemas.js";
export type {
  SchemaEntity,
  JsonSchemaDefinition,
  JsonSchemaProperty,
  SchemaValidationIssue,
  SchemaValidationResult,
  SchemaCompatibilityResult,
} from "./lib/json-schemas.js";

// Activity audit
export {
  ACTIVITY_LOG_SCHEMA,
  ACTIVITY_ENTITY_TYPES,
  logActivity,
  listActivity,
  getActivityTimeline,
  exportActivityLog,
  importActivityLog,
  redactActivityRecord,
  formatActivityRecordText,
} from "./lib/activity-audit.js";
export type {
  ActivityEntityType,
  ActivityRecord,
  LogActivityInput,
  ListActivityFilter,
  ActivityExportBundle,
} from "./lib/activity-audit.js";

// Task scheduling
export {
  TASK_SCHEDULING_SCHEMA,
  scheduleTask,
  listDelayedStartTasks,
  listReadyScheduledTasks,
  getAgentSafeQueue,
  getStaleTaskReport,
  getSchedulingSummary,
  previewNextRecurrence,
  agentClaimNextSafe,
  getAgentLoopDocs,
} from "./lib/task-scheduling.js";
export type { ScheduleTaskInput, StaleTaskReport, SchedulingQueueItem, SchedulingSummary } from "./lib/task-scheduling.js";

// Saved views / unified search
export {
  SAVED_VIEWS_SCHEMA,
  createSavedView,
  getSavedView,
  listSavedViews,
  deleteSavedView,
  unifiedSearch,
  runSavedView,
  getBuiltinSavedViews,
} from "./lib/saved-views.js";
export type { SearchEntityType, SavedView, UnifiedSearchInput, SearchHit, UnifiedSearchResult } from "./lib/saved-views.js";

// Notification reminders
export {
  NOTIFICATION_REMINDERS_SCHEMA,
  REMINDER_TYPES,
  REMINDER_STATUSES,
  createReminder,
  getReminder,
  listReminders,
  dismissReminder,
  snoozeReminder,
  scanReminders,
  processDueReminders,
  getReminderSummary,
  getReminderPreferences,
  setReminderPreferences,
  getUpcomingDueTasks,
  notifyUpcomingDeadlines,
  getReminderDocs,
} from "./lib/notification-reminders.js";
export type {
  ReminderType,
  ReminderStatus,
  ReminderPreferences,
  NotificationReminder,
  ScanRemindersResult,
  ProcessRemindersResult,
  ReminderSummary,
  CreateReminderInput,
} from "./lib/notification-reminders.js";

// Terminal notifications / watch rules
export {
  TERMINAL_NOTIFICATIONS_SCHEMA,
  WATCH_EVENT_TYPES,
  ensureDefaultWatchRules,
  createWatchRule,
  updateWatchRule,
  deleteWatchRule,
  getWatchRule,
  listWatchRules,
  ruleMatchesEvent,
  collectWatchEvents,
  formatTerminalNotification,
  pollWatchNotifications,
  getWatchStatus,
  getWatchPreferences,
  setWatchPreferences,
  syncConfigWatchRules,
  getWatchDocs,
} from "./lib/terminal-notifications.js";
export type {
  WatchEventType,
  WatchSeverity,
  WatchEvent,
  WatchRule,
  WatchPreferences,
  CreateWatchRuleInput,
  UpdateWatchRuleInput,
  PollWatchOptions,
  PollWatchResult,
  WatchStatus,
} from "./lib/terminal-notifications.js";

// Import/export bridge
export {
  BUNDLE_SCHEMA,
  BUNDLE_TYPES,
  MERGE_STRATEGIES,
  exportLocalBundle,
  validateBundle,
  previewSync,
  importBundle,
  writeBundleFile,
  readBundleFile,
  getBridgeDocs,
} from "./lib/import-export-bridge.js";
export type {
  ImportExportBundle,
  ExportLocalBundleOptions,
  SyncConflict,
  SyncPreview,
  ImportBundleOptions,
  ImportResult,
  BundleType,
  MergeStrategy,
  ConflictType,
} from "./lib/import-export-bridge.js";

// Dependency graph
export {
  DEPENDENCY_GRAPH_SCHEMA,
  getReadyTasks,
  getBlockedTaskReports,
  getCriticalPath,
  getUnlockImpact,
  analyzeDependencyGraph,
  getDependents,
  getBlockers,
} from "./lib/dependency-graph.js";
export type {
  DependencyNode,
  BlockedTaskReport,
  ReadyTaskReport,
  CriticalPathEntry,
  UnlockImpactReport,
  DependencyGraphAnalysis,
  GraphFilter,
} from "./lib/dependency-graph.js";

// Plan execution
export {
  PLAN_EXECUTION_SCHEMA,
  PLAN_EXECUTION_MODES,
  attachPlanToProject,
  materializePlanSteps,
  getPlanExecutionState,
  claimPlanStep,
  exportPlanExecutionContract,
  createPlanWithSteps,
  resolvePlanRef,
} from "./lib/plan-execution.js";
export type {
  PlanExecutionMode,
  PlanStepInput,
  PlanExecutionManifest,
  PlanExecutionState,
  AttachPlanInput,
  MaterializePlanInput,
} from "./lib/plan-execution.js";

// Handoff packets
export {
  HANDOFF_PACKET_SCHEMA,
  buildHandoffPacket,
  createHandoffPacket,
  formatHandoffPacket,
  exportHandoffPacket,
  getLatestHandoffPacket,
  getStoredHandoffAsPacket,
} from "./lib/handoff-packets.js";
export type {
  HandoffPacket,
  HandoffPacketContext,
  HandoffTaskSummary,
  BuildHandoffPacketInput,
} from "./lib/handoff-packets.js";

// TUI dashboard
export {
  TUI_DASHBOARD_SCHEMA,
  initialDashboardState,
  reduceDashboardState,
  loadDashboardData,
  clampSelectedIndex,
  executeDashboardTaskAction,
  listDashboardProjects,
  KEYBOARD_HELP,
  DASHBOARD_PANELS,
} from "./lib/tui-dashboard.js";
export type {
  DashboardState,
  DashboardData,
  DashboardPanel,
  DashboardFilter,
  DashboardAction,
  DashboardTaskRow,
} from "./lib/tui-dashboard.js";

// CLI reference, completions, manpage
export {
  CLI_REFERENCE_SCHEMA,
  CLI_COMMAND_GROUPS,
  ENV_VARS,
  EXIT_CODES,
  JSON_OUTPUT_CONTRACT,
  listTopLevelCommands,
  NESTED_SUBCOMMANDS,
  getCommandHelp,
  getInstallInstructions,
} from "./lib/cli-reference.js";
export type { CliCommandRef, CliCommandGroup, ExitCodeRef, EnvVarRef } from "./lib/cli-reference.js";
export {
  COMPLETIONS_SCHEMA,
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  generateCompletionInstallScript,
} from "./lib/cli-completions.js";
export {
  MANPAGE_SCHEMA,
  generateManpage,
  generateCliReferenceMarkdown,
} from "./lib/cli-manpage.js";

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

// Template library
export {
  listTemplateLibrary,
  getBuiltinTemplate as getBuiltinTemplateFromLibrary,
  previewBuiltinTemplate,
  installTemplateLibrary,
  exportTemplateLibraryCatalog,
  exportInstalledTemplate,
  importTemplateFromFile,
  previewInstalledTemplate,
  getTemplateLibraryDocs,
} from "./lib/template-library.js";
export type { TemplateLibraryEntry, TemplateLibraryCatalog, TemplateLibraryExport } from "./lib/template-library.js";

// Machine topology
export {
  MACHINE_TOPOLOGY_SCHEMA,
  registerLocalMachine,
  getPathOverrides,
  getMachineAgentSummaries,
  buildMachineTopologyReport,
  getReachableHostnames,
  getTopologyDocs,
} from "./lib/machine-topology.js";
export type {
  MachinePathOverride,
  MachineAgentSummary,
  MachineTopologyNode,
  MachineTopologyReport,
} from "./lib/machine-topology.js";

// Environment snapshots
export {
  ENV_SNAPSHOT_SCHEMA,
  buildEnvSnapshotPayload,
  captureEnvSnapshot,
  getEnvSnapshot,
  listEnvSnapshots,
  checkEnvSnapshot,
  computeSnapshotHash,
} from "./lib/environment-snapshots.js";
export type {
  EnvCommandVersion,
  EnvSnapshotPayload,
  EnvSnapshotRecord,
  CaptureEnvSnapshotInput,
  EnvSnapshotCheckResult,
} from "./lib/environment-snapshots.js";

// Decision records and knowledge snapshots
export {
  DECISION_RECORD_SCHEMA,
  KNOWLEDGE_SNAPSHOT_SCHEMA,
  DECISION_STATUSES,
  KNOWLEDGE_SNAPSHOT_SOURCES,
  createDecisionRecord,
  getDecisionRecord,
  getDecisionRecordByRef,
  listDecisionRecords,
  updateDecisionRecord,
  setDecisionStatus,
  supersedeDecisionRecord,
  formatDecisionRecordMarkdown,
  exportDecisionRecord,
  buildKnowledgeSnapshotPayload,
  captureKnowledgeSnapshot,
  getKnowledgeSnapshot,
  listKnowledgeSnapshots,
  formatKnowledgeSnapshotMarkdown,
  exportKnowledgeSnapshot,
  getDecisionRecordsDocs,
} from "./lib/decision-records.js";
export type {
  DecisionStatus,
  KnowledgeSnapshotSource,
  DecisionAlternative,
  DecisionRecord,
  CreateDecisionRecordInput,
  UpdateDecisionRecordInput,
  ListDecisionRecordsFilter,
  KnowledgeSnapshotDecisionSummary,
  KnowledgeSnapshotPayload,
  KnowledgeSnapshotRecord,
  CaptureKnowledgeSnapshotInput,
  ListKnowledgeSnapshotsFilter,
} from "./lib/decision-records.js";

// Report exports
export {
  REPORT_EXPORT_SCHEMA,
  REPORT_KINDS,
  REPORT_FORMATS,
  buildReportExportData,
  formatReportMarkdown,
  formatReportHtml,
  formatReportExport,
  writeReportExport,
  exportReport,
  getReportExportDocs,
} from "./lib/report-exports.js";
export type {
  ReportKind,
  ReportFormat,
  ReportSection,
  ReportExportData,
  BuildReportExportInput,
} from "./lib/report-exports.js";

// Command aliases
export {
  COMMAND_ALIASES_SCHEMA,
  validateAliasName,
  loadAliasStore,
  saveAliasStore,
  listCommandAliases,
  getCommandAlias,
  saveCommandAlias,
  deleteCommandAlias,
  resolveCommandQuery,
  explainCommandQuery,
  exportCommandAliases,
  importCommandAliases,
  getCommandAliasDocs,
  listBuiltinShortcuts,
} from "./lib/command-aliases.js";
export type {
  CommandAlias,
  AliasStore,
  QueryResolution,
  ImportAliasesResult,
} from "./lib/command-aliases.js";

// Failure triage
export {
  FAILURE_TRIAGE_SCHEMA,
  FAILURE_CLASSES,
  buildFailureTriageReport,
  applyFailureTriage,
  formatFailureTriageMarkdown,
  getFailureTriageDocs,
} from "./lib/failure-triage.js";
export type {
  FailureClass,
  FailureTriageItem,
  FailureTriageReport,
  ApplyFailureTriageInput,
  ApplyFailureTriageResult,
} from "./lib/failure-triage.js";

// Branch work plans
export {
  BRANCH_WORK_PLAN_SCHEMA,
  analyzeBranchWork,
  generateSafeWorkPlan,
  resolveDefaultBaseBranch,
  formatSafeWorkPlanMarkdown,
  formatSafeWorkPlanText,
  getBranchWorkPlanDocs,
} from "./lib/branch-work-plans.js";
export type {
  WorkPlanRisk,
  WorkPlanStrategy,
  BranchWorkPlanInput,
  BranchRefInfo,
  BranchConflictFile,
  BranchWorkAnalysis,
  WorkPlanStep,
  SafeWorkPlan,
} from "./lib/branch-work-plans.js";

// User scaffolds
export {
  USER_SCAFFOLD_SCHEMA,
  SCAFFOLD_KINDS,
  loadUserScaffoldStore,
  saveUserScaffoldStore,
  listUserScaffolds,
  getUserScaffold,
  createUserScaffold,
  updateUserScaffold,
  previewUserScaffold,
  applyUserScaffold,
  exportUserScaffold,
  importUserScaffold,
  linkTemplateAsScaffold,
  getUserScaffoldDocs,
  listLinkedTemplates,
} from "./lib/user-scaffolds.js";
export type { ScaffoldKind, UserScaffold, UserScaffoldStore, ScaffoldPreview } from "./lib/user-scaffolds.js";

// Agent workflow demo
export {
  AGENT_WORKFLOW_DEMO_SCHEMA,
  DEMO_DEFAULT_AGENT,
  DEMO_DEFAULT_PROJECT,
  DEMO_PROJECT_PATH,
  runAgentWorkflowDemo,
  setupEphemeralDemoDb,
  normalizeAgentWorkflowDemoResult,
  formatAgentWorkflowDemoReport,
  getAgentWorkflowDemoDocs,
} from "./lib/agent-workflow-demo.js";
export type {
  DemoStep,
  AgentWorkflowDemoResult,
  RunAgentWorkflowDemoOptions,
  EphemeralDbHandle,
} from "./lib/agent-workflow-demo.js";

// Feature manifest
export {
  FEATURE_MANIFEST_SCHEMA,
  FEATURE_AREAS,
  ALL_MCP_TOOLS,
  buildFeatureManifest,
  buildMcpToolGroups,
  getCapabilityDiscovery,
  normalizeFeatureManifest,
  formatFeatureManifestReport,
  getFeatureManifestDocs,
  validateFeatureManifest,
  listMcpToolNames,
  categorizeMcpTool,
} from "./lib/feature-manifest.js";
export type {
  FeatureArea,
  McpToolGroup,
  FeatureManifest,
  CapabilityKind,
  CapabilityMatch,
  CapabilityDiscovery,
  BuildFeatureManifestOptions,
  GetCapabilityDiscoveryOptions,
} from "./lib/feature-manifest.js";

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
export { syncKgEdges, getRelated, findPath, getImpactAnalysis, getCriticalPath as getKgCriticalPath, addKgEdge, removeKgEdges } from "./db/kg.js";
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
  WorkspaceTrustProfile as WorkspaceTrustProfileConfig,
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
  encryptString,
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
