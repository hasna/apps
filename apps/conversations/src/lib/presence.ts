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

  db.prepare(`
    INSERT INTO agent_presence (agent, status, last_seen_at, metadata)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), ?)
    ON CONFLICT(agent) DO UPDATE SET
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      metadata = excluded.metadata
  `).run(agent, resolvedStatus, metadataJson);
}

export function getPresence(agent: string): AgentPresence | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agent_presence WHERE agent = ?").get(agent) as Record<string, unknown> | null;
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
  const result = db.prepare("DELETE FROM agent_presence WHERE agent = ?").run(agent);
  return result.changes > 0;
}
