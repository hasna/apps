import { getDb } from "./db.js";
import type { AgentPresence, AgentConflictError, RegisterAgentResult } from "../types.js";

const ONLINE_THRESHOLD_SECONDS = 60;
const CONFLICT_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

function parsePresence(row: Record<string, unknown>): AgentPresence {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata as string);
    } catch {
      metadata = null;
    }
  }

  const lastSeenAt = row.last_seen_at as string;
  const lastSeenMs = new Date(lastSeenAt + "Z").getTime();
  const nowMs = Date.now();
  const online = (nowMs - lastSeenMs) < ONLINE_THRESHOLD_SECONDS * 1000;

  return {
    id: (row.id as string) || "",
    agent: row.agent as string,
    session_id: (row.session_id as string | null) ?? null,
    role: (row.role as string) || "agent",
    status: row.status as string,
    last_seen_at: lastSeenAt,
    created_at: (row.created_at as string) || lastSeenAt,
    online,
    metadata,
  };
}

function isActiveSession(lastSeenAt: string): boolean {
  const lastSeenMs = new Date(lastSeenAt + "Z").getTime();
  const nowMs = Date.now();
  return (nowMs - lastSeenMs) < CONFLICT_THRESHOLD_SECONDS * 1000;
}

export function registerAgent(
  name: string,
  sessionId: string,
  role?: string
): RegisterAgentResult | AgentConflictError {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM agent_presence WHERE agent = ?").get(name) as Record<string, unknown> | null;

  if (existing) {
    const lastSeenAt = existing.last_seen_at as string;
    const existingSessionId = existing.session_id as string | null;

    // Active session with a different session_id — conflict
    if (isActiveSession(lastSeenAt) && existingSessionId && existingSessionId !== sessionId) {
      return {
        error: "agent_conflict",
        message: `Agent "${name}" is already active (last seen: ${lastSeenAt}). Wait 30 minutes or use force takeover.`,
        existing_session_id: existingSessionId,
        last_seen_at: lastSeenAt,
      };
    }

    // Stale or same session — takeover/update
    const tookOver = existingSessionId !== sessionId;
    db.prepare(`
      UPDATE agent_presence
      SET session_id = ?, role = ?, last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
      WHERE agent = ?
    `).run(sessionId, role || (existing.role as string) || "agent", name);

    const updated = db.prepare("SELECT * FROM agent_presence WHERE agent = ?").get(name) as Record<string, unknown>;
    return { agent: parsePresence(updated), created: false, took_over: tookOver };
  }

  // New agent
  const id = crypto.randomUUID().slice(0, 8);
  const resolvedRole = role || "agent";
  db.prepare(`
    INSERT INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  `).run(id, name, sessionId, resolvedRole);

  const created = db.prepare("SELECT * FROM agent_presence WHERE agent = ?").get(name) as Record<string, unknown>;
  return { agent: parsePresence(created), created: true, took_over: false };
}

export function heartbeat(agent: string, status?: string, metadata?: Record<string, unknown>, sessionId?: string): void {
  const db = getDb();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const resolvedStatus = status || "online";
  const normalizedAgent = agent.trim().toLowerCase();

  // Ensure id exists for agents registered before the migration
  const existing = db.prepare("SELECT id FROM agent_presence WHERE agent = ?").get(agent) as { id: string } | null;
  const id = existing?.id || crypto.randomUUID().slice(0, 8);

  db.prepare(`
    INSERT INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at, metadata)
    VALUES (?, ?, ?, 'agent', ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'), ?)
    ON CONFLICT(agent) DO UPDATE SET
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      session_id = COALESCE(excluded.session_id, agent_presence.session_id),
      metadata = excluded.metadata
  `).run(id, normalizedAgent, sessionId ?? null, resolvedStatus, metadataJson);
}

export function getPresence(agent: string): AgentPresence | null {
  const db = getDb();
  const normalizedAgent = agent.trim().toLowerCase();
  const row = db.prepare("SELECT * FROM agent_presence WHERE LOWER(agent) = ?").get(normalizedAgent) as Record<string, unknown> | null;
  return row ? parsePresence(row) : null;
}

export function listAgents(opts?: { online_only?: boolean }): AgentPresence[] {
  const db = getDb();

  let query = "SELECT * FROM agent_presence";

  if (opts?.online_only) {
    query += " WHERE last_seen_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-60 seconds')";
  }

  query += " ORDER BY last_seen_at DESC";

  const rows = db.prepare(query).all() as Record<string, unknown>[];
  return rows.map(parsePresence);
}

export function removePresence(agent: string): boolean {
  const db = getDb();
  const normalizedAgent = agent.trim().toLowerCase();
  const result = db.prepare("DELETE FROM agent_presence WHERE LOWER(agent) = ?").run(normalizedAgent);
  return result.changes > 0;
}

export function renameAgent(oldName: string, newName: string): boolean {
  const db = getDb();
  const normalizedOld = oldName.trim().toLowerCase();
  const normalizedNew = newName.trim().toLowerCase();

  const existing = db.prepare("SELECT agent FROM agent_presence WHERE LOWER(agent) = ?").get(normalizedOld);
  if (!existing) return false;

  const conflict = db.prepare("SELECT agent FROM agent_presence WHERE LOWER(agent) = ?").get(normalizedNew);
  if (conflict) throw new Error(`Agent "${normalizedNew}" already exists`);

  db.prepare("UPDATE agent_presence SET agent = ? WHERE LOWER(agent) = ?").run(normalizedNew, normalizedOld);
  return true;
}
