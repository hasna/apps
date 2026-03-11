import {
  type Agent,
  type AgentRow,
  agentFromRow,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function registerAgent(input: {
  name: string;
  description?: string;
  role?: string;
}): Agent {
  const db = getDatabase();

  // Idempotent: return existing agent if name matches
  const existing = db.query("SELECT * FROM agents WHERE name = ?").get(input.name) as AgentRow | null;
  if (existing) {
    // Update last_seen_at on re-registration
    db.query("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(now(), existing.id);
    return getAgent(existing.id)!;
  }

  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO agents (id, name, description, role, metadata, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, '{}', ?, ?)
  `).run(
    id,
    input.name,
    input.description ?? null,
    input.role ?? null,
    timestamp,
    timestamp,
  );

  return getAgent(id)!;
}

export function getAgent(id: string): Agent | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;
  return row ? agentFromRow(row) : null;
}

export function getAgentByName(name: string): Agent | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM agents WHERE name = ?").get(name) as AgentRow | null;
  return row ? agentFromRow(row) : null;
}

export function listAgents(): Agent[] {
  const db = getDatabase();
  const rows = db.query("SELECT * FROM agents ORDER BY created_at DESC").all() as AgentRow[];
  return rows.map(agentFromRow);
}
