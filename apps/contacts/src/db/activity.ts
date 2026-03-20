import type { Database } from "bun:sqlite";
import type { ActivityLog, ActivityRow, CreateActivityInput } from "../types/index.js";
import { getDatabase, uuid } from "./database.js";

function rowToActivity(row: ActivityRow): ActivityLog {
  return { ...row };
}

export function logActivity(db: Database, input: CreateActivityInput): ActivityLog {
  const id = uuid();
  db.run(
    `INSERT INTO activity_log (id, contact_id, company_id, action, details) VALUES (?, ?, ?, ?, ?)`,
    [id, input.contact_id ?? null, input.company_id ?? null, input.action, input.details ?? null]
  );
  return db.query(`SELECT * FROM activity_log WHERE id = ?`).get(id) as ActivityLog;
}

export interface ListActivityOptions {
  contact_id?: string;
  company_id?: string;
  limit?: number;
  offset?: number;
}

export function listActivity(opts: ListActivityOptions = {}, db?: Database): { entries: ActivityLog[]; total: number } {
  const d = db || getDatabase();
  const { limit = 50, offset = 0, contact_id, company_id } = opts;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (contact_id) { conditions.push("contact_id = ?"); params.push(contact_id); }
  if (company_id) { conditions.push("company_id = ?"); params.push(company_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = d.query(`SELECT COUNT(*) as total FROM activity_log ${where}`).get(...params) as { total: number };
  const rows = d.query(`SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as ActivityRow[];

  return { entries: rows.map(rowToActivity), total: totalRow.total };
}

export function getActivity(id: string, db?: Database): ActivityLog | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM activity_log WHERE id = ?`).get(id) as ActivityRow | null;
  return row ? rowToActivity(row) : null;
}
