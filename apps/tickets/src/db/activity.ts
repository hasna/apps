import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { Activity } from "../types/index.ts";

interface RawActivity {
  id: string;
  ticket_id: string;
  agent_id: string | null;
  action: string;
  from_value: string | null;
  to_value: string | null;
  is_ai_action: number;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  created_at: string;
}

function rowToActivity(row: RawActivity): Activity {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    agent_id: row.agent_id,
    action: row.action,
    from_value: row.from_value,
    to_value: row.to_value,
    is_ai_action: row.is_ai_action === 1,
    ai_confidence: row.ai_confidence,
    ai_reasoning: row.ai_reasoning,
    created_at: row.created_at,
  };
}

export interface AppendActivityOptions {
  ticket_id: string;
  action: string;
  agent_id?: string;
  from_value?: string;
  to_value?: string;
  is_ai_action?: boolean;
  ai_confidence?: number;
  ai_reasoning?: string;
}

export function appendActivity(options: AppendActivityOptions, db?: Database): Activity {
  const database = db ?? getDatabase();
  const id = uuid();
  const n = now();

  database.run(
    `INSERT INTO activity
       (id, ticket_id, agent_id, action, from_value, to_value, is_ai_action, ai_confidence, ai_reasoning, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, options.ticket_id, options.agent_id ?? null,
      options.action,
      options.from_value ?? null,
      options.to_value ?? null,
      options.is_ai_action ? 1 : 0,
      options.ai_confidence ?? null,
      options.ai_reasoning ?? null,
      n,
    ]
  );

  return {
    id, ticket_id: options.ticket_id, agent_id: options.agent_id ?? null,
    action: options.action, from_value: options.from_value ?? null,
    to_value: options.to_value ?? null, is_ai_action: options.is_ai_action ?? false,
    ai_confidence: options.ai_confidence ?? null, ai_reasoning: options.ai_reasoning ?? null,
    created_at: n,
  };
}

export function listActivity(
  ticketId: string,
  options: { page?: number; per_page?: number } = {},
  db?: Database
): { activity: Activity[]; total: number } {
  const database = db ?? getDatabase();
  const page = options.page ?? 1;
  const per_page = Math.min(options.per_page ?? 50, 200);
  const offset = (page - 1) * per_page;

  const countRow = database.query<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM activity WHERE ticket_id = ?"
  ).get(ticketId);

  const rows = database.query<RawActivity, [string]>(
    `SELECT * FROM activity WHERE ticket_id = ? ORDER BY created_at ASC LIMIT ${per_page} OFFSET ${offset}`
  ).all(ticketId);

  return { activity: rows.map(rowToActivity), total: countRow?.count ?? 0 };
}
