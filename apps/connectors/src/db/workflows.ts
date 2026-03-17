import type { Database } from "bun:sqlite";
import { getDatabase, now, shortUuid } from "./database.js";

export interface WorkflowStep {
  connector: string;
  command: string;
  args?: string[];
}

export interface ConnectorWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  enabled: boolean;
  created_at: string;
}

interface WorkflowRow {
  id: string; name: string; steps: string; enabled: number; created_at: string;
}

function rowToWorkflow(row: WorkflowRow): ConnectorWorkflow {
  return {
    ...row,
    steps: JSON.parse(row.steps || "[]") as WorkflowStep[],
    enabled: row.enabled === 1,
  };
}

export function createWorkflow(
  input: { name: string; steps: WorkflowStep[] },
  db?: Database
): ConnectorWorkflow {
  const d = db ?? getDatabase();
  const id = shortUuid();
  d.run(
    "INSERT INTO connector_workflows (id, name, steps, enabled, created_at) VALUES (?, ?, ?, 1, ?)",
    [id, input.name, JSON.stringify(input.steps), now()]
  );
  return getWorkflow(id, d)!;
}

export function getWorkflow(id: string, db?: Database): ConnectorWorkflow | null {
  const d = db ?? getDatabase();
  const row = d.query("SELECT * FROM connector_workflows WHERE id = ?").get(id) as WorkflowRow | null;
  return row ? rowToWorkflow(row) : null;
}

export function getWorkflowByName(name: string, db?: Database): ConnectorWorkflow | null {
  const d = db ?? getDatabase();
  const row = d.query("SELECT * FROM connector_workflows WHERE name = ?").get(name) as WorkflowRow | null;
  return row ? rowToWorkflow(row) : null;
}

export function listWorkflows(db?: Database): ConnectorWorkflow[] {
  const d = db ?? getDatabase();
  return (d.query("SELECT * FROM connector_workflows ORDER BY name").all() as WorkflowRow[]).map(rowToWorkflow);
}

export function updateWorkflow(
  id: string,
  input: Partial<{ name: string; steps: WorkflowStep[]; enabled: boolean }>,
  db?: Database
): ConnectorWorkflow {
  const d = db ?? getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.steps !== undefined) { sets.push("steps = ?"); params.push(JSON.stringify(input.steps)); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(input.enabled ? 1 : 0); }
  if (sets.length === 0) return getWorkflow(id, d)!;
  params.push(id);
  d.run(`UPDATE connector_workflows SET ${sets.join(", ")} WHERE id = ?`, params as Parameters<typeof d.run>[1]);
  return getWorkflow(id, d)!;
}

export function deleteWorkflow(id: string, db?: Database): boolean {
  const d = db ?? getDatabase();
  return d.run("DELETE FROM connector_workflows WHERE id = ?", [id]).changes > 0;
}
