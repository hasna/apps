import { getDb } from "./db.js";
import type { AgentPresence, AgentConflictError, RegisterAgentResult } from "../types.js";
import { AGENT_LIST_ORDER, simpleOrderByClause } from "./list-order.js";

const ONLINE_THRESHOLD_SECONDS = 60;
const CONFLICT_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

export function normalizeAgentName(name: string): string {
  return name.trim().toLowerCase();
}

function toStoredProjectId(projectId?: string | null): string {
  const normalized = projectId?.trim() ?? "";
  return normalized || "";
}

function fromStoredProjectId(projectId: unknown): string | null {
  const normalized = typeof projectId === "string" ? projectId.trim() : "";
  return normalized || null;
}

function getPresenceByAgent(db: ReturnType<typeof getDb>, agent: string): Record<string, unknown> | null {
  return db.prepare(`
    SELECT * FROM agent_presence
    WHERE LOWER(agent) = ?
    ORDER BY last_seen_at DESC
    LIMIT 1
  `).get(agent) as Record<string, unknown> | null;
}

function getPresenceByAgentAndProject(
  db: ReturnType<typeof getDb>,
  agent: string,
  projectId: string,
): Record<string, unknown> | null {
  return db.prepare(`
    SELECT * FROM agent_presence
    WHERE LOWER(agent) = ? AND COALESCE(project_id, '') = ?
    ORDER BY last_seen_at DESC
    LIMIT 1
  `).get(agent, projectId) as Record<string, unknown> | null;
}

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
    project_id: fromStoredProjectId(row.project_id),
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

export function isAgentConflict(result: RegisterAgentResult | AgentConflictError): result is AgentConflictError {
  return (result as AgentConflictError).conflict === true;
}

export function registerAgent(
  name: string,
  sessionId: string,
  role?: string,
  projectId?: string,
  force = false,
): RegisterAgentResult | AgentConflictError {
  const db = getDb();
  const normalizedName = normalizeAgentName(name);

  // BEGIN IMMEDIATE acquires write lock at start — eliminates TOCTOU race
  const result = db.transaction(() => {
    const existing = getPresenceByAgent(db, normalizedName);
    const storedProjectId = toStoredProjectId(projectId ?? (existing?.project_id as string | null | undefined));

    if (existing) {
      const lastSeenAt = existing.last_seen_at as string;
      const existingSessionId = existing.session_id as string | null;

      // Active session with a different session_id — conflict
      if (!force && isActiveSession(lastSeenAt) && existingSessionId && existingSessionId !== sessionId) {
        return {
          conflict: true as const,
          error: "agent_conflict" as const,
          message: `Agent "${normalizedName}" is already active (last seen: ${lastSeenAt}). Wait 30 minutes or use force takeover.`,
          existing_id: existing.id as string,
          existing_name: normalizedName,
          existing_session_id: existingSessionId,
          last_seen_at: lastSeenAt,
          session_hint: existingSessionId ? existingSessionId.slice(0, 8) : null,
          working_dir: null,
        };
      }

      // Stale or same session — takeover/update
      const tookOver = existingSessionId !== sessionId;
      const existingId = existing.id as string;
      const target = getPresenceByAgentAndProject(db, normalizedName, storedProjectId);

      if (target && (target.id as string) !== existingId) {
        db.prepare(`
          UPDATE agent_presence
          SET session_id = ?, role = ?, status = 'online', last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
          WHERE id = ?
        `).run(sessionId, role || (existing.role as string) || "agent", target.id as string);
        db.prepare("DELETE FROM agent_presence WHERE id = ?").run(existingId);
      } else {
        db.prepare(`
          UPDATE agent_presence
          SET session_id = ?, role = ?, project_id = ?, status = 'online', last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
          WHERE id = ?
        `).run(
          sessionId,
          role || (existing.role as string) || "agent",
          storedProjectId,
          existingId,
        );
      }

      const updated = getPresenceByAgentAndProject(db, normalizedName, storedProjectId)
        ?? getPresenceByAgent(db, normalizedName);
      if (!updated) {
        throw new Error(`Failed to update presence for agent "${normalizedName}"`);
      }
      return { agent: parsePresence(updated), created: false, took_over: tookOver };
    }

    // New agent
    const id = crypto.randomUUID().slice(0, 8);
    const resolvedRole = role || "agent";
    db.prepare(`
      INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    `).run(id, normalizedName, sessionId, resolvedRole, storedProjectId);

    const created = getPresenceByAgentAndProject(db, normalizedName, storedProjectId)
      ?? getPresenceByAgent(db, normalizedName);
    if (!created) {
      throw new Error(`Failed to create presence for agent "${normalizedName}"`);
    }
    return { agent: parsePresence(created), created: true, took_over: false };
  });

  return result;
}

