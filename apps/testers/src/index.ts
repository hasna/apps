// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  ScenarioPriority,
  RunStatus,
  ResultStatus,
  ModelPreset,
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
} from "./types/index.js";

// ─── Database ────────────────────────────────────────────────────────────────
export {
  getDatabase,
  closeDatabase,
  resetDatabase,
  resolvePartialId,
  now,
  uuid,
  shortUuid,
} from "./db/database.js";

export {
  createScenario,
  getScenario,
  getScenarioByShortId,
  listScenarios,
  updateScenario,
  deleteScenario,
} from "./db/scenarios.js";

export {
  createRun,
  getRun,
  listRuns,
  updateRun,
  deleteRun,
} from "./db/runs.js";

export {
  createResult,
  getResult,
  listResults,
  updateResult,
  getResultsByRun,
} from "./db/results.js";

export {
  createScreenshot,
  getScreenshot,
  listScreenshots,
  getScreenshotsByResult,
} from "./db/screenshots.js";

export {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  ensureProject,
} from "./db/projects.js";

export {
  registerAgent,
  getAgent,
  getAgentByName,
  listAgents,
} from "./db/agents.js";

export {
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  getEnabledSchedules,
  updateLastRun,
} from "./db/schedules.js";

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
  createAuthPreset,
  getAuthPreset,
  listAuthPresets,
  deleteAuthPreset,
} from "./db/auth-presets.js";

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
