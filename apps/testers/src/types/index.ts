// ─── Enums ───────────────────────────────────────────────────────────────────

export type ScenarioPriority = "low" | "medium" | "high" | "critical";
export type RunStatus = "pending" | "running" | "passed" | "failed" | "cancelled";
export type ResultStatus = "passed" | "failed" | "error" | "skipped" | "flaky";
export type ModelPreset = "quick" | "thorough" | "deep" | "cerebras-fast" | "cerebras-smart";
export type BrowserEngine = "playwright" | "playwright-firefox" | "playwright-webkit" | "lightpanda" | "bun" | "cdp";
export type AuthStrategy = "form-login" | "bearer" | "cookie" | "oauth" | "custom_script";

export type AssertionType = "visible" | "not_visible" | "text_contains" | "text_equals" | "element_count" | "no_console_errors" | "url_contains" | "title_contains" | "no_a11y_violations" | "cookie_exists" | "cookie_value" | "cookie_not_exists" | "local_storage_exists" | "local_storage_value" | "local_storage_not_exists" | "session_storage_value" | "session_storage_not_exists";

export interface Assertion {
  type: AssertionType;
  selector?: string;
  expected?: string | number;
  description?: string;
}

export const MODEL_MAP: Record<ModelPreset, string> = {
  quick: "claude-haiku-4-5-20251001",
  thorough: "claude-sonnet-4-6-20260311",
  deep: "claude-opus-4-6-20260311",
  "cerebras-fast": "llama-3.1-8b",
  "cerebras-smart": "llama-3.3-70b",
};

// ─── Database Row Types (snake_case from SQLite) ─────────────────────────────