export function heartbeat(
  agent: string,
  status?: string,
  metadata?: Record<string, unknown>,
  sessionId?: string,
  projectId?: string | null,
): void {
  const db = getDb();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const resolvedStatus = status || "online";
  const normalizedAgent = normalizeAgentName(agent);

  db.transaction(() => {
    const existing = getPresenceByAgent(db, normalizedAgent);
    const storedProjectId = toStoredProjectId(projectId ?? (existing?.project_id as string | null | undefined));
    const id = (existing?.id as string | undefined) || crypto.randomUUID().slice(0, 8);

    if (existing) {
      const existingId = existing.id as string;
      const target = getPresenceByAgentAndProject(db, normalizedAgent, storedProjectId);

      if (target && (target.id as string) !== existingId) {
        db.prepare(`
          UPDATE agent_presence
          SET status = ?,
              last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now'),
              session_id = COALESCE(?, session_id),
              metadata = ?
          WHERE id = ?
        `).run(resolvedStatus, sessionId ?? null, metadataJson, target.id as string);
        db.prepare("DELETE FROM agent_presence WHERE id = ?").run(existingId);
        return;
      }

      db.prepare(`
        UPDATE agent_presence
        SET status = ?,
            last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now'),
            session_id = COALESCE(?, session_id),
            metadata = ?,
            project_id = ?
        WHERE id = ?
      `).run(resolvedStatus, sessionId ?? null, metadataJson, storedProjectId, existingId);
      return;
    }

    db.prepare(`
      INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
      VALUES (?, ?, ?, 'agent', ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'), ?)
    `).run(id, normalizedAgent, sessionId ?? null, storedProjectId, resolvedStatus, metadataJson);
  });
}

export function getPresence(agent: string): AgentPresence | null {
  const db = getDb();
  const normalizedAgent = normalizeAgentName(agent);
  const row = getPresenceByAgent(db, normalizedAgent);
  return row ? parsePresence(row) : null;
}

export function listAgents(opts?: { online_only?: boolean }): AgentPresence[] {
  const db = getDb();

  let query = "SELECT * FROM agent_presence";

  if (opts?.online_only) {
    query += " WHERE last_seen_at > strftime('%Y-%m-%dT%H:%M:%f', 'now', '-60 seconds')";
  }

  query += ` ${simpleOrderByClause(AGENT_LIST_ORDER)}`;

  const rows = db.prepare(query).all() as Record<string, unknown>[];
  return rows.map(parsePresence);
}

export function removePresence(agent: string): boolean {
  const db = getDb();
  const normalizedAgent = normalizeAgentName(agent);
  const result = db.prepare("DELETE FROM agent_presence WHERE LOWER(agent) = ?").run(normalizedAgent);
  return result.changes > 0;
}

export function renameAgent(oldName: string, newName: string): boolean {
  const db = getDb();
  const normalizedOld = normalizeAgentName(oldName);
  const normalizedNew = normalizeAgentName(newName);

  const existing = db.prepare("SELECT agent FROM agent_presence WHERE LOWER(agent) = ?").get(normalizedOld);
  if (!existing) return false;

  const conflict = db.prepare("SELECT agent FROM agent_presence WHERE LOWER(agent) = ?").get(normalizedNew);
  if (conflict) throw new Error(`Agent "${normalizedNew}" already exists`);

  db.prepare("UPDATE agent_presence SET agent = ? WHERE LOWER(agent) = ?").run(normalizedNew, normalizedOld);
  return true;
}

export function setPresenceProject(agent: string, projectId: string | null): void {
  const db = getDb();
  const normalizedAgent = normalizeAgentName(agent);
  const desiredProjectId = toStoredProjectId(projectId);
  const latest = getPresenceByAgent(db, normalizedAgent);

  if (!latest) {
    heartbeat(normalizedAgent, "online", undefined, undefined, projectId);
    return;
  }

  const currentProjectId = toStoredProjectId(latest.project_id as string | null | undefined);
  if (currentProjectId === desiredProjectId) return;

  db.transaction(() => {
    const latestId = latest.id as string;
    const target = getPresenceByAgentAndProject(db, normalizedAgent, desiredProjectId);

    if (target && (target.id as string) !== latestId) {
      db.prepare(`
        UPDATE agent_presence
        SET status = ?,
            last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now'),
            session_id = COALESCE(?, session_id),
            metadata = COALESCE(?, metadata)
        WHERE LOWER(agent) = ? AND COALESCE(project_id, '') = ?
      `).run(
        (latest.status as string) || (target.status as string) || "online",
        (latest.session_id as string | null) ?? null,
        (latest.metadata as string | null) ?? null,
        normalizedAgent,
        desiredProjectId,
      );
      db.prepare("DELETE FROM agent_presence WHERE id = ?").run(latestId);
      return;
    }

    db.prepare(`
      UPDATE agent_presence
      SET project_id = ?, last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
      WHERE id = ?
    `).run(desiredProjectId, latestId);
  });
}
