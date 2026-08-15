// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  ExecutionSubjectKind,
  TestSpecKind,
  RunAttemptStatus,
  RunEventLevel,
  RunArtifactKind,
  TestGoalStatus,
  LoopRunStatus,
  TestSpecStep,
  ExecutionSubject,
  TestSpec,
  TestGoal,
  LoopRun,
  RunAttempt,
  ExecutionRunEvent,
  RunArtifact,
  CreateExecutionSubjectInput,
  UpdateExecutionSubjectInput,
  ExecutionSubjectFilter,
  CreateTestSpecInput,
  UpdateTestSpecInput,
  TestSpecFilter,
  CreateRunAttemptInput,
  UpdateRunAttemptInput,
  RunAttemptFilter,
  CreateRunEventInput,
  CreateRunArtifactInput,
  CreateTestGoalInput,
  UpdateTestGoalInput,
  CreateLoopRunInput,
  UpdateLoopRunInput,
} from "./db/execution.js";

export type {
  ScenarioPriority,
  RunStatus,
  ResultStatus,
  ModelPreset,
  BrowserEngine,
  ProjectRow,
  AgentRow,
  ScenarioRow,
  RunRow,
  ResultRow,
  ScreenshotRow,
  Project,
  Agent,
  Scenario,
  Run,
  Result,
  Screenshot,
  PersonaAuth,
  CreateScenarioInput,
  UpdateScenarioInput,
  CreateRunInput,
  ScenarioFilter,
  RunFilter,
  ScheduleRow,
  Schedule,
  CreateScheduleInput,
  UpdateScheduleInput,
  ScheduleFilter,
  FlowRow,
  Flow,
  CreateFlowInput,
  TestingWorkflow,
  CreateTestingWorkflowInput,
  UpdateTestingWorkflowInput,
  WorkflowExecutionConfig,
  WorkflowExecutionInput,
  WorkflowExecutionTarget,
  LegacyWorkflowExecutionTarget,
  WorkflowSandboxCleanup,
  WorkflowGoal,
  WorkflowScenarioFilter,
  AuthConfig,
  BrowserConfig,
  ScreenshotConfig,
  TestersConfig,
} from "./types/index.js";

export {
  MODEL_MAP,
  projectFromRow,
  agentFromRow,
  scenarioFromRow,
  runFromRow,
  resultFromRow,
  screenshotFromRow,
  scheduleFromRow,
  ScenarioNotFoundError,
  RunNotFoundError,
  ResultNotFoundError,
  VersionConflictError,
  BrowserError,
  AIClientError,
  TodosConnectionError,
  ProjectNotFoundError,
  AgentNotFoundError,
  ScheduleNotFoundError,
  FlowNotFoundError,
  DependencyCycleError,
  flowFromRow,
} from "./types/index.js";

