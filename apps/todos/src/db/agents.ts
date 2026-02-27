import type { Database } from "bun:sqlite";
import type { Agent, AgentRow, RegisterAgentInput } from "../types/index.js";
import { getDatabase, now } from "./database.js";

function shortUuid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function rowToAgent(row: AgentRow): Agent {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

/**
 * Register an agent. If an agent with the same name already exists,
 * return the existing agent (idempotent). This is the "init" operation.
 */
export function registerAgent(input: RegisterAgentInput, db?: Database): Agent {
  const d = db || getDatabase();

  const existing = getAgentByName(input.name, d);
  if (existing) {
    d.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), existing.id]);
    return getAgent(existing.id, d)!;
  }

  const id = shortUuid();
  const timestamp = now();

  d.run(
    `INSERT INTO agents (id, name, description, metadata, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.description || null, JSON.stringify(input.metadata || {}), timestamp, timestamp],
  );

  return getAgent(id, d)!;
}

export function getAgent(id: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function getAgentByName(name: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM agents WHERE name = ?").get(name) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function listAgents(db?: Database): Agent[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM agents ORDER BY name").all() as AgentRow[]).map(rowToAgent);
}

export function updateAgentActivity(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), id]);
}

export function deleteAgent(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM agents WHERE id = ?", [id]).changes > 0;
}
