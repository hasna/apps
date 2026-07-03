import type { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDatabase, now, uuid } from "./database.js";

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  prefix: string;
  permissions: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface CreateApiKeyInput {
  name: string;
  permissions?: string[];
  expires_at?: string | null;
}

export interface CreatedApiKey {
  key: string;
  record: ApiKeyRecord;
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    permissions: JSON.parse(row.permissions || '["*"]') as string[],
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
  };
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Constant-time comparison of two arbitrary (non-hex) strings.
 *
 * Both operands are hashed to a fixed 32-byte digest before comparison so that
 * neither the length nor the content of the secret leaks through timing, and so
 * that `timingSafeEqual` never throws on length mismatch. Use this for the
 * static env/CLI API key, whose value is not stored as a hex digest.
 */
export function safeEqualStrings(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

function generatePlaintextKey(): string {
  return `tdos_${randomBytes(32).toString("base64url")}`;
}

export function createApiKey(input: CreateApiKeyInput, db?: Database): CreatedApiKey {
  const d = db || getDatabase();
  const name = input.name.trim();
  if (!name) throw new Error("API key name is required");

  const key = generatePlaintextKey();
  const timestamp = now();
  const id = uuid();
  const prefix = key.slice(0, 12);
  d.run(
    `INSERT INTO api_keys (id, name, key_hash, prefix, permissions, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name,
      hashApiKey(key),
      prefix,
      JSON.stringify(input.permissions?.length ? input.permissions : ["*"]),
      timestamp,
      input.expires_at || null,
    ],
  );
  const row = d.query("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow;
  return { key, record: rowToRecord(row) };
}

export function listApiKeys(opts?: { include_revoked?: boolean }, db?: Database): ApiKeyRecord[] {
  const d = db || getDatabase();
  const includeRevoked = opts?.include_revoked ?? false;
  const sql = includeRevoked
    ? "SELECT * FROM api_keys ORDER BY created_at DESC"
    : "SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC";
  return (d.query(sql).all() as ApiKeyRow[]).map(rowToRecord);
}

export function hasActiveApiKeys(db?: Database): boolean {
  const d = db || getDatabase();
  const row = d.query(
    "SELECT COUNT(*) AS count FROM api_keys WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
  ).get(now()) as { count: number } | null;
  return (row?.count ?? 0) > 0;
}

export function verifyApiKey(key: string, db?: Database): ApiKeyRecord | null {
  const d = db || getDatabase();
  const candidateHash = hashApiKey(key);
  const rows = d.query(
    "SELECT * FROM api_keys WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
  ).all(now()) as ApiKeyRow[];
  for (const row of rows) {
    if (!safeEqualHex(candidateHash, row.key_hash)) continue;
    d.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [now(), row.id]);
    return rowToRecord({ ...row, last_used_at: now() });
  }
  return null;
}

export function revokeApiKey(idOrPrefix: string, db?: Database): ApiKeyRecord | null {
  const d = db || getDatabase();
  const identifier = idOrPrefix.trim();
  const row = d.query(
    "SELECT * FROM api_keys WHERE id = ? OR prefix = ?",
  ).get(identifier, identifier) as ApiKeyRow | null;
  if (!row) return null;
  d.run("UPDATE api_keys SET revoked_at = ? WHERE id = ?", [now(), row.id]);
  const updated = d.query("SELECT * FROM api_keys WHERE id = ?").get(row.id) as ApiKeyRow;
  return rowToRecord(updated);
}
