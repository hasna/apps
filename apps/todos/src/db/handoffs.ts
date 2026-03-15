import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface Handoff {
  id: string;
  agent_id: string | null;
  project_id: string | null;
  summary: string;
  completed: string[] | null;
  in_progress: string[] | null;
  blockers: string[] | null;
  next_steps: string[] | null;
  created_at: string;
}

export interface CreateHandoffInput {
  agent_id?: string;
  project_id?: string;
  summary: string;
  completed?: string[];
  in_progress?: string[];
  blockers?: string[];
  next_steps?: string[];
}

export function createHandoff(input: CreateHandoffInput, db?: Database): Handoff {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO handoffs (id, agent_id, project_id, summary, completed, in_progress, blockers, next_steps, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agent_id || null,
      input.project_id || null,
      input.summary,
      input.completed ? JSON.stringify(input.completed) : null,
      input.in_progress ? JSON.stringify(input.in_progress) : null,
      input.blockers ? JSON.stringify(input.blockers) : null,
      input.next_steps ? JSON.stringify(input.next_steps) : null,
      timestamp,
    ],
  );
  return {
    id, agent_id: input.agent_id || null, project_id: input.project_id || null,
    summary: input.summary,
    completed: input.completed || null, in_progress: input.in_progress || null,
    blockers: input.blockers || null, next_steps: input.next_steps || null,
    created_at: timestamp,
  };
}

function rowToHandoff(row: any): Handoff {
  return {
    ...row,
    completed: row.completed ? JSON.parse(row.completed) : null,
    in_progress: row.in_progress ? JSON.parse(row.in_progress) : null,
    blockers: row.blockers ? JSON.parse(row.blockers) : null,
    next_steps: row.next_steps ? JSON.parse(row.next_steps) : null,
  };
}

export function listHandoffs(projectId?: string, limit = 10, db?: Database): Handoff[] {
  const d = db || getDatabase();
  if (projectId) {
    return (d.query("SELECT * FROM handoffs WHERE project_id = ? ORDER BY rowid DESC LIMIT ?").all(projectId, limit) as any[]).map(rowToHandoff);
  }
  return (d.query("SELECT * FROM handoffs ORDER BY rowid DESC LIMIT ?").all(limit) as any[]).map(rowToHandoff);
}

export function getLatestHandoff(agentId?: string, projectId?: string, db?: Database): Handoff | null {
  const d = db || getDatabase();
  let query = "SELECT * FROM handoffs WHERE 1=1";
  const params: any[] = [];
  if (agentId) { query += " AND agent_id = ?"; params.push(agentId); }
  if (projectId) { query += " AND project_id = ?"; params.push(projectId); }
  query += " ORDER BY rowid DESC LIMIT 1";
  const row = d.query(query).get(...params) as any;
  return row ? rowToHandoff(row) : null;
}
