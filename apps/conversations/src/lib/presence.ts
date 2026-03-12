import { getDb } from "./db.js";
import type { AgentPresence } from "../types.js";

const ONLINE_THRESHOLD_SECONDS = 60;

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
    agent: row.agent as string,
    status: row.status as string,
    last_seen_at: lastSeenAt,
    online,
    metadata,
  };
}

export function heartbeat(agent: string, status?: string, metadata?: Record<string, unknown>): void {
  const db = getDb();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const resolvedStatus = status || "online";
  const normalizedAgent = agent.trim().toLowerCase();

  db.prepare(`
    INSERT INTO agent_presence (agent, status, last_seen_at, metadata)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), ?)
    ON CONFLICT(agent) DO UPDATE SET
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      metadata = excluded.metadata
  `).run(normalizedAgent, resolvedStatus, metadataJson);
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
  const params: string[] = [];

  if (opts?.online_only) {
    query += " WHERE last_seen_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-60 seconds')";
  }

  query += " ORDER BY last_seen_at DESC";

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
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
