// ─── Enums ───────────────────────────────────────────────────────────────────

export type ScenarioPriority = "low" | "medium" | "high" | "critical";
export type RunStatus = "pending" | "running" | "passed" | "failed" | "cancelled";
export type ResultStatus = "passed" | "failed" | "error" | "skipped";
export type ModelPreset = "quick" | "thorough" | "deep";

export type AssertionType = "visible" | "not_visible" | "text_contains" | "text_equals" | "element_count" | "no_console_errors" | "url_contains" | "title_contains";

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
};

// ─── Database Row Types (snake_case from SQLite) ─────────────────────────────

export interface ProjectRow {
  id: string;
  name: string;
  path: string | null;
  description: string | null;
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
  version: number;
  created_at: string;
  updated_at: string;
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
  createdAt: string;
  updatedAt: string;
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
  version: number;
  createdAt: string;
  updatedAt: string;
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
}

export interface ScenarioFilter {
  projectId?: string;
  tags?: string[];
  priority?: ScenarioPriority;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface RunFilter {
  projectId?: string;
  status?: RunStatus;
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
}

// ─── Row Converters ──────────────────────────────────────────────────────────

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description,
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
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
