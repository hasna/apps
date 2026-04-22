/**
 * Cycles — time-boxed iteration periods (like Linear.app cycles).
 *
 * A cycle has a start/end date, a number, and a duration in weeks.
 * Tasks can be assigned to a cycle via the cycle_id column on tasks.
 */

import type { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Cycle {
  id: string;
  project_id: string | null;
  number: number;
  start_date: string;  // ISO date string
  end_date: string;    // ISO date string
  duration_weeks: number;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface CycleWithStats extends Cycle {
  task_count: number;
  completed_count: number;
  started_count: number;
  uncompleted_count: number;
}

export interface CreateCycleInput {
  project_id?: string;
  number?: number;
  start_date: string;
  duration_weeks?: number;
  status?: string;
}

export interface CycleUpdateInput {
  status?: string;
  start_date?: string;
  end_date?: string;
}

export interface CycleQueryOptions {
  project_id?: string;
  status?: string;
  limit?: number;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function createCycle(input: CreateCycleInput, db?: Database): Cycle {
  const d = db || getDatabase();
  const id = crypto.randomUUID();
  const project_id = input.project_id || null;
  const duration_weeks = input.duration_weeks ?? 1;

  // Calculate end_date from start_date + duration_weeks if not explicitly set
  const start = new Date(input.start_date);
  const end_date = new Date(start);
  end_date.setDate(end_date.getDate() + duration_weeks * 7);

  // Determine cycle number (auto-increment for project)
  const number = input.number ?? getNextCycleNumber(project_id, d);

  const stmt = d.prepare(`
    INSERT INTO cycles (id, project_id, number, start_date, end_date, duration_weeks, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, project_id, number, input.start_date, end_date.toISOString().split("T")[0], duration_weeks, input.status || "active");

  return getCycle(id, d)!;
}

function getNextCycleNumber(project_id: string | null, db: Database): number {
  if (!project_id) return 1;
  const row = db.query(
    "SELECT MAX(number) as max_num FROM cycles WHERE project_id = ?"
  ).get(project_id) as { max_num: number | null } | null;
  return (row?.max_num ?? 0) + 1;
}

export function getCycle(id: string, db?: Database): Cycle | null {
  const d = db || getDatabase();
  return d.query("SELECT * FROM cycles WHERE id = ?").get(id) as Cycle | null;
}

export function getCycleByNumber(project_id: string, number: number, db?: Database): Cycle | null {
  const d = db || getDatabase();
  return d.query(
    "SELECT * FROM cycles WHERE project_id = ? AND number = ?"
  ).get(project_id, number) as Cycle | null;
}

export function listCycles(options: CycleQueryOptions = {}, db?: Database): Cycle[] {
  const d = db || getDatabase();
  let sql = "SELECT * FROM cycles WHERE 1=1";
  const params: unknown[] = [];

  if (options.project_id) {
    sql += " AND project_id = ?";
    params.push(options.project_id);
  }
  if (options.status) {
    sql += " AND status = ?";
    params.push(options.status);
  }

  sql += " ORDER BY start_date DESC";
  if (options.limit) sql += " LIMIT ?";
  if (options.limit) params.push(options.limit);

  return d.prepare(sql).all(...params) as Cycle[];
}

export function updateCycle(id: string, input: CycleUpdateInput, db?: Database): Cycle | null {
  const d = db || getDatabase();
  const existing = getCycle(id, d);
  if (!existing) return null;

  const parts: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) { parts.push("status = ?"); params.push(input.status); }
  if (input.start_date !== undefined) { parts.push("start_date = ?"); params.push(input.start_date); }
  if (input.end_date !== undefined) { parts.push("end_date = ?"); params.push(input.end_date); }
  parts.push("updated_at = datetime('now')");
  params.push(id);

  d.prepare(`UPDATE cycles SET ${parts.join(", ")} WHERE id = ?`).run(...params);
  return getCycle(id, d);
}

export function deleteCycle(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.prepare("DELETE FROM cycles WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Auto-generation ─────────────────────────────────────────────────────────

/**
 * Generate a sequence of cycles starting from a given date.
 * Creates `count` cycles with the specified duration_weeks.
 */
export function generateCycles(
  project_id: string,
  options: { start_date: string; count: number; duration_weeks?: number },
  db?: Database,
): Cycle[] {
  const d = db || getDatabase();
  const duration_weeks = options.duration_weeks ?? 1;
  const cycles: Cycle[] = [];

  let startDate = new Date(options.start_date);
  for (let i = 0; i < options.count; i++) {
    const cycle = createCycle({
      project_id,
      start_date: startDate.toISOString().split("T")[0],
      duration_weeks,
    }, d);
    cycles.push(cycle);
    startDate.setDate(startDate.getDate() + duration_weeks * 7);
  }

  return cycles;
}

// ── Active/current cycle helpers ────────────────────────────────────────────

/**
 * Get the currently active cycle for a project (today falls within start/end).
 */
export function getCurrentCycle(project_id: string, db?: Database): Cycle | null {
  const d = db || getDatabase();
  const today = new Date().toISOString().split("T")[0];
  return d.query(
    "SELECT * FROM cycles WHERE project_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ? ORDER BY number DESC LIMIT 1"
  ).get(project_id, today, today) as Cycle | null;
}

/**
 * Get the next upcoming cycle (start_date is in the future).
 */
export function getNextCycle(project_id: string, db?: Database): Cycle | null {
  const d = db || getDatabase();
  const today = new Date().toISOString().split("T")[0];
  return d.query(
    "SELECT * FROM cycles WHERE project_id = ? AND start_date > ? ORDER BY number ASC LIMIT 1"
  ).get(project_id, today) as Cycle | null;
}

/**
 * Get cycle statistics (task counts by state).
 */
export function getCycleStats(cycle_id: string, db?: Database): {
  task_count: number;
  completed_count: number;
  started_count: number;
  uncompleted_count: number;
} | null {
  const d = db || getDatabase();
  const row = d.query(`
    SELECT
      COUNT(*) as task_count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_count,
      COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) as started_count,
      COALESCE(SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END), 0) as uncompleted_count
    FROM tasks WHERE cycle_id = ?
  `).get(cycle_id) as { task_count: number; completed_count: number; started_count: number; uncompleted_count: number } | null;

  return row ?? null;
}

/**
 * List all cycles with their task stats for a project.
 */
export function listCyclesWithStats(options: CycleQueryOptions = {}, db?: Database): CycleWithStats[] {
  const cycles = listCycles(options, db);
  return cycles.map(cycle => {
    const stats = getCycleStats(cycle.id, db);
    return {
      ...cycle,
      task_count: stats?.task_count ?? 0,
      completed_count: stats?.completed_count ?? 0,
      started_count: stats?.started_count ?? 0,
      uncompleted_count: stats?.uncompleted_count ?? 0,
    };
  });
}
