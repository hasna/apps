import { getDb } from "./index.js";

export interface Agent {
  id: string;
  name: string;
  description?: string;
  capabilities?: string[];
  focus?: string;
  last_heartbeat: string;
  created_at: string;
}

/** Ensure agents table exists */
export function ensureAgentsTable(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      capabilities TEXT,
      focus TEXT,
      last_heartbeat TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Register or update an agent */
export function registerAgent(agent: {
  name: string;
  description?: string;
  capabilities?: string[];
}): Agent {
  ensureAgentsTable();
  const d = getDb();
  const now = new Date().toISOString();
  const id = agent.name; // Use name as ID for simplicity

  const existing = d.prepare("SELECT * FROM agents WHERE name = ?").get(agent.name) as any;

  if (existing) {
    d.prepare(`
      UPDATE agents SET description = ?, capabilities = ?, last_heartbeat = ?
      WHERE name = ?
    `).run(
      agent.description ?? existing.description,
      agent.capabilities ? JSON.stringify(agent.capabilities) : existing.capabilities,
      now,
      agent.name
    );
  } else {
    d.prepare(`
      INSERT INTO agents (id, name, description, capabilities, last_heartbeat, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, agent.name, agent.description ?? null, agent.capabilities ? JSON.stringify(agent.capabilities) : null, now, now);
  }

  return getAgent(id)!;
}

/** Send a heartbeat for an agent */
export function heartbeat(agentId: string): boolean {
  ensureAgentsTable();
  const d = getDb();
  const result = d.prepare("UPDATE agents SET last_heartbeat = ? WHERE id = ?").run(
    new Date().toISOString(),
    agentId
  );
  return result.changes > 0;
}

/** Set agent focus */
export function setFocus(agentId: string, focus: string): boolean {
  ensureAgentsTable();
  const d = getDb();
  const result = d.prepare("UPDATE agents SET focus = ? WHERE id = ?").run(focus, agentId);
  return result.changes > 0;
}

/** Get an agent by ID */
export function getAgent(id: string): Agent | null {
  ensureAgentsTable();
  const d = getDb();
  const row = d.prepare("SELECT * FROM agents WHERE id = ?").get(id) as any;
  if (!row) return null;
  return rowToAgent(row);
}

/** List all agents */
export function listAgents(): Agent[] {
  ensureAgentsTable();
  const d = getDb();
  const rows = d.prepare("SELECT * FROM agents ORDER BY last_heartbeat DESC").all() as any[];
  return rows.map(rowToAgent);
}

function rowToAgent(row: any): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : undefined,
    focus: row.focus,
    last_heartbeat: row.last_heartbeat,
    created_at: row.created_at,
  };
}
