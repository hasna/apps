import { createHash, randomBytes } from "crypto";
import { getDb } from "./database.js";
import type { ApiKey } from "../types/index.js";

// ─── Row types ────────────────────────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string | null;
  active: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    name: row.name,
    active: row.active === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

// ─── Key generation ───────────────────────────────────────────────────────────

function generateRawKey(): string {
  // wc_live_ + 32 hex chars = 40 chars total
  return "wc_live_" + randomBytes(16).toString("hex");
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createApiKey(input: {
  name?: string;
  expiresAt?: string;
}): { apiKey: ApiKey; rawKey: string } {
  const db = getDb();
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12); // "wc_live_XXXX"
  const id = randomBytes(16).toString("hex");
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO api_keys (id, key_hash, key_prefix, name, active, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, 1, ?, NULL, ?)`
  ).run(id, keyHash, keyPrefix, input.name ?? null, now, input.expiresAt ?? null);

  const apiKey = getApiKeyById(id);
  if (!apiKey) throw new Error("Failed to create API key");

  return { apiKey, rawKey };
}

function getApiKeyById(id: string): ApiKey | null {
  const db = getDb();
  const stmt = db.prepare<ApiKeyRow, [string]>("SELECT * FROM api_keys WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToApiKey(row) : null;
}

export function getApiKeyByHash(hash: string): ApiKey | null {
  const db = getDb();
  const stmt = db.prepare<ApiKeyRow, [string]>("SELECT * FROM api_keys WHERE key_hash = ?");
  const row = stmt.get(hash);
  return row ? rowToApiKey(row) : null;
}

export function listApiKeys(): ApiKey[] {
  const db = getDb();
  const stmt = db.prepare<ApiKeyRow, []>("SELECT * FROM api_keys ORDER BY created_at DESC");
  return stmt.all().map(rowToApiKey);
}

export function revokeApiKey(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare("UPDATE api_keys SET active = 0 WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function touchApiKey(id: string): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?");
  stmt.run(new Date().toISOString(), id);
}
