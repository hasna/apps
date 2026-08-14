import {
  type CreateTestingWorkflowInput,
  type TestingWorkflow,
  type UpdateTestingWorkflowInput,
  type WorkflowExecutionConfig,
  type WorkflowExecutionInput,
  type WorkflowGoal,
  type WorkflowRow,
  type WorkflowScenarioFilter,
  workflowExecutionFromValue,
  workflowFromRow,
} from "../types/index.js";
import { getDatabase, now, resolvePartialId, uuid } from "./database.js";

const DEFAULT_EXECUTION: WorkflowExecutionConfig = { target: "local" };

function normalizeGoal(input: Partial<WorkflowGoal> | null | undefined): WorkflowGoal | null {
  if (!input) return null;
  const prompt = input.prompt?.trim();
  if (!prompt) return null;
  return {
    prompt,
    successCriteria: input.successCriteria ?? [],
    maxIterations: input.maxIterations ?? 10,
  };
}

function normalizeFilter(input: WorkflowScenarioFilter | undefined): WorkflowScenarioFilter {
  return {
    scenarioIds: input?.scenarioIds?.filter(Boolean),
    tags: input?.tags?.filter(Boolean),
    priority: input?.priority,
  };
}

function normalizeExecution(input: WorkflowExecutionInput | undefined): WorkflowExecutionConfig {
  return input ? workflowExecutionFromValue(input) : DEFAULT_EXECUTION;
}

export function createTestingWorkflow(input: CreateTestingWorkflowInput): TestingWorkflow {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO testing_workflows
      (id, project_id, name, description, scenario_filter, persona_ids, goal, execution, settings, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.name,
    input.description ?? null,
    JSON.stringify(normalizeFilter(input.scenarioFilter)),
    JSON.stringify(input.personaIds ?? []),
    JSON.stringify(normalizeGoal(input.goal)),
    JSON.stringify(normalizeExecution(input.execution)),
    JSON.stringify(input.settings ?? {}),
    input.enabled === false ? 0 : 1,
    timestamp,
    timestamp,
  );

  return getTestingWorkflow(id)!;
}

export function getTestingWorkflow(id: string): TestingWorkflow | null {
  const db = getDatabase();
  let row = db.query("SELECT * FROM testing_workflows WHERE id = ?").get(id) as WorkflowRow | null;
  if (row) return workflowFromRow(row);

  const fullId = resolvePartialId("testing_workflows", id);
  if (fullId) {
    row = db.query("SELECT * FROM testing_workflows WHERE id = ?").get(fullId) as WorkflowRow | null;
    if (row) return workflowFromRow(row);
  }

  row = db.query("SELECT * FROM testing_workflows WHERE name = ?").get(id) as WorkflowRow | null;
  return row ? workflowFromRow(row) : null;
}

export function listTestingWorkflows(filter?: { projectId?: string; enabled?: boolean }): TestingWorkflow[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }
  if (filter?.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.query(`SELECT * FROM testing_workflows${where} ORDER BY created_at DESC`).all(...params) as WorkflowRow[];
  return rows.map(workflowFromRow);
}

export function updateTestingWorkflow(id: string, input: UpdateTestingWorkflowInput): TestingWorkflow {
  const existing = getTestingWorkflow(id);
  if (!existing) throw new Error(`Testing workflow not found: ${id}`);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.scenarioFilter !== undefined) { fields.push("scenario_filter = ?"); values.push(JSON.stringify(normalizeFilter(input.scenarioFilter))); }
  if (input.personaIds !== undefined) { fields.push("persona_ids = ?"); values.push(JSON.stringify(input.personaIds)); }
  if (input.goal !== undefined) { fields.push("goal = ?"); values.push(JSON.stringify(normalizeGoal(input.goal))); }
  if (input.execution !== undefined) { fields.push("execution = ?"); values.push(JSON.stringify(normalizeExecution(input.execution))); }
  if (input.settings !== undefined) { fields.push("settings = ?"); values.push(JSON.stringify(input.settings)); }
  if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled ? 1 : 0); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(now(), existing.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db().query(`UPDATE testing_workflows SET ${fields.join(", ")} WHERE id = ?`) as any).run(...values);
  return getTestingWorkflow(existing.id)!;
}

export function deleteTestingWorkflow(id: string): boolean {
  const existing = getTestingWorkflow(id);
  if (!existing) return false;
  return getDatabase().query("DELETE FROM testing_workflows WHERE id = ?").run(existing.id).changes > 0;
}

function db() {
  return getDatabase();
}
