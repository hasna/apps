import type { Database } from "bun:sqlite";
import type { Agent, AgentConflictError, AgentRow, AgentStatus, RegisterAgentInput } from "../types/index.js";
import { getDatabase, now } from "./database.js";

/** How long (ms) before an agent is considered stale and its name can be taken over.
 *  Configurable via TODOS_AGENT_TIMEOUT_MS env var, defaults to 30 minutes. */
function getActiveWindowMs(): number {
  const env = process.env["TODOS_AGENT_TIMEOUT_MS"];
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 30 * 60 * 1000; // 30 minutes
}

/**
 * Auto-release stale agents: clears session_id for agents whose last_seen_at
 * is beyond the active window. Enabled via TODOS_AGENT_AUTO_RELEASE=true.
 */
export function autoReleaseStaleAgents(db?: Database): number {
  if (process.env["TODOS_AGENT_AUTO_RELEASE"] !== "true") return 0;
  const d = db || getDatabase();
  const cutoff = new Date(Date.now() - getActiveWindowMs()).toISOString();
  const result = d.run(
    "UPDATE agents SET session_id = NULL WHERE status = 'active' AND session_id IS NOT NULL AND last_seen_at < ?",
    [cutoff],
  );
  return result.changes;
}

/**
 * Returns names from the pool that are not currently held by an active agent.
 * Active = last_seen_at within the configured stale window.
 */
export function getAvailableNamesFromPool(pool: string[], db: Database): string[] {
  autoReleaseStaleAgents(db);
  const cutoff = new Date(Date.now() - getActiveWindowMs()).toISOString();
  const activeNames = new Set(
    (db.query("SELECT name FROM agents WHERE status = 'active' AND last_seen_at > ?").all(cutoff) as { name: string }[])
      .map((r) => r.name.toLowerCase()),
  );
  return pool.filter((name) => !activeNames.has(name.toLowerCase()));
}

