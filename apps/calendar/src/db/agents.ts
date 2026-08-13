import { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import type { Agent, RegisterAgentInput } from "../types/index.js";
import { NotFoundError, ConflictError } from "../types/index.js";

function rowToAgent(row: any): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: row.role,
    title: row.title,
    level: row.level,
    capabilities: row.capabilities ? JSON.parse(row.capabilities as string) : [],
    status: row.status as Agent["status"],
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    session_id: row.session_id,
    working_dir: row.working_dir,
    active_org_id: row.active_org_id,
  };
}

export function registerAgent(input: RegisterAgentInput, db?: Database): Agent {
  db = db || getDatabase();

  // Check conflict
  const existing = db.query("SELECT * FROM agents WHERE name = ?").get(input.name);
  if (existing) {
    const row = existing as any;
    if (input.force) {
      // Force takeover — update existing
      db.run(
        `UPDATE agents SET last_seen_at = datetime('now'), session_id = ?, working_dir = ?, active_org_id = ?, description = ?, role = ?, title = ?, level = ?, capabilities = ? WHERE name = ?`,
        [input.session_id || null, input.working_dir || null, input.org_id || null, input.description || row.description, input.role || row.role, input.title || row.title, input.level || row.level, JSON.stringify(input.capabilities || JSON.parse(row.capabilities || "[]")), input.name]
      );
      return getAgent(row.id, db)!;
    }
    throw new ConflictError(`Agent name "${input.name}" already exists`);
  }

  const id = crypto.randomUUID().slice(0, 8);
  db.run(
    `INSERT INTO agents (id, name, description, role, title, level, capabilities, session_id, working_dir, active_org_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.description || null, input.role || null, input.title || null, input.level || null, JSON.stringify(input.capabilities || []), input.session_id || null, input.working_dir || null, input.org_id || null, JSON.stringify(input.metadata || {})]
  );

  return getAgent(id, db)!;
}

export function getAgent(id: string, db?: Database): Agent | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM agents WHERE id = ?").get(id);
  return row ? rowToAgent(row) : null;
}

export function getAgentByName(name: string, db?: Database): Agent | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM agents WHERE name = ?").get(name);
  return row ? rowToAgent(row) : null;
}

export function listAgents(db?: Database): Agent[] {
  db = db || getDatabase();
  const rows = db.query("SELECT * FROM agents ORDER BY name").all();
  return (rows as any[]).map(rowToAgent);
}

export function heartbeat(id: string, db?: Database): Agent | null {
  db = db || getDatabase();
  db.run(`UPDATE agents SET last_seen_at = datetime('now') WHERE id = ?`, [id]);
  return getAgent(id, db);
}

export function updateAgent(id: string, updates: Partial<RegisterAgentInput>, db?: Database): Agent | null {
  db = db || getDatabase();
  const existing = getAgent(id, db);
  if (!existing) throw new NotFoundError("Agent", id);

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description || null); }
  if (updates.role !== undefined) { fields.push("role = ?"); values.push(updates.role || null); }
  if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title || null); }
  if (updates.level !== undefined) { fields.push("level = ?"); values.push(updates.level || null); }
  if (updates.capabilities !== undefined) { fields.push("capabilities = ?"); values.push(JSON.stringify(updates.capabilities)); }
  if (updates.session_id !== undefined) { fields.push("session_id = ?"); values.push(updates.session_id || null); }
  if (updates.working_dir !== undefined) { fields.push("working_dir = ?"); values.push(updates.working_dir || null); }
  if (updates.org_id !== undefined) { fields.push("active_org_id = ?"); values.push(updates.org_id || null); }

  if (fields.length === 0) return existing;

  fields.push("last_seen_at = datetime('now')");
  values.push(id);

  db.run(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`, values);
  return getAgent(id, db);
}

export function deleteAgent(id: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM agents WHERE id = ?`, [id]);
  return result.changes > 0;
}
