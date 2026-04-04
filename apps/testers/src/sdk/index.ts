/**
 * SDK/Library API for programmatic use of open-testers.
 * Use this as the entry point when integrating open-testers into
 * Node.js/TypeScript projects without going through the MCP server.
 *
 * ```typescript
 * import { createScenario, listScenarioTemplates, RunOptions } from "open-testers/sdk";
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  Scenario,
  Run,
  Result,
  RunOptions,
  CreateScenarioInput,
  UpdateScenarioInput,
  Persona,
  CreatePersonaInput,
  UpdatePersonaInput,
  PersonaAuth,
  Webhook,
  AuthProfile,
  AuthStrategy,
  Assertion,
  AssertionType,
  ScenarioPriority,
  ResultStatus,
  ModelPreset,
  BrowserEngine,
  DevicePreset,
} from "../types/index.js";

export type { RunEvent } from "../lib/runner.js";
export type { MockRule } from "../lib/network-mock.js";
export type { BatchAction, BatchActionResult } from "../lib/batch-actions.js";
export type { MutationEvent, MutationOptions } from "../lib/dom-mutation.js";
export type { WebVitals, PerformanceBudget, BudgetViolation, PerformanceResult } from "../lib/performance.js";
export type { A11yAuditResult, A11yAuditOptions, A11yViolation } from "../lib/a11y-audit.js";
export type { Environment, EnvironmentInfo } from "../lib/environment.js";
export type { ThrottleProfile } from "../lib/offline-mode.js";
export type { ChainOutput, ChainLink } from "../lib/scenario-chain.js";

// ─── Scenario Management ─────────────────────────────────────────────────────

export {
  createScenario,
  getScenario,
  getScenarioByShortId,
  listScenarios,
  updateScenario,
  deleteScenario,
  findStaleScenarios,
} from "../db/scenarios.js";

// ─── Run & Result Management ─────────────────────────────────────────────────

export {
  getRun,
  listRuns,
  updateRun,
  countRuns,
} from "../db/runs.js";

export {
  createResult,
  getResult,
  listResults,
  getResultsByRun,
  updateResult,
} from "../db/results.js";

// ─── Step Results ─────────────────────────────────────────────────────────────

export {
  createStepResult,
  getStepResult,
  listStepResults,
  updateStepResult,
} from "../db/step-results.js";

// ─── Persona Management ──────────────────────────────────────────────────────

export {
  createPersona,
  getPersona,
  listPersonas,
  updatePersona,
  deletePersona,
  listAuthenticatedPersonas,
  savePersonaAuthCookies,
} from "../db/personas.js";

// ─── Templates ────────────────────────────────────────────────────────────────

export {
  getTemplate,
  listTemplateNames,
  SCENARIO_TEMPLATES,
} from "../lib/templates.js";

// ─── Reports ──────────────────────────────────────────────────────────────────

export {
  generateHtmlReport,
  generateLatestReport,
  imageToBase64,
} from "../lib/report.js";

export {
  saveHtmlReport,
  generatePdfReport,
} from "../lib/pdf-export.js";

// ─── JUnit Export ─────────────────────────────────────────────────────────────

export {
  toJUnitXml,
} from "../lib/junit-export.js";

// ─── Responsive/Device Testing ───────────────────────────────────────────────

export {
  DEVICE_PRESETS,
  setDevicePreset,
  setViewport,
  captureResponsiveScreenshots,
  isMobileViewport,
  listDevicePresets,
} from "../lib/responsive.js";

// ─── Batch Actions ───────────────────────────────────────────────────────────

export {
  batchActions,
  hasBatchFailures,
  formatBatchResults,
} from "../lib/batch-actions.js";

// ─── DOM Mutations ────────────────────────────────────────────────────────────

export {
  watchMutations,
  waitForElement,
  waitForElementRemoved,
  waitForText,
  snapshotDOM,
  compareSnapshots,
  extractElements,
} from "../lib/dom-mutation.js";

// ─── Performance ──────────────────────────────────────────────────────────────

export {
  collectPerformanceMetrics,
  collectWebVitals,
  checkBudget,
  formatPerformanceResult,
  DEFAULT_BUDGET,
} from "../lib/performance.js";

// ─── Accessibility ────────────────────────────────────────────────────────────

export {
  runA11yAudit,
  hasA11yIssues,
  formatA11yResults,
} from "../lib/a11y-audit.js";

// ─── Assertions ───────────────────────────────────────────────────────────────

export {
  evaluateAssertions,
  parseAssertionString,
  allAssertionsPassed,
  formatAssertionResults,
} from "../lib/assertions.js";
export type { AssertionResult } from "../lib/assertions.js";

// ─── Environment Detection ───────────────────────────────────────────────────

export {
  getEnvInfo,
  detectEnvironment,
  getEnvironmentOverride,
} from "../lib/environment.js";

// ─── Network Mocking ─────────────────────────────────────────────────────────

export {
  setupNetworkMocks,
  MockPresets,
} from "../lib/network-mock.js";

// ─── Offline Mode / Throttling ───────────────────────────────────────────────

export {
  goOffline,
  goOnline,
  testOfflineHandling,
  enableThrottling,
  disableThrottling,
  THROTTLE_PROFILES,
} from "../lib/offline-mode.js";

// ─── Scenario Chaining ────────────────────────────────────────────────────────

export {
  applyChainOutput,
  resolveChain,
  extractChainOutput,
  hasChainDependency,
} from "../lib/scenario-chain.js";

// ─── Auth Profiles ───────────────────────────────────────────────────────────

export {
  authenticateWithProfile,
  serializeProfile,
  deserializeProfile,
} from "../lib/auth-profiles.js";

// ─── API Discovery ────────────────────────────────────────────────────────────

export {
  discoverApiEndpoints,
  generateApiScenarios,
  groupEndpoints,
  summarizeEndpoints,
} from "../lib/api-discovery.js";

// ─── Visual Regression ───────────────────────────────────────────────────────

export {
  setBaseline,
  getBaseline,
  compareImages,
  compareRunScreenshots,
  formatVisualDiffTerminal,
} from "../lib/visual-diff.js";
export type { VisualDiffResult } from "../lib/visual-diff.js";

// ─── Runner ──────────────────────────────────────────────────────────────────

export {
  startRunAsync,
  runSingleScenario,
  runBatch,
  runByFilter,
  onRunEvent,
} from "../lib/runner.js";
export type { RunOptions, RunEvent, RunEventHandler } from "../lib/runner.js";

// ─── Browser ─────────────────────────────────────────────────────────────────

export {
  launchBrowser,
  getPage,
  closeBrowser,
  BrowserPool,
  launchBrowserEngine,
  installBrowser,
} from "../lib/browser.js";
