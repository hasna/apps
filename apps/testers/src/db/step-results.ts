import { getDatabase, now, uuid } from "../db/database.js";

export interface CreateStepResultInput {
  resultId: string;
  stepNumber: number;
  action: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  thinking?: string;
}

export interface StepResult {
  id: string;
  resultId: string;
  stepNumber: number;
  action: string;
  status: "passed" | "failed" | "error" | "running" | "skipped";
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolResult: string | null;
  thinking: string | null;
  error: string | null;
  durationMs: number | null;
  screenshotId: string | null;
  createdAt: string;
}

export function createStepResult(input: CreateStepResultInput): StepResult {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO step_results (id, result_id, step_number, action, status, tool_name, tool_input, thinking, created_at)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(
    id,
    input.resultId,
    input.stepNumber,
    input.action,
    input.toolName ?? null,
    input.toolInput ? JSON.stringify(input.toolInput) : null,
    input.thinking ?? null,
    timestamp,
  );

  return getStepResult(id)!;
}

export function getStepResult(id: string): StepResult | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM step_results WHERE id = ?").get(id) as StepResultRow | null;
  return row ? stepResultFromRow(row) : null;
}

export function listStepResults(resultId: string): StepResult[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM step_results WHERE result_id = ? ORDER BY step_number ASC")
    .all(resultId) as StepResultRow[];
  return rows.map(stepResultFromRow);
}

export function updateStepResult(
  id: string,
  updates: Partial<StepResult> & { toolResult?: string },
): StepResult | null {
  const db = getDatabase();
  const existing = getStepResult(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
  if (updates.toolResult !== undefined) { sets.push("tool_result = ?"); params.push(updates.toolResult); }
  if (updates.error !== undefined) { sets.push("error = ?"); params.push(updates.error); }
  if (updates.durationMs !== undefined) { sets.push("duration_ms = ?"); params.push(updates.durationMs); }
  if (updates.screenshotId !== undefined) { sets.push("screenshot_id = ?"); params.push(updates.screenshotId); }

  if (sets.length === 0) return existing;

  params.push(id);
  db.query(`UPDATE step_results SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getStepResult(id);
}

interface StepResultRow {
  id: string;
  result_id: string;
  step_number: number;
  action: string;
  status: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_result: string | null;
  thinking: string | null;
  error: string | null;
  duration_ms: number | null;
  screenshot_id: string | null;
  created_at: string;
}

function stepResultFromRow(row: StepResultRow): StepResult {
  return {
    id: row.id,
    resultId: row.result_id,
    stepNumber: row.step_number,
    action: row.action,
    status: row.status as StepResult["status"],
    toolName: row.tool_name,
    toolInput: row.tool_input ? JSON.parse(row.tool_input) : null,
    toolResult: row.tool_result,
    thinking: row.thinking,
    error: row.error,
    durationMs: row.duration_ms,
    screenshotId: row.screenshot_id,
    createdAt: row.created_at,
  };
}
