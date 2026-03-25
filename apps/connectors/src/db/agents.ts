import { getDatabase, now, type Database } from "./database.js";

/** 30 minutes — after this an agent is considered stale and its name can be taken over */
const AGENT_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

function shortUuid(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface Agent {
  id: string;
  name: string;
  session_id: string | null;
  role: string;
  project_id: string | null;
  last_seen_at: string;
  created_at: string;
}

export interface AgentConflictError {
  conflict: true;
  existing_id: string;
  existing_name: string;
  last_seen_at: string;
  session_hint: string | null;
  working_dir: null;
  message: string;
}

export interface RegisterAgentInput {
  name: string;
  session_id?: string | null;
  role?: string;
}

export function isAgentConflict(result: Agent | AgentConflictError): result is AgentConflictError {
  return (result as AgentConflictError).conflict === true;
}

/**
 * Register an agent. Conflict rules (matching ecosystem standard):
 *  - Name free → create
 *  - Name taken, same session_id → heartbeat, return agent
 *  - Name taken, different session_id, agent ACTIVE (<30min) → CONFLICT error
 *  - Name taken, different session_id, agent STALE (>30min) → takeover
 *  - Name taken, no session_id → heartbeat (backward compat)
 */
export function registerAgent(input: RegisterAgentInput, db?: Database): Agent | AgentConflictError {
  const d = db ?? getDatabase();
  const normalizedName = input.name.trim().toLowerCase();

  const existing = getAgentByName(normalizedName, d);
  if (existing) {
    const lastSeenMs = new Date(existing.last_seen_at).getTime();
    const isActive = Date.now() - lastSeenMs < AGENT_ACTIVE_WINDOW_MS;
    const sameSession = input.session_id && existing.session_id && input.session_id === existing.session_id;
    const differentSession = input.session_id && existing.session_id && input.session_id !== existing.session_id;

    if (isActive && differentSession) {
      const minutesAgo = Math.round((Date.now() - lastSeenMs) / 60000);
      return {
        conflict: true,
        existing_id: existing.id,
        existing_name: existing.name,
        last_seen_at: existing.last_seen_at,
        session_hint: existing.session_id ? existing.session_id.slice(0, 8) : null,
        working_dir: null,
        message: `Agent "${normalizedName}" is already active (last seen ${minutesAgo}m ago). Pass session_id="${existing.session_id}" to reclaim it, or choose a different name.`,
      };
    }

    // Heartbeat / takeover
    const updates: string[] = ["last_seen_at = ?"];
    const params: (string | null)[] = [now()];
    if (input.session_id && !sameSession) {
      updates.push("session_id = ?");
      params.push(input.session_id);
    }
    params.push(existing.id);
    d.run(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`, params);
    return getAgent(existing.id, d)!;
  }

  const id = shortUuid();
  const ts = now();
  d.run(
    `INSERT INTO agents (id, name, session_id, role, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, normalizedName, input.session_id ?? null, input.role ?? "agent", ts, ts],
  );
  return getAgent(id, d)!;
}

export function getAgent(id: string, db?: Database): Agent | null {
  const d = db ?? getDatabase();
  return d.query("SELECT * FROM agents WHERE id = ?").get(id) as Agent | null;
}

export function getAgentByName(name: string, db?: Database): Agent | null {
  const d = db ?? getDatabase();
  return d.query("SELECT * FROM agents WHERE LOWER(name) = ?").get(name.trim().toLowerCase()) as Agent | null;
}

export function listAgents(db?: Database): Agent[] {
  const d = db ?? getDatabase();
  return d.query("SELECT * FROM agents ORDER BY name").all() as Agent[];
}

export function updateAgentActivity(id: string, db?: Database): void {
  const d = db ?? getDatabase();
  d.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), id]);
}

export function heartbeat(id: string, db?: Database): Agent | null {
  const d = db ?? getDatabase();
  d.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), id]);
  return getAgent(id, d);
}

export function setFocus(id: string, projectId: string | null, db?: Database): Agent | null {
  const d = db ?? getDatabase();
  d.run("UPDATE agents SET project_id = ?, last_seen_at = ? WHERE id = ?", [projectId, now(), id]);
  return getAgent(id, d);
}

export function deleteAgent(id: string, db?: Database): boolean {
  const d = db ?? getDatabase();
  return d.run("DELETE FROM agents WHERE id = ?", [id]).changes > 0;
}
