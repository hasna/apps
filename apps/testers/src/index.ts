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
  ScenarioNotFoundError,
  RunNotFoundError,
  ResultNotFoundError,
  VersionConflictError,
  BrowserError,
  AIClientError,
  TodosConnectionError,
  ProjectNotFoundError,
  AgentNotFoundError,
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
