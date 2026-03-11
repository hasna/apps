import {
  type Result,
  type ResultRow,
  type ResultStatus,
  resultFromRow,
} from "../types/index.js";
import { getDatabase, now, uuid, resolvePartialId } from "./database.js";

export function createResult(input: {
  runId: string;
  scenarioId: string;
  model: string;
  stepsTotal: number;
}): Result {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO results (id, run_id, scenario_id, status, reasoning, error, steps_completed, steps_total, duration_ms, model, tokens_used, cost_cents, metadata, created_at)
    VALUES (?, ?, ?, 'skipped', NULL, NULL, 0, ?, 0, ?, 0, 0, '{}', ?)
  `).run(
    id,
    input.runId,
    input.scenarioId,
    input.stepsTotal,
    input.model,
    timestamp,
  );

  return getResult(id)!;
}

export function getResult(id: string): Result | null {
  const db = getDatabase();

  let row = db.query("SELECT * FROM results WHERE id = ?").get(id) as ResultRow | null;
  if (row) return resultFromRow(row);

  const fullId = resolvePartialId("results", id);
  if (fullId) {
    row = db.query("SELECT * FROM results WHERE id = ?").get(fullId) as ResultRow | null;
    if (row) return resultFromRow(row);
  }

  return null;
}

export function listResults(runId: string): Result[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM results WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as ResultRow[];
  return rows.map(resultFromRow);
}

export function updateResult(
  id: string,
  updates: Partial<{
    status: ResultStatus;
    reasoning: string;
    error: string;
    stepsCompleted: number;
    durationMs: number;
    tokensUsed: number;
    costCents: number;
  }>,
): Result {
  const db = getDatabase();
  const existing = getResult(id);
  if (!existing) {
    throw new Error(`Result not found: ${id}`);
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.reasoning !== undefined) {
    sets.push("reasoning = ?");
    params.push(updates.reasoning);
  }
  if (updates.error !== undefined) {
    sets.push("error = ?");
    params.push(updates.error);
  }
  if (updates.stepsCompleted !== undefined) {
    sets.push("steps_completed = ?");
    params.push(updates.stepsCompleted);
  }
  if (updates.durationMs !== undefined) {
    sets.push("duration_ms = ?");
    params.push(updates.durationMs);
  }
  if (updates.tokensUsed !== undefined) {
    sets.push("tokens_used = ?");
    params.push(updates.tokensUsed);
  }
  if (updates.costCents !== undefined) {
    sets.push("cost_cents = ?");
    params.push(updates.costCents);
  }

  if (sets.length === 0) {
    return existing;
  }

  params.push(existing.id);
  db.query(`UPDATE results SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getResult(existing.id)!;
}

export function getResultsByRun(runId: string): Result[] {
  return listResults(runId);
}
