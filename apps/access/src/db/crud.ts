import type { Database } from "bun:sqlite";

/** Low-level shared row helpers used by the service layer. */

export function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function clampLimit(limit: unknown, def = 50, max = 500): number {
  const n = typeof limit === "number" ? limit : Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

export function clampOffset(offset: unknown): number {
  const n = typeof offset === "number" ? offset : Number.parseInt(String(offset ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

const ID_TABLES = new Set([
  "identities",
  "credentials",
  "scopes",
  "elevations",
  "access_requests",
  "access_reviews",
  "revocations",
  "issued_tokens",
]);

/** Resolve a full or partial id within an allowlisted table (prefix match). */
export function resolvePartialId(db: Database, table: string, partialId: string): string | null {
  if (!ID_TABLES.has(table)) throw new Error(`Invalid table name: ${table}`);
  if (partialId.length >= 36) {
    const row = db.query(`SELECT id FROM ${table} WHERE id = ?`).get(partialId) as { id: string } | null;
    return row?.id ?? null;
  }
  const rows = db.query(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${partialId}%`) as { id: string }[];
  if (rows.length === 1) return rows[0]!.id;
  return null;
}
