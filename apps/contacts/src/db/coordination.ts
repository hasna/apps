import { Database } from "bun:sqlite";
import { getDatabase, uuid, now } from "./database.js";

export interface ContactLock {
  id: string;
  contact_id: string;
  agent_name: string;
  reason?: string | null;
  acquired_at: string;
  expires_at: string;
  session_id?: string | null;
}

export interface AgentActivity {
  id: string;
  contact_id: string;
  agent_name: string;
  action: string;
  details?: string | null;
  session_id?: string | null;
  created_at: string;
}

export function acquireLock(
  contactId: string,
  agentName: string,
  ttlSeconds = 300,
  reason?: string,
  sessionId?: string,
  db?: Database,
): { acquired: boolean; lock?: ContactLock; held_by?: string } {
  const _db = db || getDatabase();
  cleanExpiredLocks(_db);
  const existing = _db
    .query(`SELECT * FROM contact_locks WHERE contact_id=?`)
    .get(contactId) as ContactLock | null;
  if (existing) return { acquired: false, held_by: existing.agent_name, lock: existing };
  const id = uuid();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  _db
    .query(
      `INSERT INTO contact_locks(id,contact_id,agent_name,reason,acquired_at,expires_at,session_id) VALUES(?,?,?,?,?,?,?)`,
    )
    .run(id, contactId, agentName, reason || null, now(), expiresAt, sessionId || null);
  return {
    acquired: true,
    lock: _db.query(`SELECT * FROM contact_locks WHERE id=?`).get(id) as ContactLock,
  };
}

export function releaseLock(contactId: string, agentName: string, db?: Database): boolean {
  const _db = db || getDatabase();
  const result = _db
    .query(`DELETE FROM contact_locks WHERE contact_id=? AND agent_name=?`)
    .run(contactId, agentName);
  return ((result as { changes?: number }).changes || 0) > 0;
}

export function checkLock(contactId: string, db?: Database): ContactLock | null {
  const _db = db || getDatabase();
  cleanExpiredLocks(_db);
  return _db
    .query(`SELECT * FROM contact_locks WHERE contact_id=?`)
    .get(contactId) as ContactLock | null;
}

export function cleanExpiredLocks(db?: Database): void {
  const _db = db || getDatabase();
  _db.query(`DELETE FROM contact_locks WHERE expires_at<?`).run(now());
}

export function logAgentActivity(
  contactId: string,
  agentName: string,
  action: string,
  details?: string,
  sessionId?: string,
  db?: Database,
): void {
  const _db = db || getDatabase();
  _db
    .query(
      `INSERT INTO contact_agent_activity(id,contact_id,agent_name,action,details,session_id,created_at) VALUES(?,?,?,?,?,?,?)`,
    )
    .run(uuid(), contactId, agentName, action, details || null, sessionId || null, now());
}

export function getAgentActivity(
  contactId: string,
  limit = 20,
  db?: Database,
): AgentActivity[] {
  const _db = db || getDatabase();
  return _db
    .query(
      `SELECT * FROM contact_agent_activity WHERE contact_id=? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(contactId, limit) as AgentActivity[];
}