// ─── Storage — the single Store abstraction ──────────────────────────────────
// The SDK's public data surface routes EXCLUSIVELY through the Store (local
// SQLite or cloud /v1 HTTP + bearer key, resolved once from env). Raw `db/*`
// SQLite functions and `getDatabase` are intentionally NOT part of the public
// API — importing them would read/write on-box SQLite even in cloud mode (the
// split-brain bug). Consumers use these async, Store-routed accessors instead.
export {
  getStore,
  resetStore,
  isCloudStore,
  TESTERS_APP,
  // scenarios
  createScenario,
  getScenario,
  getScenarioByShortId,
  listScenarios,
  updateScenario,
  deleteScenario,
  countScenarios,
  findStaleScenarios,
  updateScenarioPassedCache,
  // projects
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  updateProject,
  ensureProject,
  // personas
  createPersona,
  getPersona,
  listPersonas,
  countPersonas,
  updatePersona,
  deletePersona,
  getGlobalPersonas,
  listAuthenticatedPersonas,
  savePersonaAuthCookies,
  // runs
  createRun,
  getRun,
  listRuns,
  countRuns,
  updateRun,
  deleteRun,
  // results
  createResult,
  getResult,
  listResults,
  getResultsByRun,
  updateResult,
  // screenshots
  createScreenshot,
  listScreenshots,
  // step results
  createStepResult,
  getStepResult,
  listStepResults,
  updateStepResult,
  // api checks
  createApiCheck,
  getApiCheck,
  listApiChecks,
  countApiChecks,
  updateApiCheck,
  deleteApiCheck,
  createApiCheckResult,
  listApiCheckResults,
  getLatestApiCheckResult,
  // schedules
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  getEnabledSchedules,
  updateLastRun,
  // auth presets
  createAuthPreset,
  getAuthPreset,
  listAuthPresets,
  deleteAuthPreset,
  // flows
  addDependency,
  removeDependency,
  getDependencies,
  getDependents,
  createFlow,
  getFlow,
  listFlows,
  deleteFlow,
  // testing workflows
  createTestingWorkflow,
  getTestingWorkflow,
  listTestingWorkflows,
  updateTestingWorkflow,
  deleteTestingWorkflow,
  // environments
  createEnvironment,
  getEnvironment,
  listEnvironments,
  deleteEnvironment,
  setDefaultEnvironment,
  getDefaultEnvironment,
  // sessions
  createSession,
  getSession,
  listSessions,
  deleteSession,
  countSessions,
  searchSessions,
  // agents
  registerAgent,
  listAgents,
  heartbeatAgent,
  setAgentFocus,
  // scan issues
  listScanIssues,
  getScanIssue,
  resolveScanIssue,
  upsertScanIssue,
  setScanIssueTodoTaskId,
} from "./store/index.js";
export type { Store } from "./store/index.js";

// ─── Library ─────────────────────────────────────────────────────────────────
export {
  loadConfig,
  resolveModel as resolveModelConfig,
  getDefaultConfig,
} from "./lib/config.js";

export {
  launchBrowser,
  getPage,
  closeBrowser,
  BrowserPool,
  installBrowser,
} from "./lib/browser.js";

export {
  isLightpandaAvailable,
  launchLightpanda,
  getLightpandaPage,
  closeLightpanda,
  installLightpanda,
} from "./lib/browser-lightpanda.js";

export {
  Screenshotter,
  slugify,
  generateFilename,
  getScreenshotDir,
  ensureDir,
} from "./lib/screenshotter.js";

export {
  createClient,
  resolveModel,
  runAgentLoop,
  executeTool,
  BROWSER_TOOLS,
} from "./lib/ai-client.js";

export {
  runSingleScenario,
  runBatch,
  runByFilter,
  startRunAsync,
  onRunEvent,
} from "./lib/runner.js";
export type { RunOptions, RunEvent, RunEventHandler } from "./lib/runner.js";

export {
  buildWorkflowRunPlan,
  createWorkflowDatabaseBundle,
  runTestingWorkflow,
} from "./lib/workflow-runner.js";
export type {
  WorkflowDatabaseBundle,
  WorkflowRunOptions,
  WorkflowRunPlan,
  WorkflowRunnerDependencies,
  WorkflowSandboxesRuntime,
  WorkflowSandboxExecutionResult,
  WorkflowSandboxPlan,
} from "./lib/workflow-runner.js";

export {
  formatTerminal,
  formatJSON,
  formatSummary,
  getExitCode,
  formatRunList,
  formatScenarioList,
  formatResultDetail,
} from "./lib/reporter.js";

export {
  connectToTodos,
  pullTasks,
  taskToScenarioInput,
  importFromTodos,
  markTodoDone,
  createTodoTask,
  reportTesterIssueReportsToTodos,
  TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
} from "./lib/todos-connector.js";
export type {
  TesterIssueReportV1,
  TesterIssueSeverity,
  TesterIssueKind,
  TodosIssueReportCliItem,
  ReportTesterIssueReportsResult,
  ReportTesterIssueReportsOptions,
  TodosCliRunner,
  TodosCliRunInput,
  TodosCliRunResult,
} from "./lib/todos-connector.js";

export {
  Scheduler,
  parseCron,
  parseCronField,
  shouldRunAt,
  getNextRunTime,
} from "./lib/scheduler.js";
export type { SchedulerEvent } from "./lib/scheduler.js";

