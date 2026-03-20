import type { Database } from "bun:sqlite";
import type { TaskHistory } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function logTaskChange(
  taskId: string,
  action: string,
  field?: string,
  oldValue?: string | null,
  newValue?: string | null,
  agentId?: string | null,
  db?: Database,
): TaskHistory {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO task_history (id, task_id, action, field, old_value, new_value, agent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, taskId, action, field || null, oldValue ?? null, newValue ?? null, agentId || null, timestamp],
  );
  return { id, task_id: taskId, action, field: field || null, old_value: oldValue ?? null, new_value: newValue ?? null, agent_id: agentId || null, created_at: timestamp };
}

export function getTaskHistory(taskId: string, db?: Database): TaskHistory[] {
  const d = db || getDatabase();
  return d.query("SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as TaskHistory[];
}

export function getRecentActivity(limit = 50, db?: Database): TaskHistory[] {
  const d = db || getDatabase();
  return d.query("SELECT * FROM task_history ORDER BY created_at DESC LIMIT ?").all(limit) as TaskHistory[];
}

export interface RecapSummary {
  hours: number;
  since: string;
  completed: { id: string; short_id: string | null; title: string; assigned_to: string | null; completed_at: string | null; duration_minutes: number | null }[];
  created: { id: string; short_id: string | null; title: string; agent_id: string | null; created_at: string }[];
  in_progress: { id: string; short_id: string | null; title: string; assigned_to: string | null; started_at: string | null }[];
  blocked: { id: string; short_id: string | null; title: string; assigned_to: string | null }[];
  stale: { id: string; short_id: string | null; title: string; assigned_to: string | null; updated_at: string }[];
  agents: { name: string; completed_count: number; in_progress_count: number; last_seen_at: string }[];
}

export function getRecap(hours = 8, projectId?: string, db?: Database): RecapSummary {
  const d = db || getDatabase();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const staleWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const pf = projectId ? " AND project_id = ?" : "";
  const tpf = projectId ? " AND t.project_id = ?" : "";

  const completed = (projectId
    ? d.query(`SELECT id, short_id, title, assigned_to, completed_at, started_at FROM tasks WHERE status = 'completed' AND completed_at > ?${pf} ORDER BY completed_at DESC`).all(since, projectId)
    : d.query(`SELECT id, short_id, title, assigned_to, completed_at, started_at FROM tasks WHERE status = 'completed' AND completed_at > ? ORDER BY completed_at DESC`).all(since)
  ) as any[];

  const created = (projectId
    ? d.query(`SELECT id, short_id, title, agent_id, created_at FROM tasks WHERE created_at > ?${pf} ORDER BY created_at DESC`).all(since, projectId)
    : d.query(`SELECT id, short_id, title, agent_id, created_at FROM tasks WHERE created_at > ? ORDER BY created_at DESC`).all(since)
  ) as any[];

  const in_progress = (projectId
    ? d.query(`SELECT id, short_id, title, assigned_to, started_at FROM tasks WHERE status = 'in_progress' AND project_id = ? ORDER BY updated_at DESC`).all(projectId)
    : d.query(`SELECT id, short_id, title, assigned_to, started_at FROM tasks WHERE status = 'in_progress' ORDER BY updated_at DESC`).all()
  ) as any[];

  const blocked = (projectId
    ? d.query(`SELECT DISTINCT t.id, t.short_id, t.title, t.assigned_to FROM tasks t JOIN task_dependencies td ON td.task_id = t.id JOIN tasks dep ON dep.id = td.depends_on AND dep.status NOT IN ('completed','cancelled') WHERE t.status = 'pending'${tpf}`).all(projectId)
    : d.query(`SELECT DISTINCT t.id, t.short_id, t.title, t.assigned_to FROM tasks t JOIN task_dependencies td ON td.task_id = t.id JOIN tasks dep ON dep.id = td.depends_on AND dep.status NOT IN ('completed','cancelled') WHERE t.status = 'pending'`).all()
  ) as any[];

  const stale = (projectId
    ? d.query(`SELECT id, short_id, title, assigned_to, updated_at FROM tasks WHERE status = 'in_progress' AND updated_at < ? AND project_id = ? ORDER BY updated_at ASC`).all(staleWindow, projectId)
    : d.query(`SELECT id, short_id, title, assigned_to, updated_at FROM tasks WHERE status = 'in_progress' AND updated_at < ? ORDER BY updated_at ASC`).all(staleWindow)
  ) as any[];

  const agents = (projectId
    ? d.query(`SELECT a.name, a.last_seen_at, (SELECT COUNT(*) FROM tasks t WHERE (t.assigned_to = a.id OR t.agent_id = a.id) AND t.status = 'completed' AND t.completed_at > ?${tpf}) as completed_count, (SELECT COUNT(*) FROM tasks t WHERE (t.assigned_to = a.id OR t.agent_id = a.id) AND t.status = 'in_progress'${tpf}) as in_progress_count FROM agents a WHERE a.status = 'active' AND a.last_seen_at > ? ORDER BY completed_count DESC`).all(since, projectId, projectId, since)
    : d.query(`SELECT a.name, a.last_seen_at, (SELECT COUNT(*) FROM tasks t WHERE (t.assigned_to = a.id OR t.agent_id = a.id) AND t.status = 'completed' AND t.completed_at > ?) as completed_count, (SELECT COUNT(*) FROM tasks t WHERE (t.assigned_to = a.id OR t.agent_id = a.id) AND t.status = 'in_progress') as in_progress_count FROM agents a WHERE a.status = 'active' AND a.last_seen_at > ? ORDER BY completed_count DESC`).all(since, since)
  ) as any[];

  return {
    hours,
    since,
    completed: completed.map(r => ({
      ...r,
      duration_minutes: r.started_at && r.completed_at
        ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 60000)
        : null,
    })),
    created,
    in_progress,
    blocked,
    stale,
    agents,
  };
}
