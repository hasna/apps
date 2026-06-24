/**
 * @hasna/computer — Open-source computer use for AI agents
 *
 * Control your Mac with Anthropic or OpenAI.
 * CLI + MCP server + REST API + SDK.
 */

// Types
export type {
  Provider,
  ProviderFallbackConfig,
  ProviderFallbackReason,
  MouseButton,
  Point,
  CoordinateSpace,
  CoordinateSpaceKind,
  ScreenBounds,
  ScreenSize,
  Screenshot,
  DriverAction,
  ActionResult,
  ComputerDriver,
  ModelResponse,
  ComputerProvider,
  ProviderSafetyCheck,
  GoalVerifier,
  GoalVerifierContext,
  SessionStatus,
  ActionLog,
  Session,
  RunOptions,
  SafetyConfig,
  VerifierDecision,
  VerifierDecisionStatus,
  VerifierEvidence,
  VerifierEvidenceKind,
} from "./types/index.js";

// Agent
export { resumeTask, runTask } from "./agent/loop.js";
export {
  cancelSession,
  clearSessionPause,
  clearEmergencyStop,
  clearSessionCancellation,
  getEmergencyStop,
  getRunControlDecision,
  pauseSession,
  resumeSession,
  requestEmergencyStop,
  unregisterSessionAbortController,
} from "./agent/control.js";
export type {
  EmergencyStopState,
  RunControlDecision,
  SessionControlState,
} from "./agent/control.js";
export {
  acquireRuntimeLease,
  addObservation,
  addRunStep,
  assertRunTransition,
  createApproval,
  createRuntimeGoal,
  createWorkflowDefinition,
  createWorkflowRun,
  expireStaleRuntimeLeases,
  getWorkflowRun,
  legalRunTransitions,
  listRuntimeLeases,
  recordArtifact,
  recordPolicyDecision,
  releaseRuntimeLease,
  transitionWorkflowRun,
} from "./agent/runtime.js";
export type {
  RuntimeGoal,
  RuntimeLease,
  RunStatus,
  RunStep,
  WorkflowDefinition,
  WorkflowRun,
} from "./agent/runtime.js";

// Drivers
export { createMacDriver, MacDriver } from "./drivers/mac/index.js";
export { captureScreenshot, getScreenSize, saveScreenshotToFile } from "./drivers/mac/screenshot.js";
export {
  clampPointToSpace,
  coordinateSpaceFromBounds,
  coordinateSpaceFromScreenshot,
  mapActionBetweenSpaces,
  mapPointBetweenSpaces,
  normalizeCoordinateSpace,
} from "./lib/coordinates.js";
export type {
  CoordinateMappingOptions,
  CoordinateSpaceInput,
} from "./lib/coordinates.js";
export {
  evaluateComputerAction,
  executeAction,
  executeComputerAction,
  formatPolicyRejection,
  evaluateTerminalCommandPolicy,
  evaluateTerminalCommandTextPolicy,
  guardTerminalCommandPolicy,
  recordTerminalCommandPolicyAudit,
} from "./agent/policy.js";
export type {
  ActionExecutor,
  ActionPolicyDecision,
  ActionPolicyOptions,
  ActionPolicyStatus,
  ActionAuditContext,
  ExecuteComputerActionOptions,
  TerminalCommandPolicyOptions,
  TerminalCommandSpec,
} from "./agent/policy.js";
export {
  approvalToolInputSchema,
  appToolInputSchema,
  browserToolInputSchema,
  computerToolInputSchema,
  coordinateSchema,
  createPlannerTools,
  fleetArtifactMaxBytesSchema,
  fleetArtifactSourceScopeSchema,
  fleetArtifactIdSchema,
  fleetMachineIdSchema,
  fleetToolInputSchema,
  httpUrlSchema,
  memoryToolInputSchema,
  observationToolInputSchema,
  plannerToolSchemas,
  pointSchema,
  resourceIdSchema,
  storageToolInputSchema,
  terminalCommandSchema,
  terminalToolInputSchema,
  workspacePathSchema,
} from "./agent/planner-tools.js";
export type {
  ApprovalToolInput,
  AppToolInput,
  BrowserToolInput,
  ComputerToolInput,
  FleetToolInput,
  MemoryToolInput,
  ObservationToolInput,
  PlannerToolName,
  StorageToolInput,
  TerminalToolInput,
} from "./agent/planner-tools.js";
export {
  routePlannerTool,
} from "./agent/capability-router.js";
export type {
  CapabilityRouteResult,
  CapabilityRouteStatus,
  CapabilityRouterOptions,
  CapabilitySubsystem,
} from "./agent/capability-router.js";
export {
  APPROVED_FLEET_ARTIFACT_NAMESPACES,
  FLEET_ARTIFACT_DEFAULT_MAX_BYTES,
  FLEET_ARTIFACT_HARD_MAX_BYTES,
  FLEET_ARTIFACT_SOURCE_SCOPES,
  artifactAuditMetadata,
  artifactIdHash,
  authorizeAndPullFleetArtifact,
  evaluateFleetArtifactPullContract,
  fleetArtifactNamespace,
  fleetArtifactTokenClaims,
  isCanonicalFleetArtifactId,
  isSensitiveFleetArtifactId,
  normalizeFleetArtifactPullInput,
  validateFleetArtifactPullResult,
} from "./agent/fleet-artifacts.js";
export type {
  FleetArtifactAdapterResult,
  FleetArtifactMaterializeApproval,
  FleetArtifactNamespace,
  FleetArtifactPullDecision,
  FleetArtifactPullDecisionStatus,
  FleetArtifactPullExecutionResult,
  FleetArtifactPullExecutor,
  FleetArtifactPullInput,
  FleetArtifactPullMode,
  FleetArtifactSourceScope,
  FleetArtifactTokenClaims,
  RequiredFleetArtifactPullInput,
} from "./agent/fleet-artifacts.js";
export {
  evaluateFleetTransport,
  isFleetMutation,
  transportAuditMetadata,
} from "./agent/fleet-transport.js";
export type {
  FleetCapabilityTokenVerification,
  FleetCapabilityTokenVerifier,
  FleetTransportAuth,
  FleetTransportDecision,
  FleetTransportDecisionStatus,
  FleetTransportKind,
  FleetTransportRequest,
} from "./agent/fleet-transport.js";
export {
  goalPlanDraftSchema,
  goalPlanStepSchema,
  planGoalDryRun,
} from "./agent/goal-planner.js";
export type {
  GoalPlanDraft,
  GoalPlanGenerator,
  GoalPlanGeneratorContext,
  GoalPlanStep,
  PersistedGoalPlan,
  PersistedGoalPlanStep,
  PlanGoalOptions,
} from "./agent/goal-planner.js";
export {
  verifierDecisionSchema,
  verifierEvidenceSchema,
  verifyGoalState,
} from "./agent/verifier.js";
export type {
  VerifyGoalStateOptions,
} from "./agent/verifier.js";
export {
  buildExecutorSystemPrompt,
  buildPlannerSystemPrompt,
  buildVerifierSystemPrompt,
  getPromptSpec,
  PROMPTS,
  PROMPT_VERSION,
  promptReference,
  promptReferences,
} from "./agent/prompts.js";
export type {
  PromptReference,
  PromptRole,
  PromptSpec,
} from "./agent/prompts.js";
export {
  logAuditEvent,
  listAuditEvents,
  listModelUsage,
  getModelUsageSummary,
  recordModelUsage,
} from "./db/index.js";
export type {
  AuditEvent,
  LogAuditEventParams,
  ModelUsageEvent,
  ModelUsagePhase,
} from "./db/index.js";

