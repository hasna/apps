import { getDatabase, uuid, now } from "./database.js";
import type { CreateScheduleInput, UpdateScheduleInput, ScheduleFilter, Schedule, ScheduleRow } from "../types/index.js";
import { scheduleFromRow, ScheduleNotFoundError } from "../types/index.js";
import { resolvePartialId } from "./database.js";

export function createSchedule(input: CreateScheduleInput): Schedule {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO schedules (id, project_id, name, cron_expression, url, scenario_filter, model, headed, parallel, timeout_ms, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.name,
    input.cronExpression,
    input.url,
    JSON.stringify(input.scenarioFilter ?? {}),
    input.model ?? null,
    input.headed ? 1 : 0,
    input.parallel ?? 1,
    input.timeoutMs ?? null,
    timestamp,
    timestamp,
  );

  return getSchedule(id)!;
}

export function getSchedule(id: string): Schedule | null {
  const db = getDatabase();

  let row = db.query("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow | null;
  if (row) return scheduleFromRow(row);

  // Try partial ID resolution
  const fullId = resolvePartialId("schedules", id);
  if (fullId) {
    row = db.query("SELECT * FROM schedules WHERE id = ?").get(fullId) as ScheduleRow | null;
    if (row) return scheduleFromRow(row);
  }

  return null;
}

export function listSchedules(filter?: ScheduleFilter): Schedule[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }

  if (filter?.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }

  let sql = "SELECT * FROM schedules";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }
  if (filter?.offset) {
    sql += " OFFSET ?";
    params.push(filter.offset);
  }

  const rows = db.query(sql).all(...params) as ScheduleRow[];
  return rows.map(scheduleFromRow);
}

export function updateSchedule(id: string, input: UpdateScheduleInput): Schedule {
  const db = getDatabase();
  const existing = getSchedule(id);
  if (!existing) {
    throw new ScheduleNotFoundError(id);
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.cronExpression !== undefined) {
    sets.push("cron_expression = ?");
    params.push(input.cronExpression);
  }
  if (input.url !== undefined) {
    sets.push("url = ?");
    params.push(input.url);
  }
  if (input.scenarioFilter !== undefined) {
    sets.push("scenario_filter = ?");
    params.push(JSON.stringify(input.scenarioFilter));
  }
  if (input.model !== undefined) {
    sets.push("model = ?");
    params.push(input.model);
  }
  if (input.headed !== undefined) {
    sets.push("headed = ?");
    params.push(input.headed ? 1 : 0);
  }
  if (input.parallel !== undefined) {
    sets.push("parallel = ?");
    params.push(input.parallel);
  }
  if (input.timeoutMs !== undefined) {
    sets.push("timeout_ms = ?");
    params.push(input.timeoutMs);
  }
  if (input.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(input.enabled ? 1 : 0);
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push("updated_at = ?");
  params.push(now());

  params.push(existing.id);
  db.query(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getSchedule(existing.id)!;
}

export function deleteSchedule(id: string): boolean {
  const db = getDatabase();
  const schedule = getSchedule(id);
  if (!schedule) return false;

  const result = db.query("DELETE FROM schedules WHERE id = ?").run(schedule.id);
  return result.changes > 0;
}

export function getEnabledSchedules(): Schedule[] {
  const db = getDatabase();
  const rows = db.query("SELECT * FROM schedules WHERE enabled = 1 ORDER BY created_at DESC").all() as ScheduleRow[];
  return rows.map(scheduleFromRow);
}

export function updateLastRun(id: string, runId: string, nextRunAt: string): void {
  const db = getDatabase();
  const timestamp = now();

  db.query(`
    UPDATE schedules SET last_run_id = ?, last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?
  `).run(runId, timestamp, nextRunAt, timestamp, id);
}
