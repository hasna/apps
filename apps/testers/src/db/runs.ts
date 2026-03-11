import {
  type Run,
  type RunRow,
  type CreateRunInput,
  type RunFilter,
  runFromRow,
} from "../types/index.js";
import { getDatabase, now, uuid, resolvePartialId } from "./database.js";

export function createRun(input: CreateRunInput & { model: string }): Run {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO runs (id, project_id, status, url, model, headed, parallel, total, passed, failed, started_at, finished_at, metadata)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, 0, 0, 0, ?, NULL, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.url,
    input.model,
    input.headed ? 1 : 0,
    input.parallel ?? 1,
    timestamp,
    input.model ? JSON.stringify({}) : null,
  );

  return getRun(id)!;
}

export function getRun(id: string): Run | null {
  const db = getDatabase();

  let row = db.query("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | null;
  if (row) return runFromRow(row);

  // Try partial ID resolution
  const fullId = resolvePartialId("runs", id);
  if (fullId) {
    row = db.query("SELECT * FROM runs WHERE id = ?").get(fullId) as RunRow | null;
    if (row) return runFromRow(row);
  }

  return null;
}

export function listRuns(filter?: RunFilter): Run[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }

  if (filter?.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }

  let sql = "SELECT * FROM runs";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY started_at DESC";

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }
  if (filter?.offset) {
    sql += " OFFSET ?";
    params.push(filter.offset);
  }

  const rows = db.query(sql).all(...params) as RunRow[];
  return rows.map(runFromRow);
}

export function updateRun(id: string, updates: Partial<RunRow>): Run {
  const db = getDatabase();
  const existing = getRun(id);
  if (!existing) {
    throw new Error(`Run not found: ${id}`);
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (updates.url !== undefined) {
    sets.push("url = ?");
    params.push(updates.url);
  }
  if (updates.model !== undefined) {
    sets.push("model = ?");
    params.push(updates.model);
  }
  if (updates.headed !== undefined) {
    sets.push("headed = ?");
    params.push(updates.headed);
  }
  if (updates.parallel !== undefined) {
    sets.push("parallel = ?");
    params.push(updates.parallel);
  }
  if (updates.total !== undefined) {
    sets.push("total = ?");
    params.push(updates.total);
  }
  if (updates.passed !== undefined) {
    sets.push("passed = ?");
    params.push(updates.passed);
  }
  if (updates.failed !== undefined) {
    sets.push("failed = ?");
    params.push(updates.failed);
  }
  if (updates.started_at !== undefined) {
    sets.push("started_at = ?");
    params.push(updates.started_at);
  }
  if (updates.finished_at !== undefined) {
    sets.push("finished_at = ?");
    params.push(updates.finished_at);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(updates.metadata);
  }

  if (sets.length === 0) {
    return existing;
  }

  params.push(existing.id);
  db.query(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getRun(existing.id)!;
}

export function deleteRun(id: string): boolean {
  const db = getDatabase();
  const run = getRun(id);
  if (!run) return false;

  const result = db.query("DELETE FROM runs WHERE id = ?").run(run.id);
  return result.changes > 0;
}
