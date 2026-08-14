import { getDb } from "./db.js";

const ONLINE_THRESHOLD_SECONDS = 60;
const CONFLICT_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

interface AgentPresence {
  id: string;
  agent: string;
  session_id: string | null;
  role: string;
  project_id: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
  online: boolean;
  metadata: Record<string, unknown> | null;
}

function parsePresence(row: Record<string, unknown>): AgentPresence {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try { metadata = JSON.parse(row.metadata as string); } catch { metadata = null; }
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
    project_id: (row.project_id as string | null) ?? null,
    status: row.status as string,
    last_seen_at: lastSeenAt,
    created_at: (row.created_at as string) || lastSeenAt,
    online,
    metadata,
  };
}

function isActiveSession(lastSeenAt: string): boolean {
  const lastSeenMs = new Date(lastSeenAt + "Z").getTime();
  return (Date.now() - lastSeenMs) < CONFLICT_THRESHOLD_SECONDS * 1000;
}

export function registerAgent(
  name: string,
  sessionId: string,
  role?: string,
  projectId?: string
): Record<string, unknown> {
  const db = getDb();
  const normalizedName = name.trim().toLowerCase();

  const existing = db.prepare("SELECT * FROM agent_presence WHERE agent = ?").get(normalizedName) as Record<string, unknown> | null;

  if (existing) {
    const lastSeenAt = existing.last_seen_at as string;
    const existingSessionId = existing.session_id as string | null;

    if (isActiveSession(lastSeenAt) && existingSessionId && existingSessionId !== sessionId) {
      return {
        conflict: true,
        error: "agent_conflict",
        message: `Agent "${normalizedName}" is already active (last seen: ${lastSeenAt}).`,
        existing_session_id: existingSessionId,
        last_seen_at: lastSeenAt,
      };
    }

    const tookOver = existingSessionId !== sessionId;
    db.prepare(`
      UPDATE agent_presence
      SET session_id = ?, role = ?, project_id = ?, last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
      WHERE agent = ?
    `).run(sessionId, role || (existing.role as string) || "agent", projectId ?? (existing.project_id as string | null) ?? null, normalizedName);

    const updated = db.prepare("SELECT * FROM agent_presence WHERE agent = ?").get(normalizedName) as Record<string, unknown>;
    return { agent: parsePresence(updated), created: false, took_over: tookOver };
  }

  const id = crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  `).run(id, normalizedName, sessionId, role || "agent", projectId ?? null);

  const created = db.prepare("SELECT * FROM agent_presence WHERE agent = ?").get(normalizedName) as Record<string, unknown>;
  return { agent: parsePresence(created), created: true, took_over: false };
}

export function heartbeat(agent: string, status?: string): void {
  const db = getDb();
  const normalizedAgent = agent.trim().toLowerCase();
  const resolvedStatus = status || "online";

  const existing = db.prepare("SELECT id FROM agent_presence WHERE agent = ?").get(normalizedAgent) as { id: string } | null;
  const id = existing?.id || crypto.randomUUID().slice(0, 8);

  db.prepare(`
    INSERT INTO agent_presence (id, agent, session_id, role, status, last_seen_at, created_at)
    VALUES (?, ?, NULL, 'agent', ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    ON CONFLICT(agent) DO UPDATE SET
      status = excluded.status,
      last_seen_at = excluded.last_seen_at
  `).run(id, normalizedAgent, resolvedStatus);
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
