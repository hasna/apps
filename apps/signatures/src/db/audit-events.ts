import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { AuditEvent, AuditEventType, SignerType } from "../types/index.js";

function rowToAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string | undefined,
    session_id: row["session_id"] as string | undefined,
    event_type: row["event_type"] as AuditEventType,
    message: row["message"] as string | undefined,
    actor_name: row["actor_name"] as string | undefined,
    actor_email: row["actor_email"] as string | undefined,
    actor_signer_type: row["actor_signer_type"] as SignerType | undefined,
    actor_agent_id: row["actor_agent_id"] as string | undefined,
    metadata: row["metadata"]
      ? (JSON.parse(row["metadata"] as string) as Record<string, unknown>)
      : undefined,
    created_at: row["created_at"] as string,
  };
}

export function createAuditEvent(data: {
  document_id?: string;
  session_id?: string;
  event_type: AuditEventType;
  message?: string;
  actor_name?: string;
  actor_email?: string;
  actor_signer_type?: SignerType;
  actor_agent_id?: string;
  metadata?: Record<string, unknown>;
}): AuditEvent {
  const db = getDatabase();
  const id = `evt-${nanoid(10)}`;
  db.query(
    `INSERT INTO audit_events (id, document_id, session_id, event_type, message, actor_name, actor_email, actor_signer_type, actor_agent_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id ?? null,
    data.session_id ?? null,
    data.event_type,
    data.message ?? null,
    data.actor_name ?? null,
    data.actor_email ?? null,
    data.actor_signer_type ?? null,
    data.actor_agent_id ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null
  );
  return getAuditEvent(id);
}

export function getAuditEvent(id: string): AuditEvent {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>("SELECT * FROM audit_events WHERE id = ?")
    .get(id);
  if (!row) throw new Error(`Audit event not found: ${id}`);
  return rowToAuditEvent(row);
}

export function listAuditEvents(filters?: {
  document_id?: string;
  session_id?: string;
  limit?: number;
  offset?: number;
}): AuditEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters?.document_id) {
    conditions.push("document_id = ?");
    values.push(filters.document_id);
  }
  if (filters?.session_id) {
    conditions.push("session_id = ?");
    values.push(filters.session_id);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(filters?.limit ?? 100, filters?.offset ?? 0);
  const rows = db
    .query<Record<string, unknown>, unknown[]>(
      `SELECT * FROM audit_events ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`
    )
    .all(...values);
  return rows.map(rowToAuditEvent);
}