// Providers
export {
  chooseDefaultFallbackProvider,
  classifyProviderError,
  createProvider,
  createAnthropicProvider,
  createOpenAIProvider,
  DEFAULT_PROVIDER_FALLBACK_ON,
  FallbackComputerProvider,
} from "./providers/index.js";
export type {
  CreateProviderOptions,
  FallbackComputerProviderOptions,
} from "./providers/index.js";

// Headless
export { hasDisplay, isScreenSharingEnabled, isLumeInstalled, getHeadlessStatus } from "./drivers/mac/headless.js";
export type { HeadlessConfig } from "./drivers/mac/headless.js";

// Accessibility
export { queryAccessibilityTree, summarizeAccessibilityTree } from "./drivers/mac/accessibility.js";
export type { AXElement } from "./drivers/mac/accessibility.js";

// Integrations
export { runPostSessionIntegrations, saveToRecordings, registerWithSessions, pushToLogs } from "./lib/integrations.js";

// Agents
export { registerAgent, heartbeat, setFocus, getAgent, listAgents } from "./db/agents.js";
export type { Agent } from "./db/agents.js";

// Safety
export { checkAction, resetRateLimiter } from "./agent/safety.js";
export type { SafetyCheckResult } from "./agent/safety.js";

// Config
export { loadConfig, saveConfig, getConfigValue, setConfigValue, getConfigPath, DEFAULT_CONFIG } from "./lib/config.js";
export type { ComputerConfig } from "./lib/config.js";

export {
  assertStorageRemoteAllowed,
  allowStorageInsecureTls,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  hasStorageSyncConsent,
  inspectStorageTls,
  resolveTables as resolveStorageTables,
  storagePull,
  storagePush,
  storageSync,
} from "./db/storage-sync.js";
export type {
  StorageEnv,
  StorageMode,
  StorageStatus,
  StorageTlsStatus,
  SyncMeta,
  SyncResult,
} from "./db/storage-sync.js";

// Pricing
export { calculateCost, formatCost, stepCost, listPricing } from "./lib/pricing.js";

// Utilities
export { scaleScreenshot, getScaledSize, RECOMMENDED_WIDTHS } from "./lib/scale.js";
export { screenshotsMatch, computeScreenHash, compareHashes } from "./lib/diff.js";
export { renderInlineImage, supportsInlineImages, detectProtocol } from "./lib/terminal-image.js";
export type { TerminalProtocol } from "./lib/terminal-image.js";

// Database
export {
  getDb,
  getDbPath,
  getDataDir,
  createSession,
  updateSession,
  logAction,
  getSession,
  listSessions,
  getActionLogs,
  deleteSession,
  getStats,
  searchSessions,
  searchActionLogs,
} from "./db/index.js";
export * from "./db/storage-sync.js";
export * from "./db/remote-storage.js";
