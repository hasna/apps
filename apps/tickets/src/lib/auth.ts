import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.ts";
import type { ApiKey } from "../types/index.ts";
import { NotFoundError, AuthError } from "../types/index.ts";

interface RawApiKey { id: string; agent_id: string; key_hash: string; name: string; scopes: string; last_used_at: string | null; created_at: string }

function rowToApiKey(r: RawApiKey): ApiKey {
  return { id: r.id, agent_id: r.agent_id, key_hash: r.key_hash, name: r.name, scopes: JSON.parse(r.scopes) as string[], last_used_at: r.last_used_at, created_at: r.created_at };
}

/** Generate a new API key string: "tkt_<random>" */
export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `tkt_${b64}`;
}

/** SHA-256 hash of the raw key for storage */
export async function hashApiKey(rawKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createApiKey(agentId: string, name: string, scopes: string[] = ["read", "write"], db?: Database): Promise<{ apiKey: ApiKey; rawKey: string }> {
  const database = db ?? getDatabase();
  const rawKey = generateApiKey();
  const key_hash = await hashApiKey(rawKey);
  const id = uuid();
  const n = now();
  database.run(
    "INSERT INTO api_keys (id, agent_id, key_hash, name, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, agentId, key_hash, name, JSON.stringify(scopes), n]
  );
  const apiKey: ApiKey = { id, agent_id: agentId, key_hash, name, scopes, last_used_at: null, created_at: n };
  return { apiKey, rawKey };
}

export async function verifyApiKey(rawKey: string, db?: Database): Promise<ApiKey> {
  const database = db ?? getDatabase();
  const hash = await hashApiKey(rawKey);
  const row = database.query<RawApiKey, [string]>("SELECT * FROM api_keys WHERE key_hash = ?").get(hash);
  if (!row) throw new AuthError("Invalid API key");
  database.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [now(), row.id]);
  return rowToApiKey(row);
}

export function listApiKeys(agentId: string, db?: Database): ApiKey[] {
  const database = db ?? getDatabase();
  return database.query<RawApiKey, [string]>("SELECT * FROM api_keys WHERE agent_id = ? ORDER BY created_at DESC").all(agentId).map(rowToApiKey);
}

export function revokeApiKey(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  const result = database.run("DELETE FROM api_keys WHERE id = ?", [id]);
  if (result.changes === 0) throw new NotFoundError("ApiKey", id);
}