function shortUuid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function rowToAgent(row: AgentRow): Agent {
  return {
    ...row,
    permissions: JSON.parse(row.permissions || '["*"]') as string[],
    capabilities: JSON.parse(row.capabilities || "[]") as string[],
    status: (row.status || "active") as AgentStatus,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

/**
 * Register an agent. Returns the agent or a conflict descriptor.
 *
 * Conflict rules:
 *  - Name free → create, bind session_id if provided
 *  - Name taken, same session_id → heartbeat, return agent ✓
 *  - Name taken, different session_id, agent ACTIVE → CONFLICT error (unless force: true)
 *  - Name taken, different session_id, agent STALE → takeover, update session_id
 *  - Name taken, no session_id provided, agent ACTIVE with session → CONFLICT error (tightened)
 *  - Name taken, no session_id provided, agent has no session or is stale → heartbeat + return
 *  - force: true → skip active-agent check and take over regardless
 */
export function registerAgent(input: RegisterAgentInput, db?: Database): Agent | AgentConflictError {
  const d = db || getDatabase();
  const normalizedName = input.name.trim().toLowerCase();

  // Pool is advisory — any name is allowed, pool just provides suggestions on conflict

  const existing = getAgentByName(normalizedName, d);
  if (existing) {
    const lastSeenMs = new Date(existing.last_seen_at).getTime();
    const activeWindowMs = getActiveWindowMs();
    const isActive = Date.now() - lastSeenMs < activeWindowMs;
    const sameSession = input.session_id && existing.session_id && input.session_id === existing.session_id;
    const differentSession = input.session_id && existing.session_id && input.session_id !== existing.session_id;
    const callerHasNoSession = !input.session_id;
    const existingHasActiveSession = existing.session_id && isActive;

    // Force takeover — skip all conflict checks
    if (!input.force) {
      // Hard block: active agent with a different known session
      if (isActive && differentSession) {
        return buildConflictError(existing, lastSeenMs, input.pool, d);
      }

      // Tightened: caller has no session_id but existing agent is actively session-bound
      // Previously this was a silent heartbeat — now it's a conflict
      if (callerHasNoSession && existingHasActiveSession) {
        return buildConflictError(existing, lastSeenMs, input.pool, d);
      }
    }

    // Takeover: stale agent, force takeover, or compatible session — update binding
    // Also reactivate archived agents on re-register
    const updates: string[] = ["last_seen_at = ?", "status = 'active'"];
    const params: (string | null)[] = [now()];
    if (input.session_id && !sameSession) {
      updates.push("session_id = ?");
      params.push(input.session_id);
    }
    if (input.working_dir) {
      updates.push("working_dir = ?");
      params.push(input.working_dir);
    }
    if (input.description) {
      updates.push("description = ?");
      params.push(input.description);
    }
    params.push(existing.id);
    d.run(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`, params);
    return getAgent(existing.id, d)!;
  }

  const id = shortUuid();
  const timestamp = now();

  d.run(
    `INSERT INTO agents (id, name, description, role, title, level, permissions, capabilities, reports_to, org_id, metadata, created_at, last_seen_at, session_id, working_dir)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, normalizedName, input.description || null, input.role || "agent",
     input.title || null, input.level || null,
     JSON.stringify(input.permissions || ["*"]), JSON.stringify(input.capabilities || []),
     input.reports_to || null,
     input.org_id || null, JSON.stringify(input.metadata || {}), timestamp, timestamp,
     input.session_id || null, input.working_dir || null],
  );

  return getAgent(id, d)!;
}

export function isAgentConflict(result: Agent | AgentConflictError): result is AgentConflictError {
  return (result as AgentConflictError).conflict === true;
}

function buildConflictError(existing: Agent, lastSeenMs: number, pool: string[] | undefined, d: Database): AgentConflictError {
  const minutesAgo = Math.round((Date.now() - lastSeenMs) / 60000);
  const suggestions = pool ? getAvailableNamesFromPool(pool, d) : [];
  return {
    conflict: true,
    existing_id: existing.id,
    existing_name: existing.name,
    last_seen_at: existing.last_seen_at,
    session_hint: existing.session_id ? existing.session_id.slice(0, 8) : null,
    working_dir: existing.working_dir,
    suggestions: suggestions.slice(0, 5),
    message: `Agent "${existing.name}" is already active (last seen ${minutesAgo}m ago, session ${existing.session_id ? "…" + existing.session_id.slice(-4) : "none"}, dir: ${existing.working_dir ?? "unknown"}). Pass force: true to take over, or choose a different name.${suggestions.length > 0 ? ` Available: ${suggestions.slice(0, 3).join(", ")}` : ""}`,
  };
}

/**
 * Release an agent — explicit logout. Clears session_id and sets last_seen_at to epoch
 * so the name is immediately available for other agents.
 *
 * If session_id is provided, only release if it matches (prevents other sessions from
 * releasing your agent).
 */
export function releaseAgent(id: string, session_id?: string, db?: Database): boolean {
  const d = db || getDatabase();
  const agent = getAgent(id, d);
  if (!agent) return false;

  // If session_id provided, verify it matches before releasing
  if (session_id && agent.session_id && agent.session_id !== session_id) {
    return false;
  }

  const epoch = new Date(0).toISOString();
  d.run("UPDATE agents SET session_id = NULL, last_seen_at = ? WHERE id = ?", [epoch, id]);
  return true;
}

export function getAgent(id: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function getAgentByName(name: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const normalizedName = name.trim().toLowerCase();
  const row = d.query("SELECT * FROM agents WHERE LOWER(name) = ?").get(normalizedName) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function listAgents(opts?: { include_archived?: boolean } | Database, db?: Database): Agent[] {
  // Backward compat: if first arg is a Database, treat it as db
  let d: Database;
  let includeArchived = false;
  if (opts && typeof opts === "object" && "query" in opts) {
    d = opts;
  } else {
    includeArchived = (opts as { include_archived?: boolean } | undefined)?.include_archived ?? false;
    d = db || getDatabase();
  }
  autoReleaseStaleAgents(d);
  if (includeArchived) {
    return (d.query("SELECT * FROM agents ORDER BY name").all() as AgentRow[]).map(rowToAgent);
  }
  return (d.query("SELECT * FROM agents WHERE status = 'active' ORDER BY name").all() as AgentRow[]).map(rowToAgent);
}

export function updateAgentActivity(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), id]);
}

export function updateAgent(
  id: string,
  input: { name?: string; description?: string; role?: string; title?: string; level?: string; permissions?: string[]; capabilities?: string[]; reports_to?: string | null; org_id?: string | null; metadata?: Record<string, unknown> },
  db?: Database,
): Agent {
  const d = db || getDatabase();
  const agent = getAgent(id, d);
  if (!agent) throw new Error(`Agent not found: ${id}`);

  const sets: string[] = ["last_seen_at = ?"];
  const params: (string | null)[] = [now()];

  if (input.name !== undefined) {
    const newName = input.name.trim().toLowerCase();
    // Check if name is held by a different active agent
    const holder = getAgentByName(newName, d);
    if (holder && holder.id !== id) {
      const lastSeenMs = new Date(holder.last_seen_at).getTime();
      const isActive = Date.now() - lastSeenMs < getActiveWindowMs();
      if (isActive && holder.status === "active") {
        throw new Error(`Cannot rename: name "${newName}" is held by active agent ${holder.id} (last seen ${Math.round((Date.now() - lastSeenMs) / 60000)}m ago)`);
      }
      // Holder is stale or archived — evict by clearing their name to free the UNIQUE constraint
      const evictedName = `${holder.name}__evicted_${holder.id}`;
      d.run("UPDATE agents SET name = ? WHERE id = ?", [evictedName, holder.id]);
    }
    sets.push("name = ?");
    params.push(newName);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.role !== undefined) {
    sets.push("role = ?");
    params.push(input.role);
  }
  if (input.permissions !== undefined) {
    sets.push("permissions = ?");
    params.push(JSON.stringify(input.permissions));
  }
  if (input.capabilities !== undefined) {
    sets.push("capabilities = ?");
    params.push(JSON.stringify(input.capabilities));
  }
  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.level !== undefined) {
    sets.push("level = ?");
    params.push(input.level);
  }
  if (input.reports_to !== undefined) {
    sets.push("reports_to = ?");
    params.push(input.reports_to);
  }
  if (input.org_id !== undefined) {
    sets.push("org_id = ?");
    params.push(input.org_id);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  params.push(id);
  d.run(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`, params);
  return getAgent(id, d)!;
}

/** Soft-delete: archives the agent instead of removing it. Tasks referencing this agent are preserved. */
export function deleteAgent(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("UPDATE agents SET status = 'archived', last_seen_at = ? WHERE id = ?", [now(), id]).changes > 0;
}

/** Archive an agent (soft delete). */
export function archiveAgent(id: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  d.run("UPDATE agents SET status = 'archived', last_seen_at = ? WHERE id = ?", [now(), id]);
  return getAgent(id, d);
}

/** Restore an archived agent. */
export function unarchiveAgent(id: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  d.run("UPDATE agents SET status = 'active', last_seen_at = ? WHERE id = ?", [now(), id]);
  return getAgent(id, d);
}

/** Get direct reports of an agent. */
export function getDirectReports(agentId: string, db?: Database): Agent[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM agents WHERE reports_to = ? ORDER BY name").all(agentId) as AgentRow[]).map(rowToAgent);
}

/** Get the full org tree starting from top-level agents (reports_to IS NULL). */
export function getOrgChart(db?: Database): OrgNode[] {
  const agents = listAgents(db);
  const byManager = new Map<string | null, Agent[]>();
  for (const a of agents) {
    const key = a.reports_to;
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key)!.push(a);
  }

  function buildTree(parentId: string | null): OrgNode[] {
    const children = byManager.get(parentId) || [];
    return children.map(a => ({ agent: a, reports: buildTree(a.id) }));
  }

  return buildTree(null);
}

export interface OrgNode {
  agent: Agent;
  reports: OrgNode[];
}

/**
 * Match agent capabilities against required capabilities (task tags).
 * Returns a score from 0.0 (no match) to 1.0 (perfect match).
 */
export function matchCapabilities(agentCapabilities: string[], requiredCapabilities: string[]): number {
  if (requiredCapabilities.length === 0) return 1.0; // No requirements = any agent matches
  if (agentCapabilities.length === 0) return 0.0;

  const agentSet = new Set(agentCapabilities.map(c => c.toLowerCase()));
  let matches = 0;
  for (const req of requiredCapabilities) {
    if (agentSet.has(req.toLowerCase())) matches++;
  }
  return matches / requiredCapabilities.length;
}

/**
 * Get agents that match the given capabilities, sorted by match score.
 */
export function getCapableAgents(
  capabilities: string[],
  opts?: { min_score?: number; limit?: number },
  db?: Database,
): { agent: Agent; score: number }[] {
  const agents = listAgents(db);
  const minScore = opts?.min_score ?? 0.1;

  const scored = agents
    .map(agent => ({
      agent,
      score: matchCapabilities(agent.capabilities, capabilities),
    }))
    .filter(entry => entry.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return opts?.limit ? scored.slice(0, opts.limit) : scored;
}
