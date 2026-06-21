import type { Assertion, ScenarioPriority } from "../types/index.js";
import { getDatabase, now, resolvePartialId, uuid } from "./database.js";
import { getResult } from "./results.js";
import { getScenario } from "./scenarios.js";

type JsonObject = Record<string, unknown>;
type SqlValue = string | number | null;

function withImmediateTransaction<T>(db: ReturnType<typeof getDatabase>, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original operation error.
    }
    throw error;
  }
}

export type ExecutionSubjectKind = "web_app" | "api" | "cli" | "repo" | "service" | "dataset" | "custom";
export type TestSpecKind = "browser" | "api" | "eval" | "pipeline" | "agentic" | "manual" | "custom";
export type RunAttemptStatus = "queued" | "running" | "passed" | "failed" | "error" | "skipped" | "cancelled" | "flaky";
export type RunEventLevel = "debug" | "info" | "warn" | "error";
export type RunArtifactKind = "screenshot" | "har" | "log" | "trace" | "video" | "json" | "text" | "file" | "report" | "custom";
export type TestGoalStatus = "planned" | "active" | "satisfied" | "failed" | "cancelled";
export type LoopRunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "exhausted";

export type TestSpecStep = string | ({ instruction?: string; name?: string } & JsonObject);

export interface ExecutionSubjectRow {
  id: string;
  project_id: string | null;
  kind: ExecutionSubjectKind;
  name: string;
  uri: string | null;
  external_ref: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface TestSpecRow {
  id: string;
  project_id: string | null;
  subject_id: string | null;
  legacy_scenario_id: string | null;
  kind: TestSpecKind;
  name: string;
  description: string;
  objective: string | null;
  steps: string;
  assertions: string;
  tags: string;
  priority: ScenarioPriority;
  config: string;
  metadata: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TestGoalRow {
  id: string;
  project_id: string | null;
  subject_id: string | null;
  spec_id: string | null;
  title: string;
  prompt: string;
  success_criteria: string;
  status: TestGoalStatus;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface LoopRunRow {
  id: string;
  goal_id: string | null;
  spec_id: string | null;
  subject_id: string | null;
  run_id: string | null;
  status: LoopRunStatus;
  iteration: number;
  max_iterations: number | null;
  started_at: string;
  finished_at: string | null;
  result_summary: string | null;
  metadata: string;
}

export interface RunAttemptRow {
  id: string;
  loop_run_id: string | null;
  run_id: string | null;
  spec_id: string | null;
  subject_id: string | null;
  legacy_result_id: string | null;
  attempt_number: number;
  status: RunAttemptStatus;
  executor: string;
  model: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: string | null;
  error: string | null;
  metadata: string;
}

export interface RunEventRow {
  id: string;
  attempt_id: string;
  run_id: string | null;
  loop_run_id: string | null;
  sequence: number;
  level: RunEventLevel;
  type: string;
  message: string | null;
  data: string;
  created_at: string;
}

export interface RunArtifactRow {
  id: string;
  attempt_id: string;
  run_id: string | null;
  loop_run_id: string | null;
  legacy_screenshot_id: string | null;
  kind: RunArtifactKind;
  name: string;
  uri: string;
  mime_type: string | null;
  size_bytes: number | null;
  metadata: string;
  created_at: string;
}

export interface ExecutionSubject {
  id: string;
  projectId: string | null;
  kind: ExecutionSubjectKind;
  name: string;
  uri: string | null;
  externalRef: string | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface TestSpec {
  id: string;
  projectId: string | null;
  subjectId: string | null;
  legacyScenarioId: string | null;
  kind: TestSpecKind;
  name: string;
  description: string;
  objective: string | null;
  steps: TestSpecStep[];
  assertions: unknown[];
  tags: string[];
  priority: ScenarioPriority;
  config: JsonObject;
  metadata: JsonObject;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestGoal {
  id: string;
  projectId: string | null;
  subjectId: string | null;
  specId: string | null;
  title: string;
  prompt: string;
  successCriteria: string[];
  status: TestGoalStatus;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface LoopRun {
  id: string;
  goalId: string | null;
  specId: string | null;
  subjectId: string | null;
  runId: string | null;
  status: LoopRunStatus;
  iteration: number;
  maxIterations: number | null;
  startedAt: string;
  finishedAt: string | null;
  resultSummary: string | null;
  metadata: JsonObject;
}

export interface RunAttempt {
  id: string;
  loopRunId: string | null;
  runId: string | null;
  specId: string | null;
  subjectId: string | null;
  legacyResultId: string | null;
  attemptNumber: number;
  status: RunAttemptStatus;
  executor: string;
  model: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  metadata: JsonObject;
}

export interface ExecutionRunEvent {
  id: string;
  attemptId: string;
  runId: string | null;
  loopRunId: string | null;
  sequence: number;
  level: RunEventLevel;
  type: string;
  message: string | null;
  data: JsonObject;
  createdAt: string;
}

export interface RunArtifact {
  id: string;
  attemptId: string;
  runId: string | null;
  loopRunId: string | null;
  legacyScreenshotId: string | null;
  kind: RunArtifactKind;
  name: string;
  uri: string;
  mimeType: string | null;
  sizeBytes: number | null;
  metadata: JsonObject;
  createdAt: string;
}

export interface CreateExecutionSubjectInput {
  projectId?: string;
  kind?: ExecutionSubjectKind;
  name: string;
  uri?: string | null;
  externalRef?: string | null;
  metadata?: JsonObject;
}

export interface UpdateExecutionSubjectInput {
  projectId?: string | null;
  kind?: ExecutionSubjectKind;
  name?: string;
  uri?: string | null;
  externalRef?: string | null;
  metadata?: JsonObject;
}

export interface ExecutionSubjectFilter {
  projectId?: string;
  kind?: ExecutionSubjectKind;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateTestSpecInput {
  projectId?: string | null;
  subjectId?: string | null;
  legacyScenarioId?: string | null;
  kind?: TestSpecKind;
  name: string;
  description?: string;
  objective?: string | null;
  steps?: TestSpecStep[];
  assertions?: unknown[];
  tags?: string[];
  priority?: ScenarioPriority;
  config?: JsonObject;
  metadata?: JsonObject;
}

export interface UpdateTestSpecInput {
  projectId?: string | null;
  subjectId?: string | null;
  kind?: TestSpecKind;
  name?: string;
  description?: string;
  objective?: string | null;
  steps?: TestSpecStep[];
  assertions?: unknown[];
  tags?: string[];
  priority?: ScenarioPriority;
  config?: JsonObject;
  metadata?: JsonObject;
}

export interface TestSpecFilter {
  projectId?: string;
  subjectId?: string;
  kind?: TestSpecKind;
  tags?: string[];
  priority?: ScenarioPriority;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateRunAttemptInput {
  loopRunId?: string | null;
  runId?: string | null;
  specId?: string | null;
  subjectId?: string | null;
  legacyResultId?: string | null;
  attemptNumber?: number;
  status?: RunAttemptStatus;
  executor?: string;
  model?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  summary?: string | null;
  error?: string | null;
  metadata?: JsonObject;
}

export interface UpdateRunAttemptInput {
  status?: RunAttemptStatus;
  executor?: string;
  model?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  summary?: string | null;
  error?: string | null;
  metadata?: JsonObject;
}

export interface RunAttemptFilter {
  runId?: string;
  loopRunId?: string;
  specId?: string;
  subjectId?: string;
  status?: RunAttemptStatus;
  limit?: number;
  offset?: number;
}

export interface CreateRunEventInput {
  attemptId: string;
  runId?: string | null;
  loopRunId?: string | null;
  sequence?: number;
  level?: RunEventLevel;
  type: string;
  message?: string | null;
  data?: JsonObject;
}

export interface CreateRunArtifactInput {
  attemptId: string;
  runId?: string | null;
  loopRunId?: string | null;
  legacyScreenshotId?: string | null;
  kind?: RunArtifactKind;
  name: string;
  uri: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  metadata?: JsonObject;
}

export interface CreateTestGoalInput {
  projectId?: string | null;
  subjectId?: string | null;
  specId?: string | null;
  title: string;
  prompt: string;
  successCriteria?: string[];
  status?: TestGoalStatus;
  metadata?: JsonObject;
}

export interface UpdateTestGoalInput {
  status?: TestGoalStatus;
  title?: string;
  prompt?: string;
  successCriteria?: string[];
  metadata?: JsonObject;
}

export interface CreateLoopRunInput {
  goalId?: string | null;
  specId?: string | null;
  subjectId?: string | null;
  runId?: string | null;
  status?: LoopRunStatus;
  iteration?: number;
  maxIterations?: number | null;
  startedAt?: string;
  finishedAt?: string | null;
  resultSummary?: string | null;
  metadata?: JsonObject;
}

export interface UpdateLoopRunInput {
  status?: LoopRunStatus;
  iteration?: number;
  maxIterations?: number | null;
  finishedAt?: string | null;
  resultSummary?: string | null;
  metadata?: JsonObject;
}

function jsonObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    return jsonObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function cleanText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback);
}

function withLimitOffset(sql: string, params: SqlValue[], limit?: number, offset?: number): string {
  let nextSql = sql;
  if (limit !== undefined) {
    nextSql += " LIMIT ?";
    params.push(limit);
  }
  if (offset !== undefined) {
    nextSql += " OFFSET ?";
    params.push(offset);
  }
  return nextSql;
}

function terminalAttemptStatus(status: RunAttemptStatus): boolean {
  return status === "passed" || status === "failed" || status === "error" || status === "skipped" || status === "cancelled" || status === "flaky";
}

export function executionSubjectFromRow(row: ExecutionSubjectRow): ExecutionSubject {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    uri: row.uri,
    externalRef: row.external_ref,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function testSpecFromRow(row: TestSpecRow): TestSpec {
  return {
    id: row.id,
    projectId: row.project_id,
    subjectId: row.subject_id,
    legacyScenarioId: row.legacy_scenario_id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    objective: row.objective,
    steps: parseJsonArray<TestSpecStep>(row.steps),
    assertions: parseJsonArray<unknown>(row.assertions),
    tags: parseJsonArray<string>(row.tags),
    priority: row.priority,
    config: parseJsonObject(row.config),
    metadata: parseJsonObject(row.metadata),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function testGoalFromRow(row: TestGoalRow): TestGoal {
  return {
    id: row.id,
    projectId: row.project_id,
    subjectId: row.subject_id,
    specId: row.spec_id,
    title: row.title,
    prompt: row.prompt,
    successCriteria: parseJsonArray<string>(row.success_criteria),
    status: row.status,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loopRunFromRow(row: LoopRunRow): LoopRun {
  return {
    id: row.id,
    goalId: row.goal_id,
    specId: row.spec_id,
    subjectId: row.subject_id,
    runId: row.run_id,
    status: row.status,
    iteration: row.iteration,
    maxIterations: row.max_iterations,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    resultSummary: row.result_summary,
    metadata: parseJsonObject(row.metadata),
  };
}

export function runAttemptFromRow(row: RunAttemptRow): RunAttempt {
  return {
    id: row.id,
    loopRunId: row.loop_run_id,
    runId: row.run_id,
    specId: row.spec_id,
    subjectId: row.subject_id,
    legacyResultId: row.legacy_result_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    executor: row.executor,
    model: row.model,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    summary: row.summary,
    error: row.error,
    metadata: parseJsonObject(row.metadata),
  };
}

export function runEventFromRow(row: RunEventRow): ExecutionRunEvent {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    runId: row.run_id,
    loopRunId: row.loop_run_id,
    sequence: row.sequence,
    level: row.level,
    type: row.type,
    message: row.message,
    data: parseJsonObject(row.data),
    createdAt: row.created_at,
  };
}

export function runArtifactFromRow(row: RunArtifactRow): RunArtifact {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    runId: row.run_id,
    loopRunId: row.loop_run_id,
    legacyScreenshotId: row.legacy_screenshot_id,
    kind: row.kind,
    name: row.name,
    uri: row.uri,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at,
  };
}

export function createExecutionSubject(input: CreateExecutionSubjectInput): ExecutionSubject {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO execution_subjects (id, project_id, kind, name, uri, external_ref, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.kind ?? "custom",
    cleanText(input.name, "name"),
    optionalText(input.uri),
    optionalText(input.externalRef),
    toJson(input.metadata, {}),
    timestamp,
    timestamp,
  );

  return getExecutionSubject(id)!;
}

export function getExecutionSubject(id: string): ExecutionSubject | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM execution_subjects WHERE id = ?").get(id) as ExecutionSubjectRow | null;
  if (row) return executionSubjectFromRow(row);

  const fullId = resolvePartialId("execution_subjects", id);
  if (fullId) {
    row = db.query("SELECT * FROM execution_subjects WHERE id = ?").get(fullId) as ExecutionSubjectRow | null;
    if (row) return executionSubjectFromRow(row);
  }

  return null;
}

export function listExecutionSubjects(filter?: ExecutionSubjectFilter): ExecutionSubject[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }
  if (filter?.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter?.search) {
    conditions.push("(name LIKE ? OR uri LIKE ? OR external_ref LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = withLimitOffset(`SELECT * FROM execution_subjects${where} ORDER BY created_at DESC`, params, filter?.limit, filter?.offset);
  const rows = db.query(sql).all(...params) as ExecutionSubjectRow[];
  return rows.map(executionSubjectFromRow);
}

export function updateExecutionSubject(id: string, input: UpdateExecutionSubjectInput): ExecutionSubject {
  const existing = getExecutionSubject(id);
  if (!existing) throw new Error(`Execution subject not found: ${id}`);

  const fields: string[] = [];
  const values: SqlValue[] = [];

  if (input.projectId !== undefined) { fields.push("project_id = ?"); values.push(input.projectId); }
  if (input.kind !== undefined) { fields.push("kind = ?"); values.push(input.kind); }
  if (input.name !== undefined) { fields.push("name = ?"); values.push(cleanText(input.name, "name")); }
  if (input.uri !== undefined) { fields.push("uri = ?"); values.push(optionalText(input.uri)); }
  if (input.externalRef !== undefined) { fields.push("external_ref = ?"); values.push(optionalText(input.externalRef)); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(toJson(input.metadata, {})); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(now(), existing.id);
  getDatabase().query(`UPDATE execution_subjects SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getExecutionSubject(existing.id)!;
}

export function createTestSpec(input: CreateTestSpecInput): TestSpec {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO test_specs
      (id, project_id, subject_id, legacy_scenario_id, kind, name, description, objective, steps, assertions, tags, priority, config, metadata, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.subjectId ?? null,
    input.legacyScenarioId ?? null,
    input.kind ?? "custom",
    cleanText(input.name, "name"),
    input.description ?? "",
    optionalText(input.objective),
    toJson(input.steps, []),
    toJson(input.assertions, []),
    toJson(input.tags, []),
    input.priority ?? "medium",
    toJson(input.config, {}),
    toJson(input.metadata, {}),
    timestamp,
    timestamp,
  );

  return getTestSpec(id)!;
}

export function getTestSpec(id: string): TestSpec | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM test_specs WHERE id = ?").get(id) as TestSpecRow | null;
  if (row) return testSpecFromRow(row);

  const fullId = resolvePartialId("test_specs", id);
  if (fullId) {
    row = db.query("SELECT * FROM test_specs WHERE id = ?").get(fullId) as TestSpecRow | null;
    if (row) return testSpecFromRow(row);
  }

  row = db.query("SELECT * FROM test_specs WHERE legacy_scenario_id = ?").get(id) as TestSpecRow | null;
  return row ? testSpecFromRow(row) : null;
}

export function listTestSpecs(filter?: TestSpecFilter): TestSpec[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }
  if (filter?.subjectId) {
    conditions.push("subject_id = ?");
    params.push(filter.subjectId);
  }
  if (filter?.kind) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter?.priority) {
    conditions.push("priority = ?");
    params.push(filter.priority);
  }
  if (filter?.tags) {
    for (const tag of filter.tags) {
      conditions.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }
  }
  if (filter?.search) {
    conditions.push("(name LIKE ? OR description LIKE ? OR objective LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = withLimitOffset(`SELECT * FROM test_specs${where} ORDER BY created_at DESC`, params, filter?.limit, filter?.offset);
  const rows = db.query(sql).all(...params) as TestSpecRow[];
  return rows.map(testSpecFromRow);
}

export function updateTestSpec(id: string, input: UpdateTestSpecInput): TestSpec {
  const existing = getTestSpec(id);
  if (!existing) throw new Error(`Test spec not found: ${id}`);

  const fields: string[] = [];
  const values: SqlValue[] = [];

  if (input.projectId !== undefined) { fields.push("project_id = ?"); values.push(input.projectId); }
  if (input.subjectId !== undefined) { fields.push("subject_id = ?"); values.push(input.subjectId); }
  if (input.kind !== undefined) { fields.push("kind = ?"); values.push(input.kind); }
  if (input.name !== undefined) { fields.push("name = ?"); values.push(cleanText(input.name, "name")); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.objective !== undefined) { fields.push("objective = ?"); values.push(optionalText(input.objective)); }
  if (input.steps !== undefined) { fields.push("steps = ?"); values.push(toJson(input.steps, [])); }
  if (input.assertions !== undefined) { fields.push("assertions = ?"); values.push(toJson(input.assertions, [])); }
  if (input.tags !== undefined) { fields.push("tags = ?"); values.push(toJson(input.tags, [])); }
  if (input.priority !== undefined) { fields.push("priority = ?"); values.push(input.priority); }
  if (input.config !== undefined) { fields.push("config = ?"); values.push(toJson(input.config, {})); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(toJson(input.metadata, {})); }

  if (fields.length === 0) return existing;

  fields.push("version = version + 1");
  fields.push("updated_at = ?");
  values.push(now(), existing.id);
  getDatabase().query(`UPDATE test_specs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getTestSpec(existing.id)!;
}

export function ensureTestSpecForScenario(scenarioId: string): TestSpec {
  const db = getDatabase();
  const existing = db.query("SELECT * FROM test_specs WHERE legacy_scenario_id = ?").get(scenarioId) as TestSpecRow | null;
  if (existing) return testSpecFromRow(existing);

  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

  return createTestSpec({
    projectId: scenario.projectId,
    legacyScenarioId: scenario.id,
    kind: scenario.scenarioType,
    name: scenario.name,
    description: scenario.description,
    objective: scenario.description || scenario.name,
    steps: scenario.steps,
    assertions: scenario.assertions as Assertion[],
    tags: scenario.tags,
    priority: scenario.priority,
    config: {
      model: scenario.model,
      timeoutMs: scenario.timeoutMs,
      targetPath: scenario.targetPath,
      requiresAuth: scenario.requiresAuth,
      authConfig: scenario.authConfig,
      personaId: scenario.personaId,
      requiredRole: scenario.requiredRole,
      parameters: scenario.parameters,
    },
    metadata: {
      ...(scenario.metadata ?? {}),
      legacyScenarioShortId: scenario.shortId,
      compatibility: "scenario",
    },
  });
}

function nextAttemptNumber(runId: string | null | undefined, specId: string | null | undefined): number {
  if (!runId || !specId) return 1;
  const row = getDatabase()
    .query("SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next FROM run_attempts WHERE run_id = ? AND spec_id = ?")
    .get(runId, specId) as { next: number };
  return row.next;
}

export function createRunAttempt(input: CreateRunAttemptInput): RunAttempt {
  const db = getDatabase();
  const id = uuid();
  const status = input.status ?? "queued";
  const finishedAt = input.finishedAt ?? (terminalAttemptStatus(status) ? now() : null);

  withImmediateTransaction(db, () => {
    db.query(`
      INSERT INTO run_attempts
        (id, loop_run_id, run_id, spec_id, subject_id, legacy_result_id, attempt_number, status, executor, model, started_at, finished_at, duration_ms, summary, error, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.loopRunId ?? null,
      input.runId ?? null,
      input.specId ?? null,
      input.subjectId ?? null,
      input.legacyResultId ?? null,
      input.attemptNumber ?? nextAttemptNumber(input.runId, input.specId),
      status,
      cleanText(input.executor ?? "manual", "executor"),
      input.model ?? null,
      input.startedAt ?? now(),
      finishedAt,
      input.durationMs ?? null,
      input.summary ?? null,
      input.error ?? null,
      toJson(input.metadata, {}),
    );
  });

  return getRunAttempt(id)!;
}

export function getRunAttempt(id: string): RunAttempt | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM run_attempts WHERE id = ?").get(id) as RunAttemptRow | null;
  if (row) return runAttemptFromRow(row);

  const fullId = resolvePartialId("run_attempts", id);
  if (fullId) {
    row = db.query("SELECT * FROM run_attempts WHERE id = ?").get(fullId) as RunAttemptRow | null;
    if (row) return runAttemptFromRow(row);
  }

  row = db.query("SELECT * FROM run_attempts WHERE legacy_result_id = ?").get(id) as RunAttemptRow | null;
  return row ? runAttemptFromRow(row) : null;
}

export function listRunAttempts(filter?: RunAttemptFilter): RunAttempt[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (filter?.runId) { conditions.push("run_id = ?"); params.push(filter.runId); }
  if (filter?.loopRunId) { conditions.push("loop_run_id = ?"); params.push(filter.loopRunId); }
  if (filter?.specId) { conditions.push("spec_id = ?"); params.push(filter.specId); }
  if (filter?.subjectId) { conditions.push("subject_id = ?"); params.push(filter.subjectId); }
  if (filter?.status) { conditions.push("status = ?"); params.push(filter.status); }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = withLimitOffset(`SELECT * FROM run_attempts${where} ORDER BY started_at DESC`, params, filter?.limit, filter?.offset);
  const rows = db.query(sql).all(...params) as RunAttemptRow[];
  return rows.map(runAttemptFromRow);
}

export function updateRunAttempt(id: string, input: UpdateRunAttemptInput): RunAttempt {
  const existing = getRunAttempt(id);
  if (!existing) throw new Error(`Run attempt not found: ${id}`);

  const fields: string[] = [];
  const values: SqlValue[] = [];

  if (input.status !== undefined) {
    fields.push("status = ?");
    values.push(input.status);
    if (input.finishedAt === undefined && terminalAttemptStatus(input.status) && existing.finishedAt === null) {
      fields.push("finished_at = ?");
      values.push(now());
    }
  }
  if (input.executor !== undefined) { fields.push("executor = ?"); values.push(cleanText(input.executor, "executor")); }
  if (input.model !== undefined) { fields.push("model = ?"); values.push(input.model); }
  if (input.finishedAt !== undefined) { fields.push("finished_at = ?"); values.push(input.finishedAt); }
  if (input.durationMs !== undefined) { fields.push("duration_ms = ?"); values.push(input.durationMs); }
  if (input.summary !== undefined) { fields.push("summary = ?"); values.push(input.summary); }
  if (input.error !== undefined) { fields.push("error = ?"); values.push(input.error); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(toJson(input.metadata, {})); }

  if (fields.length === 0) return existing;

  values.push(existing.id);
  getDatabase().query(`UPDATE run_attempts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getRunAttempt(existing.id)!;
}

export function ensureRunAttemptForResult(resultId: string): RunAttempt {
  const db = getDatabase();
  const existing = db.query("SELECT * FROM run_attempts WHERE legacy_result_id = ?").get(resultId) as RunAttemptRow | null;
  if (existing) return runAttemptFromRow(existing);

  const result = getResult(resultId);
  if (!result) throw new Error(`Result not found: ${resultId}`);

  const spec = ensureTestSpecForScenario(result.scenarioId);
  return createRunAttempt({
    runId: result.runId,
    specId: spec.id,
    subjectId: spec.subjectId,
    legacyResultId: result.id,
    status: result.status,
    executor: "legacy-result",
    model: result.model,
    startedAt: result.createdAt,
    finishedAt: terminalAttemptStatus(result.status) ? result.createdAt : null,
    durationMs: result.durationMs,
    summary: result.reasoning,
    error: result.error,
    metadata: {
      ...(result.metadata ?? {}),
      costCents: result.costCents,
      stepsCompleted: result.stepsCompleted,
      stepsTotal: result.stepsTotal,
      tokensUsed: result.tokensUsed,
      failureAnalysis: result.failureAnalysis,
      harPath: result.harPath,
      compatibility: "result",
    },
  });
}

function nextEventSequence(attemptId: string): number {
  const row = getDatabase()
    .query("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM run_events WHERE attempt_id = ?")
    .get(attemptId) as { next: number };
  return row.next;
}

export function recordRunEvent(input: CreateRunEventInput): ExecutionRunEvent {
  const db = getDatabase();
  const id = uuid();

  withImmediateTransaction(db, () => {
    db.query(`
      INSERT INTO run_events (id, attempt_id, run_id, loop_run_id, sequence, level, type, message, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.attemptId,
      input.runId ?? null,
      input.loopRunId ?? null,
      input.sequence ?? nextEventSequence(input.attemptId),
      input.level ?? "info",
      cleanText(input.type, "type"),
      input.message ?? null,
      toJson(input.data, {}),
      now(),
    );
  });

  return getRunEvent(id)!;
}

export function getRunEvent(id: string): ExecutionRunEvent | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM run_events WHERE id = ?").get(id) as RunEventRow | null;
  if (row) return runEventFromRow(row);

  const fullId = resolvePartialId("run_events", id);
  if (!fullId) return null;

  row = db.query("SELECT * FROM run_events WHERE id = ?").get(fullId) as RunEventRow | null;
  return row ? runEventFromRow(row) : null;
}

export function listRunEvents(attemptId: string): ExecutionRunEvent[] {
  const rows = getDatabase()
    .query("SELECT * FROM run_events WHERE attempt_id = ? ORDER BY sequence ASC")
    .all(attemptId) as RunEventRow[];
  return rows.map(runEventFromRow);
}

export function createRunArtifact(input: CreateRunArtifactInput): RunArtifact {
  const db = getDatabase();
  const id = uuid();

  db.query(`
    INSERT INTO run_artifacts
      (id, attempt_id, run_id, loop_run_id, legacy_screenshot_id, kind, name, uri, mime_type, size_bytes, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.attemptId,
    input.runId ?? null,
    input.loopRunId ?? null,
    input.legacyScreenshotId ?? null,
    input.kind ?? "file",
    cleanText(input.name, "name"),
    cleanText(input.uri, "uri"),
    input.mimeType ?? null,
    input.sizeBytes ?? null,
    toJson(input.metadata, {}),
    now(),
  );

  return getRunArtifact(id)!;
}

export function getRunArtifact(id: string): RunArtifact | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM run_artifacts WHERE id = ?").get(id) as RunArtifactRow | null;
  if (row) return runArtifactFromRow(row);

  const fullId = resolvePartialId("run_artifacts", id);
  if (!fullId) return null;

  row = db.query("SELECT * FROM run_artifacts WHERE id = ?").get(fullId) as RunArtifactRow | null;
  return row ? runArtifactFromRow(row) : null;
}

export function listRunArtifacts(attemptId: string): RunArtifact[] {
  const rows = getDatabase()
    .query("SELECT * FROM run_artifacts WHERE attempt_id = ? ORDER BY created_at ASC")
    .all(attemptId) as RunArtifactRow[];
  return rows.map(runArtifactFromRow);
}

export function createTestGoal(input: CreateTestGoalInput): TestGoal {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO test_goals
      (id, project_id, subject_id, spec_id, title, prompt, success_criteria, status, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.subjectId ?? null,
    input.specId ?? null,
    cleanText(input.title, "title"),
    cleanText(input.prompt, "prompt"),
    toJson(input.successCriteria, []),
    input.status ?? "planned",
    toJson(input.metadata, {}),
    timestamp,
    timestamp,
  );

  return getTestGoal(id)!;
}

export function getTestGoal(id: string): TestGoal | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM test_goals WHERE id = ?").get(id) as TestGoalRow | null;
  if (row) return testGoalFromRow(row);

  const fullId = resolvePartialId("test_goals", id);
  if (!fullId) return null;

  row = db.query("SELECT * FROM test_goals WHERE id = ?").get(fullId) as TestGoalRow | null;
  return row ? testGoalFromRow(row) : null;
}

export function listTestGoals(filter?: { projectId?: string; status?: TestGoalStatus; subjectId?: string; specId?: string }): TestGoal[] {
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (filter?.projectId) { conditions.push("project_id = ?"); params.push(filter.projectId); }
  if (filter?.status) { conditions.push("status = ?"); params.push(filter.status); }
  if (filter?.subjectId) { conditions.push("subject_id = ?"); params.push(filter.subjectId); }
  if (filter?.specId) { conditions.push("spec_id = ?"); params.push(filter.specId); }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDatabase().query(`SELECT * FROM test_goals${where} ORDER BY created_at DESC`).all(...params) as TestGoalRow[];
  return rows.map(testGoalFromRow);
}

export function updateTestGoal(id: string, input: UpdateTestGoalInput): TestGoal {
  const existing = getTestGoal(id);
  if (!existing) throw new Error(`Test goal not found: ${id}`);

  const fields: string[] = [];
  const values: SqlValue[] = [];

  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.title !== undefined) { fields.push("title = ?"); values.push(cleanText(input.title, "title")); }
  if (input.prompt !== undefined) { fields.push("prompt = ?"); values.push(cleanText(input.prompt, "prompt")); }
  if (input.successCriteria !== undefined) { fields.push("success_criteria = ?"); values.push(toJson(input.successCriteria, [])); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(toJson(input.metadata, {})); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(now(), existing.id);
  getDatabase().query(`UPDATE test_goals SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getTestGoal(existing.id)!;
}

export function createLoopRun(input: CreateLoopRunInput): LoopRun {
  const db = getDatabase();
  const id = uuid();

  db.query(`
    INSERT INTO loop_runs
      (id, goal_id, spec_id, subject_id, run_id, status, iteration, max_iterations, started_at, finished_at, result_summary, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.goalId ?? null,
    input.specId ?? null,
    input.subjectId ?? null,
    input.runId ?? null,
    input.status ?? "pending",
    input.iteration ?? 0,
    input.maxIterations ?? null,
    input.startedAt ?? now(),
    input.finishedAt ?? null,
    input.resultSummary ?? null,
    toJson(input.metadata, {}),
  );

  return getLoopRun(id)!;
}

export function getLoopRun(id: string): LoopRun | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM loop_runs WHERE id = ?").get(id) as LoopRunRow | null;
  if (row) return loopRunFromRow(row);

  const fullId = resolvePartialId("loop_runs", id);
  if (!fullId) return null;

  row = db.query("SELECT * FROM loop_runs WHERE id = ?").get(fullId) as LoopRunRow | null;
  return row ? loopRunFromRow(row) : null;
}

export function listLoopRuns(filter?: { goalId?: string; runId?: string; status?: LoopRunStatus }): LoopRun[] {
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (filter?.goalId) { conditions.push("goal_id = ?"); params.push(filter.goalId); }
  if (filter?.runId) { conditions.push("run_id = ?"); params.push(filter.runId); }
  if (filter?.status) { conditions.push("status = ?"); params.push(filter.status); }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDatabase().query(`SELECT * FROM loop_runs${where} ORDER BY started_at DESC`).all(...params) as LoopRunRow[];
  return rows.map(loopRunFromRow);
}

export function updateLoopRun(id: string, input: UpdateLoopRunInput): LoopRun {
  const existing = getLoopRun(id);
  if (!existing) throw new Error(`Loop run not found: ${id}`);

  const fields: string[] = [];
  const values: SqlValue[] = [];

  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.iteration !== undefined) { fields.push("iteration = ?"); values.push(input.iteration); }
  if (input.maxIterations !== undefined) { fields.push("max_iterations = ?"); values.push(input.maxIterations); }
  if (input.finishedAt !== undefined) { fields.push("finished_at = ?"); values.push(input.finishedAt); }
  if (input.resultSummary !== undefined) { fields.push("result_summary = ?"); values.push(input.resultSummary); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(toJson(input.metadata, {})); }

  if (fields.length === 0) return existing;

  values.push(existing.id);
  getDatabase().query(`UPDATE loop_runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getLoopRun(existing.id)!;
}