export {
  initProject,
  detectFramework,
  getStarterScenarios,
} from "./lib/init.js";
export type { InitResult } from "./lib/init.js";

export {
  runSmoke,
  parseSmokeIssues,
  formatSmokeReport,
} from "./lib/smoke.js";
export type { SmokeResult, SmokeIssue } from "./lib/smoke.js";

export {
  runQuickQa,
  buildQuickQaResult,
  formatQuickQaReport,
  getQuickQaExitCode,
  normalizeQuickQaWcagLevel,
  resolveQuickQaSelection,
} from "./lib/quick-qa.js";
export type {
  QuickQaOptions,
  QuickQaResult,
  QuickQaScanner,
  QuickQaSelection,
  QuickQaStatus,
} from "./lib/quick-qa.js";

export {
  diffRuns,
  formatDiffTerminal,
  formatDiffJSON,
} from "./lib/diff.js";
export type { DiffResult, ScenarioDiff } from "./lib/diff.js";

export {
  getTemplate,
  listTemplateNames,
  SCENARIO_TEMPLATES,
} from "./lib/templates.js";

export {
  generateHtmlReport,
  generateLatestReport,
  imageToBase64,
} from "./lib/report.js";

export {
  getCostSummary,
  checkBudget,
  formatCostsTerminal,
  formatCostsJSON,
} from "./lib/costs.js";
export type { CostSummary, BudgetConfig } from "./lib/costs.js";

export { startWatcher } from "./lib/watch.js";

export {
  createWebhook,
  getWebhook,
  listWebhooks,
  deleteWebhook,
  dispatchWebhooks,
  testWebhook,
} from "./lib/webhooks.js";
export type { Webhook, WebhookPayload } from "./lib/webhooks.js";

export { writeRunMeta, writeScenarioMeta } from "./lib/screenshotter.js";
export type { CaptureResult } from "./lib/screenshotter.js";

export { resolveCredential, isCredentialReference } from "./lib/secrets-resolver.js";
export {
  MODEL_PROVIDER_ENV_KEYS,
  checkModelCredential,
  resolveModelCredential,
  resolveModelCredentialReference,
  validateModelCredential,
} from "./lib/model-credentials.js";
export type {
  ModelCredentialCheck,
  ModelCredentialResolution,
  ModelCredentialValidationInput,
  ModelCredentialValidationResult,
} from "./lib/model-credentials.js";
export { ensurePersonaAuthenticated, loginWithAuthConfig } from "./lib/persona-auth.js";
export type { LoginResult } from "./lib/persona-auth.js";

export {
  discoverRepo,
  clearDiscoveryCache,
  getDiscoveryCacheInfo,
} from "./lib/repo-discovery.js";
export type {
  RepoSpec,
  PackageManagers,
  DevScripts,
  ReadinessCheck,
  RepoPrep,
  RepoDiscoverySnapshot,
  DiscoveryOptions,
} from "./lib/repo-discovery.js";

export {
  runRepoTests,
  runPrep,
} from "./lib/repo-executor.js";
export type {
  RepoRunSpecResult,
  RepoRunOptions,
  RepoRunResult,
  PrepResult,
} from "./lib/repo-executor.js";

export {
  createProdDebugPlan,
  formatProdDebugPlan,
  parseProdDebugTarget,
  redactProdDebugText,
} from "./lib/prod-debug.js";
export type {
  ProdDebugAppProfile,
  ProdDebugCheck,
  ProdDebugConfig,
  ProdDebugIdentifiers,
  ProdDebugInput,
  ProdDebugPlan,
} from "./lib/prod-debug.js";

export {
  generateGitHubActionsWorkflow,
  formatPRComment,
  postGitHubComment,
  resolvePullRequestNumber,
} from "./lib/ci.js";

// ─── Generated HTTP SDK client (from the serve OpenAPI) ──────────────────────
export { TestersClient, ApiError as TestersApiError } from "./sdk/client.js";
export type { TestersClientOptions } from "./sdk/client.js";

// ─── Sessions (Chrome extension import) ──────────────────────────────────────
export type { Session, SessionInput } from "./db/sessions.js";