export interface ProjectRow {
  id: string;
  name: string;
  path: string | null;
  description: string | null;
  base_url: string | null;
  port: number | null;
  settings: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  role: string | null;
  metadata: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface ScenarioRow {
  id: string;
  short_id: string;
  project_id: string | null;
  name: string;
  description: string;
  steps: string; // JSON array
  tags: string; // JSON array
  priority: ScenarioPriority;
  model: string | null;
  timeout_ms: number | null;
  target_path: string | null;
  requires_auth: number;
  auth_config: string | null; // JSON
  metadata: string | null; // JSON
  assertions: string; // JSON array
  persona_id: string | null;
  scenario_type: string;
  required_role: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_passed_at: string | null;
  last_passed_url: string | null;
  parameters: string | null; // JSON object or array for data-driven scenarios
}

export interface RunRow {
  id: string;
  project_id: string | null;
  status: RunStatus;
  url: string;
  model: string;
  headed: number;
  parallel: number;
  total: number;
  passed: number;
  failed: number;
  started_at: string;
  finished_at: string | null;
  metadata: string | null; // JSON
  is_baseline: number;
  samples: number;
  flakiness_threshold: number;
  // PR metadata (OPE9-00279)
  pr_number: number | null;
  pr_title: string | null;
  pr_branch: string | null;
  pr_base_branch: string | null;
  pr_commit_sha: string | null;
  pr_url: string | null;
  gh_app_installation_id: string | null;
}

export interface FailureAnalysis {
  type: "selector_not_found" | "assertion_failed" | "timeout" | "auth_error" | "network_error" | "eval_failed" | "unknown";
  affectedElement?: string;
  affectedUrl?: string;
  expected?: string;
  actual?: string;
  stepNumber?: number;
  confidence: "high" | "medium" | "low";
}

export interface ResultRow {
  id: string;
  run_id: string;
  scenario_id: string;
  status: ResultStatus;
  reasoning: string | null;
  error: string | null;
  steps_completed: number;
  steps_total: number;
  duration_ms: number;
  model: string;
  tokens_used: number;
  cost_cents: number;
  metadata: string | null; // JSON
  created_at: string;
  persona_id: string | null;
  persona_name: string | null;
  failure_analysis: string | null;
  har_path: string | null;
}

export interface ScreenshotRow {
  id: string;
  result_id: string;
  step_number: number;
  action: string;
  file_path: string;
  width: number;
  height: number;
  timestamp: string;
  description: string | null;
  page_url: string | null;
  thumbnail_path: string | null;
}

export interface ScheduleRow {
  id: string;
  project_id: string | null;
  name: string;
  cron_expression: string;
  url: string;
  scenario_filter: string; // JSON
  model: string | null;
  headed: number;
  parallel: number;
  timeout_ms: number | null;
  enabled: number;
  last_run_id: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Application Types (camelCase) ───────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string | null;
  description: string | null;
  baseUrl: string | null;
  port: number | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  path?: string;
  description?: string;
  baseUrl?: string;
  port?: number;
  settings?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  baseUrl?: string;
  port?: number;
  settings?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  role: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface Scenario {
  id: string;
  shortId: string;
  projectId: string | null;
  name: string;
  description: string;
  steps: string[];
  tags: string[];
  priority: ScenarioPriority;
  model: string | null;
  timeoutMs: number | null;
  targetPath: string | null;
  requiresAuth: boolean;
  authConfig: AuthConfig | null;
  metadata: Record<string, unknown> | null;
  assertions: Assertion[];
  personaId: string | null;
  scenarioType: "browser" | "eval" | "api" | "pipeline";
  requiredRole: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastPassedAt: string | null;
  lastPassedUrl: string | null;
  parameters: Record<string, unknown> | null;
  flakinessScore?: number | null;
  recentRunCount?: number;
}

export interface Run {
  id: string;
  projectId: string | null;
  status: RunStatus;
  url: string;
  model: string;
  headed: boolean;
  parallel: number;
  total: number;
  passed: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
  metadata: Record<string, unknown> | null;
  isBaseline: boolean;
  samples: number;
  flakinessThreshold: number;
  // PR metadata (OPE9-00279)
  prNumber: number | null;
  prTitle: string | null;
  prBranch: string | null;
  prBaseBranch: string | null;
  prCommitSha: string | null;
  prUrl: string | null;
  ghAppInstallationId: string | null;
}

export interface Result {
  id: string;
  runId: string;
  scenarioId: string;
  status: ResultStatus;
  reasoning: string | null;
  error: string | null;
  stepsCompleted: number;
  stepsTotal: number;
  durationMs: number;
  model: string;
  tokensUsed: number;
  costCents: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  personaId: string | null;
  personaName: string | null;
  failureAnalysis: FailureAnalysis | null;
  harPath: string | null;
}

export interface Screenshot {
  id: string;
  resultId: string;
  stepNumber: number;
  action: string;
  filePath: string;
  width: number;
  height: number;
  timestamp: string;
  description: string | null;
  pageUrl: string | null;
  thumbnailPath: string | null;
}

export interface Schedule {
  id: string;
  projectId: string | null;
  name: string;
  cronExpression: string;
  url: string;
  scenarioFilter: { tags?: string[]; priority?: ScenarioPriority; scenarioIds?: string[] };
  model: string | null;
  headed: boolean;
  parallel: number;
  timeoutMs: number | null;
  enabled: boolean;
  lastRunId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface CreateScenarioInput {
  name: string;
  description: string;
  steps?: string[];
  tags?: string[];
  priority?: ScenarioPriority;
  model?: string;
  timeoutMs?: number;
  targetPath?: string;
  requiresAuth?: boolean;
  authConfig?: AuthConfig;
  assertions?: Assertion[];
  metadata?: Record<string, unknown>;
  projectId?: string;
  parameters?: Record<string, unknown>;
}

export interface UpdateScenarioInput {
  name?: string;
  description?: string;
  steps?: string[];
  tags?: string[];
  priority?: ScenarioPriority;
  model?: string;
  timeoutMs?: number;
  targetPath?: string;
  requiresAuth?: boolean;
  authConfig?: AuthConfig;
  assertions?: Assertion[];
  metadata?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

export interface CreateRunInput {
  url: string;
  scenarioIds?: string[];
  tags?: string[];
  priority?: ScenarioPriority;
  model?: string;
  headed?: boolean;
  parallel?: number;
  timeout?: number;
  projectId?: string;
  samples?: number;
  flakinessThreshold?: number;
  // PR metadata (OPE9-00279)
  prNumber?: number;
  prTitle?: string;
  prBranch?: string;
  prBaseBranch?: string;
  prCommitSha?: string;
  prUrl?: string;
  ghAppInstallationId?: string;
}

export interface ScenarioFilter {
  projectId?: string;
  tags?: string[];
  priority?: ScenarioPriority;
  search?: string;
  sort?: "date" | "priority" | "name";
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export type RunSortField = "date" | "duration" | "cost";

export interface RunFilter {
  projectId?: string;
  status?: RunStatus;
  since?: string;
  until?: string;
  sort?: "date" | "duration" | "cost";
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateScheduleInput {
  name: string;
  cronExpression: string;
  url: string;
  scenarioFilter?: { tags?: string[]; priority?: ScenarioPriority; scenarioIds?: string[] };
  model?: string;
  headed?: boolean;
  parallel?: number;
  timeoutMs?: number;
  projectId?: string;
}

export interface UpdateScheduleInput {
  name?: string;
  cronExpression?: string;
  url?: string;
  scenarioFilter?: { tags?: string[]; priority?: ScenarioPriority; scenarioIds?: string[] };
  model?: string;
  headed?: boolean;
  parallel?: number;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface ScheduleFilter {
  projectId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

// ─── Config Types ────────────────────────────────────────────────────────────

export interface AuthConfig {
  email?: string;
  password?: string;
  loginPath?: string;
  tokenHeader?: string;
  token?: string;
}

export interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timeout: number;
}

export interface ScreenshotConfig {
  dir: string;
  format: "png" | "jpeg";
  quality: number;
  fullPage: boolean;
}

export interface TestersConfig {
  defaultModel: string;
  models: Record<ModelPreset, string>;
  browser: BrowserConfig;
  screenshots: ScreenshotConfig;
  anthropicApiKey?: string;
  todosDbPath?: string;
  judgeModel?: string;    // model used for LLM-as-judge (any provider)
  judgeProvider?: string; // explicit provider override for judge
  selfHeal?: boolean;     // enable self-healing selector repair (default false)
  conversationsSpace?: string;  // conversations MCP space ID to post run results to
  defaultMaxCostCents?: number; // hard budget cap per run in cents
}

// ─── Row Converters ──────────────────────────────────────────────────────────

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description,
    baseUrl: row.base_url ?? null,
    port: row.port ?? null,
    settings: row.settings ? JSON.parse(row.settings) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function agentFromRow(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: row.role,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function scenarioFromRow(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    shortId: row.short_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    steps: JSON.parse(row.steps),
    tags: JSON.parse(row.tags),
    priority: row.priority,
    model: row.model,
    timeoutMs: row.timeout_ms,
    targetPath: row.target_path,
    requiresAuth: row.requires_auth === 1,
    authConfig: row.auth_config ? JSON.parse(row.auth_config) : null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    assertions: JSON.parse(row.assertions || "[]"),
    personaId: row.persona_id ?? null,
    scenarioType: (row.scenario_type ?? "browser") as "browser" | "eval" | "api" | "pipeline",
    requiredRole: row.required_role ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPassedAt: row.last_passed_at ?? null,
    lastPassedUrl: row.last_passed_url ?? null,
    parameters: row.parameters ? JSON.parse(row.parameters) : null,
  };
}

export function runFromRow(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    url: row.url,
    model: row.model,
    headed: row.headed === 1,
    parallel: row.parallel,
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    isBaseline: row.is_baseline === 1,
    samples: row.samples ?? 1,
    flakinessThreshold: row.flakiness_threshold ?? 0.95,
    prNumber: row.pr_number ?? null,
    prTitle: row.pr_title ?? null,
    prBranch: row.pr_branch ?? null,
    prBaseBranch: row.pr_base_branch ?? null,
    prCommitSha: row.pr_commit_sha ?? null,
    prUrl: row.pr_url ?? null,
    ghAppInstallationId: row.gh_app_installation_id ?? null,
  };
}

export function resultFromRow(row: ResultRow): Result {
  return {
    id: row.id,
    runId: row.run_id,
    scenarioId: row.scenario_id,
    status: row.status,
    reasoning: row.reasoning,
    error: row.error,
    stepsCompleted: row.steps_completed,
    stepsTotal: row.steps_total,
    durationMs: row.duration_ms,
    model: row.model,
    tokensUsed: row.tokens_used,
    costCents: row.cost_cents,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    personaId: row.persona_id ?? null,
    personaName: row.persona_name ?? null,
    failureAnalysis: row.failure_analysis ? JSON.parse(row.failure_analysis) : null,
    harPath: row.har_path ?? null,
  };
}

export function screenshotFromRow(row: ScreenshotRow): Screenshot {
  return {
    id: row.id,
    resultId: row.result_id,
    stepNumber: row.step_number,
    action: row.action,
    filePath: row.file_path,
    width: row.width,
    height: row.height,
    timestamp: row.timestamp,
    description: row.description,
    pageUrl: row.page_url,
    thumbnailPath: row.thumbnail_path,
  };
}

export function scheduleFromRow(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    cronExpression: row.cron_expression,
    url: row.url,
    scenarioFilter: JSON.parse(row.scenario_filter),
    model: row.model,
    headed: row.headed === 1,
    parallel: row.parallel,
    timeoutMs: row.timeout_ms,
    enabled: row.enabled === 1,
    lastRunId: row.last_run_id,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Error Classes ───────────────────────────────────────────────────────────

export class ScenarioNotFoundError extends Error {
  constructor(id: string) {
    super(`Scenario not found: ${id}`);
    this.name = "ScenarioNotFoundError";
  }
}

export class RunNotFoundError extends Error {
  constructor(id: string) {
    super(`Run not found: ${id}`);
    this.name = "RunNotFoundError";
  }
}

export class ResultNotFoundError extends Error {
  constructor(id: string) {
    super(`Result not found: ${id}`);
    this.name = "ResultNotFoundError";
  }
}

export class VersionConflictError extends Error {
  constructor(entity: string, id: string) {
    super(`Version conflict on ${entity}: ${id}`);
    this.name = "VersionConflictError";
  }
}

export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserError";
  }
}

export class AIClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIClientError";
  }
}

export class TodosConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodosConnectionError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

export class AgentNotFoundError extends Error {
  constructor(id: string) {
    super(`Agent not found: ${id}`);
    this.name = "AgentNotFoundError";
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(id: string) {
    super(`Schedule not found: ${id}`);
    this.name = "ScheduleNotFoundError";
  }
}

// ─── Scanner Types ────────────────────────────────────────────────────────────

export type ScanIssueType = "console_error" | "network_error" | "broken_link" | "performance" | "pii_leak" | "injection";
export type ScanIssueSeverity = "critical" | "high" | "medium" | "low";
export type ScanIssueStatus = "open" | "resolved" | "regressed";

/** A single issue found during a page scan. */
export interface ScanIssue {
  type: ScanIssueType;
  severity: ScanIssueSeverity;
  pageUrl: string;
  message: string;
  detail?: Record<string, unknown>;
}

/** Result from running one scanner against one or more pages. */
export interface ScanResult {
  url: string;
  pages: string[];
  scannedAt: string;
  durationMs: number;
  issues: ScanIssue[];
}

/** Persisted scan issue record (with deduplication fields). */
export interface PersistedScanIssue {
  id: string;
  fingerprint: string;
  type: ScanIssueType;
  severity: ScanIssueSeverity;
  pageUrl: string;
  message: string;
  detail: Record<string, unknown> | null;
  status: ScanIssueStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  todoTaskId: string | null;
  projectId: string | null;
}

/** DB row for scan_issues table. */
export interface ScanIssueRow {
  id: string;
  fingerprint: string;
  type: string;
  severity: string;
  page_url: string;
  message: string;
  detail: string | null;
  status: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  todo_task_id: string | null;
  project_id: string | null;
}

export function scanIssueFromRow(row: ScanIssueRow): PersistedScanIssue {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    type: row.type as ScanIssueType,
    severity: row.severity as ScanIssueSeverity,
    pageUrl: row.page_url,
    message: row.message,
    detail: row.detail ? JSON.parse(row.detail) : null,
    status: row.status as ScanIssueStatus,
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    todoTaskId: row.todo_task_id,
    projectId: row.project_id,
  };
}

export class BudgetExceededError extends Error {
  constructor(estimatedCents: number, capCents: number) {
    super(`Estimated run cost ($${(estimatedCents / 100).toFixed(2)}) exceeds budget cap ($${(capCents / 100).toFixed(2)}). Pass skipBudgetCheck: true to override.`);
    this.name = "BudgetExceededError";
  }
}

export class ApiCheckNotFoundError extends Error {
  constructor(id: string) {
    super(`API check not found: ${id}`);
    this.name = "ApiCheckNotFoundError";
  }
}

export class FlowNotFoundError extends Error {
  constructor(id: string) {
    super(`Flow not found: ${id}`);
    this.name = "FlowNotFoundError";
  }
}

export class DependencyCycleError extends Error {
  constructor(scenarioId: string, dependsOn: string) {
    super(`Adding dependency ${dependsOn} to ${scenarioId} would create a cycle`);
    this.name = "DependencyCycleError";
  }
}

// ─── Flow Types ──────────────────────────────────────────────────────────────

export interface FlowRow {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  scenario_ids: string; // JSON array
  created_at: string;
  updated_at: string;
}

export interface Flow {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  scenarioIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function flowFromRow(row: FlowRow): Flow {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    scenarioIds: JSON.parse(row.scenario_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateFlowInput {
  name: string;
  description?: string;
  scenarioIds: string[];
  projectId?: string;
}

// ─── Persona Types ────────────────────────────────────────────────────────────

export class PersonaNotFoundError extends Error {
  constructor(id: string) {
    super(`Persona not found: ${id}`);
    this.name = "PersonaNotFoundError";
  }
}

export interface PersonaRow {
  id: string;
  short_id: string;
  project_id: string | null;
  name: string;
  description: string;
  role: string;
  instructions: string;
  traits: string; // JSON
  goals: string; // JSON
  metadata: string | null; // JSON
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
  behaviors: string; // JSON array
  expertise_level: string;
  demographics: string; // JSON object
  pain_points: string; // JSON array
  // Auth credentials for multi-user session pool
  auth_email: string | null;
  auth_password: string | null;
  auth_login_path: string | null;
  auth_cookies: string | null; // JSON — saved session state
  auth_strategy: string | null; // "form-login" | "bearer" | "cookie" | "oauth" | "custom_script"
  auth_headers: string | null; // JSON — custom headers for bearer/cookie strategies
  auth_script: string | null; // JS script content for custom_script strategy
}

export interface PersonaAuth {
  email: string;
  password: string;
  loginPath: string;
  cookies: Record<string, unknown>[] | null; // saved session cookies
  strategy: AuthStrategy;
  headers?: Record<string, string>; // for bearer/cookie strategies
  customScript?: string; // for custom_script strategy
}

export interface AuthProfile {
  strategy: AuthStrategy;
  // Common
  email?: string;
  password?: string;
  loginPath?: string;
  emailFieldSelector?: string;
  passwordFieldSelector?: string;
  submitSelector?: string;
  postLoginWaitFor?: string;
  // Bearer strategy
  bearerToken?: string;
  // Cookie strategy
  cookies?: { name: string; value: string; domain?: string; path?: string }[];
  // OAuth strategy
  oauthProvider?: string;
  // Custom script strategy
  customScript?: string;
  // Custom headers for any strategy
  headers?: Record<string, string>;
}

export interface Persona {
  id: string;
  shortId: string;
  projectId: string | null; // null = global
  name: string;
  description: string;
  role: string;
  instructions: string;
  traits: string[];
  goals: string[];
  behaviors: string[];
  expertiseLevel: string;
  demographics: Record<string, unknown>;
  painPoints: string[];
  metadata: Record<string, unknown> | null;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  // Auth credentials for multi-user session pool
  auth: PersonaAuth | null;
}

export interface CreatePersonaInput {
  name: string;
  role: string;
  description?: string;
  instructions?: string;
  traits?: string[];
  goals?: string[];
  behaviors?: string[];
  expertiseLevel?: string;
  demographics?: Record<string, unknown>;
  painPoints?: string[];
  projectId?: string; // omit for global
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  // Auth credentials for multi-user session pool
  authEmail?: string;
  authPassword?: string;
  authLoginPath?: string;
  authStrategy?: AuthStrategy;
  authHeaders?: Record<string, string>;
  authCustomScript?: string;
}

export interface UpdatePersonaInput {
  name?: string;
  role?: string;
  description?: string;
  instructions?: string;
  traits?: string[];
  goals?: string[];
  behaviors?: string[];
  expertiseLevel?: string;
  demographics?: Record<string, unknown>;
  painPoints?: string[];
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  // Auth credentials for multi-user session pool
  authEmail?: string;
  authPassword?: string;
  authLoginPath?: string;
  authCookies?: Record<string, unknown>[] | null;
  authStrategy?: AuthStrategy;
  authHeaders?: Record<string, string>;
  authCustomScript?: string;
}

export interface PersonaFilter {
  projectId?: string;
  enabled?: boolean;
  globalOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function personaFromRow(row: PersonaRow): Persona {
  const hasAuth = row.auth_email && row.auth_password;
  return {
    id: row.id,
    shortId: row.short_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    role: row.role,
    instructions: row.instructions,
    traits: JSON.parse(row.traits || "[]"),
    goals: JSON.parse(row.goals || "[]"),
    behaviors: JSON.parse(row.behaviors || "[]"),
    expertiseLevel: row.expertise_level || "intermediate",
    demographics: JSON.parse(row.demographics || "{}"),
    painPoints: JSON.parse(row.pain_points || "[]"),
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    enabled: row.enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    auth: hasAuth ? {
      email: row.auth_email!,
      password: row.auth_password!,
      loginPath: row.auth_login_path ?? "/login",
      cookies: row.auth_cookies ? JSON.parse(row.auth_cookies) : null,
      strategy: (row.auth_strategy as AuthStrategy) ?? "form-login",
      headers: row.auth_headers ? JSON.parse(row.auth_headers) : undefined,
      customScript: row.auth_script ?? undefined,
    } : null,
  };
}

// ─── API Check Types ──────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
export type ApiCheckStatus = 'passed' | 'failed' | 'error';

export interface ApiCheckRow {
  id: string;
  short_id: string;
  project_id: string | null;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  headers: string; // JSON
  body: string | null;
  expected_status: number;
  expected_body_contains: string | null;
  expected_response_time_ms: number | null;
  timeout_ms: number;
  tags: string; // JSON
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ApiCheckResultRow {
  id: string;
  check_id: string;
  run_id: string | null;
  status: ApiCheckStatus;
  status_code: number | null;
  response_time_ms: number | null;
  response_body: string | null;
  response_headers: string; // JSON
  error: string | null;
  assertions_passed: string; // JSON
  assertions_failed: string; // JSON
  metadata: string | null; // JSON
  created_at: string;
}

export interface ApiCheck {
  id: string;
  shortId: string;
  projectId: string | null;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  expectedStatus: number;
  expectedBodyContains: string | null;
  expectedResponseTimeMs: number | null;
  timeoutMs: number;
  tags: string[];
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCheckResult {
  id: string;
  checkId: string;
  runId: string | null;
  status: ApiCheckStatus;
  statusCode: number | null;
  responseTimeMs: number | null;
  responseBody: string | null;
  responseHeaders: Record<string, string>;
  error: string | null;
  assertionsPassed: string[];
  assertionsFailed: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateApiCheckInput {
  name: string;
  method?: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  expectedStatus?: number;
  expectedBodyContains?: string;
  expectedResponseTimeMs?: number;
  timeoutMs?: number;
  tags?: string[];
  description?: string;
  projectId?: string;
  enabled?: boolean;
}

export interface UpdateApiCheckInput {
  name?: string;
  method?: HttpMethod;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  expectedStatus?: number;
  expectedBodyContains?: string;
  expectedResponseTimeMs?: number;
  timeoutMs?: number;
  tags?: string[];
  description?: string;
  enabled?: boolean;
}

export interface ApiCheckFilter {
  projectId?: string;
  enabled?: boolean;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export function apiCheckFromRow(row: ApiCheckRow): ApiCheck {
  return {
    id: row.id,
    shortId: row.short_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    method: row.method,
    url: row.url,
    headers: JSON.parse(row.headers),
    body: row.body,
    expectedStatus: row.expected_status,
    expectedBodyContains: row.expected_body_contains,
    expectedResponseTimeMs: row.expected_response_time_ms,
    timeoutMs: row.timeout_ms,
    tags: JSON.parse(row.tags),
    enabled: row.enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function apiCheckResultFromRow(row: ApiCheckResultRow): ApiCheckResult {
  return {
    id: row.id,
    checkId: row.check_id,
    runId: row.run_id,
    status: row.status,
    statusCode: row.status_code,
    responseTimeMs: row.response_time_ms,
    responseBody: row.response_body,
    responseHeaders: JSON.parse(row.response_headers),
    error: row.error,
    assertionsPassed: JSON.parse(row.assertions_passed),
    assertionsFailed: JSON.parse(row.assertions_failed),
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
  };
}
