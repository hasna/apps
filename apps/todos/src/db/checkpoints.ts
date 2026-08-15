import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface Checkpoint {
  id: string;
  task_id: string;
  agent_id: string | null;
  step: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  data: Record<string, unknown>;
  error: string | null;
  attempt: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Heartbeat {
  id: string;
  task_id: string;
  agent_id: string | null;
  step: string | null;
  message: string | null;
  progress: number | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export function upsertCheckpoint(
  task_id: string,
  step: string,
  updates: {
    agent_id?: string;
    status?: Checkpoint["status"];
    data?: Record<string, unknown>;
    error?: string | null;
    attempt?: number;
    max_attempts?: number;
    started_at?: string | null;
    completed_at?: string | null;
  },
  db?: Database,
): Checkpoint {
  const d = db || getDatabase();
  const timestamp = now();

  // Find existing checkpoint
  const existing = d.query(
    "SELECT id FROM task_checkpoints WHERE task_id = ? AND step = ?",
  ).get(task_id, step) as { id: string } | undefined;

  const id = existing?.id ?? uuid();
  const agentId = updates.agent_id ?? null;
  const status = updates.status ?? "pending";
  const data = updates.data ? JSON.stringify(updates.data) : JSON.stringify({});
  const error = updates.error ?? null;
  const attempt = updates.attempt ?? 1;
  const maxAttempts = updates.max_attempts ?? 1;
  const startedAt = updates.started_at ?? null;
  const completedAt = updates.completed_at ?? null;

  d.run(
    `INSERT INTO task_checkpoints (id, task_id, agent_id, step, status, data, error, attempt, max_attempts, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=?, data=?, error=?, attempt=?, max_attempts=?, started_at=COALESCE(started_at,?), completed_at=?, updated_at=?`,
    [
      id, task_id, agentId, step, status, data, error, attempt, maxAttempts, startedAt, completedAt, timestamp,
      status, data, error, attempt, maxAttempts, startedAt, completedAt, timestamp,
    ],
  );

  return rowToCheckpoint(d.query("SELECT * FROM task_checkpoints WHERE id = ?").get(id))!;
}

export function getCheckpoint(taskId: string, step: string, db?: Database): Checkpoint | null {
  const d = db || getDatabase();
  const row = d.query(
    "SELECT * FROM task_checkpoints WHERE task_id = ? AND step = ?",
  ).get(taskId, step);
  return row ? rowToCheckpoint(row) : null;
}

export function getTaskCheckpoints(taskId: string, db?: Database): Checkpoint[] {
  const d = db || getDatabase();
  return d.query(
    "SELECT * FROM task_checkpoints WHERE task_id = ? ORDER BY created_at ASC",
  ).all(taskId).map(rowToCheckpoint);
}

export function getTaskHeartbeats(taskId: string, limit = 20, db?: Database): Heartbeat[] {
  const d = db || getDatabase();
  return d.query(
    "SELECT * FROM task_heartbeats WHERE task_id = ? ORDER BY created_at DESC LIMIT ?",
  ).all(taskId, limit).map(rowToHeartbeat);
}

export function emitHeartbeat(
  task_id: string,
  opts?: { agent_id?: string; step?: string; message?: string; progress?: number; meta?: Record<string, unknown> },
  db?: Database,
): Heartbeat {
  const d = db || getDatabase();
  const id = uuid();
  const agentId = opts?.agent_id ?? null;
  const step = opts?.step ?? null;
  const message = opts?.message ?? null;
  const progress = opts?.progress ?? null;
  const meta = opts?.meta ? JSON.stringify(opts.meta) : JSON.stringify({});

  d.run(
    "INSERT INTO task_heartbeats (id, task_id, agent_id, step, message, progress, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, task_id, agentId, step, message, progress, meta, now()],
  );

  return rowToHeartbeat(d.query("SELECT * FROM task_heartbeats WHERE id = ?").get(id))!;
}

export function getLastHeartbeat(taskId: string, db?: Database): Heartbeat | null {
  const d = db || getDatabase();
  const row = d.query(
    "SELECT * FROM task_heartbeats WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
  ).get(taskId);
  return row ? rowToHeartbeat(row) : null;
}

export function getTaskProgress(taskId: string, db?: Database): {
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  pending_steps: number;
  last_heartbeat?: Heartbeat | null;
} {
  const d = db || getDatabase();
  const total = d.query(
    "SELECT COUNT(*) as count FROM task_checkpoints WHERE task_id = ?",
  ).get(taskId) as { count: number };
  const completed = d.query(
    "SELECT COUNT(*) as count FROM task_checkpoints WHERE task_id = ? AND status = 'completed'",
  ).get(taskId) as { count: number };
  const failed = d.query(
    "SELECT COUNT(*) as count FROM task_checkpoints WHERE task_id = ? AND status = 'failed'",
  ).get(taskId) as { count: number };
  const pending = d.query(
    "SELECT COUNT(*) as count FROM task_checkpoints WHERE task_id = ? AND status = 'pending'",
  ).get(taskId) as { count: number };
  const lastHb = getLastHeartbeat(taskId, d);

  return {
    total_steps: total.count,
    completed_steps: completed.count,
    failed_steps: failed.count,
    pending_steps: pending.count,
    last_heartbeat: lastHb,
  };
}

function rowToCheckpoint(row: any): Checkpoint {
  if (!row) return null as any;
  return {
    ...row,
    data: JSON.parse(row.data || "{}"),
    status: row.status as Checkpoint["status"],
    agent_id: row.agent_id || null,
    error: row.error || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
  };
}

function rowToHeartbeat(row: any): Heartbeat {
  if (!row) return null as any;
  return {
    ...row,
    agent_id: row.agent_id || null,
    step: row.step || null,
    message: row.message || null,
    progress: row.progress ?? null,
    meta: JSON.parse(row.meta || "{}"),
  };
}
