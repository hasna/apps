import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { Agent, AgentType } from "../types/index.ts";
import { NotFoundError } from "../types/index.ts";

function rowToAgent(row: RawAgent): Agent {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AgentType,
    email: row.email ?? null,
    api_key_hash: row.api_key_hash ?? null,
    permissions: JSON.parse(row.permissions ?? '["read","write"]') as string[],
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  };
}

interface RawAgent {
  id: string;
  name: string;
  type: string;
  email: string | null;
  api_key_hash: string | null;
  permissions: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface RegisterAgentOptions {
  name: string;
  type?: AgentType;
  email?: string;
}

export function registerAgent(options: RegisterAgentOptions, db?: Database): Agent {
  const database = db ?? getDatabase();
  const { name, type = "human", email } = options;

  // Idempotent — return existing if name matches
  const existing = database.query<RawAgent, [string]>(
    "SELECT * FROM agents WHERE name = ?"
  ).get(name);

  if (existing) {
    database.run(
      "UPDATE agents SET last_seen_at = ? WHERE id = ?",
      [now(), existing.id]
    );
    return rowToAgent({ ...existing, last_seen_at: now() });
  }

  const id = crypto.randomUUID().slice(0, 8);
  const n = now();
  database.run(
    `INSERT INTO agents (id, name, type, email, permissions, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, type, email ?? null, JSON.stringify(["read", "write"]), n, n]
  );

  return {
    id,
    name,
    type,
    email: email ?? null,
    api_key_hash: null,
    permissions: ["read", "write"],
    created_at: n,
    last_seen_at: n,
  };
}

export function getAgentById(id: string, db?: Database): Agent {
  const database = db ?? getDatabase();
  const row = database.query<RawAgent, [string]>(
    "SELECT * FROM agents WHERE id = ?"
  ).get(id);
  if (!row) throw new NotFoundError("Agent", id);
  return rowToAgent(row);
}

export function getAgentByName(name: string, db?: Database): Agent | null {
  const database = db ?? getDatabase();
  const row = database.query<RawAgent, [string]>(
    "SELECT * FROM agents WHERE name = ?"
  ).get(name);
  return row ? rowToAgent(row) : null;
}

export function listAgents(db?: Database): Agent[] {
  const database = db ?? getDatabase();
  const rows = database.query<RawAgent, []>("SELECT * FROM agents ORDER BY name ASC").all();
  return rows.map(rowToAgent);
}

export function updateLastSeen(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  database.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), id]);
}

export function updateAgentApiKeyHash(id: string, keyHash: string, db?: Database): void {
  const database = db ?? getDatabase();
  database.run("UPDATE agents SET api_key_hash = ? WHERE id = ?", [keyHash, id]);
}
