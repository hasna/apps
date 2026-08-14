import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export type SnapshotType = "interrupt" | "complete" | "handoff" | "checkpoint";

export interface ContextSnapshot {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  project_id: string | null;
  snapshot_type: SnapshotType;
  plan_summary: string | null;
  files_open: string[];
  attempts: string[];
  blockers: string[];
  next_steps: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface SnapshotRow {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  project_id: string | null;
  snapshot_type: string;
  plan_summary: string | null;
  files_open: string | null;
  attempts: string | null;
  blockers: string | null;
  next_steps: string | null;
  metadata: string | null;
  created_at: string;
}

function rowToSnapshot(row: SnapshotRow): ContextSnapshot {
  return {
    ...row,
    snapshot_type: row.snapshot_type as SnapshotType,
    files_open: JSON.parse(row.files_open || "[]"),
    attempts: JSON.parse(row.attempts || "[]"),
    blockers: JSON.parse(row.blockers || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface SaveSnapshotInput {
  agent_id?: string;
  task_id?: string;
  project_id?: string;
  snapshot_type: SnapshotType;
  plan_summary?: string;
  files_open?: string[];
  attempts?: string[];
  blockers?: string[];
  next_steps?: string;
  metadata?: Record<string, unknown>;
}

export function saveSnapshot(input: SaveSnapshotInput, db?: Database): ContextSnapshot {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO context_snapshots (id, agent_id, task_id, project_id, snapshot_type, plan_summary, files_open, attempts, blockers, next_steps, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.agent_id || null, input.task_id || null, input.project_id || null,
     input.snapshot_type, input.plan_summary || null,
     JSON.stringify(input.files_open || []), JSON.stringify(input.attempts || []),
     JSON.stringify(input.blockers || []), input.next_steps || null,
     JSON.stringify(input.metadata || {}), timestamp],
  );
  return {
    id, agent_id: input.agent_id || null, task_id: input.task_id || null,
    project_id: input.project_id || null, snapshot_type: input.snapshot_type,
    plan_summary: input.plan_summary || null, files_open: input.files_open || [],
    attempts: input.attempts || [], blockers: input.blockers || [],
    next_steps: input.next_steps || null, metadata: input.metadata || {},
    created_at: timestamp,
  };
}

export function getLatestSnapshot(agentId?: string, taskId?: string, db?: Database): ContextSnapshot | null {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: string[] = [];
  if (agentId) { conditions.push("agent_id = ?"); params.push(agentId); }
  if (taskId) { conditions.push("task_id = ?"); params.push(taskId); }
  if (conditions.length === 0) return null;
  const where = conditions.join(" AND ");
  const row = d.query(`SELECT * FROM context_snapshots WHERE ${where} ORDER BY created_at DESC LIMIT 1`).get(...params) as SnapshotRow | null;
  return row ? rowToSnapshot(row) : null;
}

export function listSnapshots(opts: { agent_id?: string; task_id?: string; project_id?: string; limit?: number }, db?: Database): ContextSnapshot[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];
  if (opts.agent_id) { conditions.push("agent_id = ?"); params.push(opts.agent_id); }
  if (opts.task_id) { conditions.push("task_id = ?"); params.push(opts.task_id); }
  if (opts.project_id) { conditions.push("project_id = ?"); params.push(opts.project_id); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit || 20;
  params.push(limit);
  return (d.query(`SELECT * FROM context_snapshots ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as SnapshotRow[]).map(rowToSnapshot);
}
