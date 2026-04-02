/**
 * Domain record types and CRUD operations
 */

import { getDatabase } from "./database.js";
import type { SQLQueryBindings } from "bun:sqlite";

// --- Domain types ---

export interface Domain {
  id: string;
  name: string;
  registrar: string | null;
  status: "active" | "expired" | "transferring" | "redemption";
  registered_at: string | null;
  expires_at: string | null;
  auto_renew: boolean;
  nameservers: string[];
  whois: Record<string, unknown>;
  ssl_expires_at: string | null;
  ssl_issuer: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface DomainRow {
  id: string;
  name: string;
  registrar: string | null;
  status: string;
  registered_at: string | null;
  expires_at: string | null;
  auto_renew: number;
  nameservers: string;
  whois: string;
  ssl_expires_at: string | null;
  ssl_issuer: string | null;
  notes: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export function rowToDomain(row: DomainRow): Domain {
  return {
    ...row,
    status: row.status as Domain["status"],
    auto_renew: row.auto_renew === 1,
    nameservers: JSON.parse(row.nameservers || "[]"),
    whois: JSON.parse(row.whois || "{}"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

// ============================================================
// Domain CRUD
// ============================================================

export interface CreateDomainInput {
  name: string;
  registrar?: string;
  status?: Domain["status"];
  registered_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  nameservers?: string[];
  whois?: Record<string, unknown>;
  ssl_expires_at?: string;
  ssl_issuer?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function createDomain(input: CreateDomainInput): Domain {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const nameservers = JSON.stringify(input.nameservers || []);
  const whois = JSON.stringify(input.whois || {});
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO domains (id, name, registrar, status, registered_at, expires_at, auto_renew, nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.registrar || null,
    input.status || "active",
    input.registered_at || null,
    input.expires_at || null,
    input.auto_renew !== undefined ? (input.auto_renew ? 1 : 0) : 1,
    nameservers,
    whois,
    input.ssl_expires_at || null,
    input.ssl_issuer || null,
    input.notes || null,
    metadata
  );

  return getDomain(id)!;
}

export function getDomain(id: string): Domain | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domains WHERE id = ?").get(id) as DomainRow | null;
  return row ? rowToDomain(row) : null;
}

export interface ListDomainsOptions {
  search?: string;
  status?: Domain["status"];
  registrar?: string;
  limit?: number;
  offset?: number;
}

export function listDomains(options: ListDomainsOptions = {}): Domain[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR registrar LIKE ? OR notes LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.registrar) {
    conditions.push("registrar = ?");
    params.push(options.registrar);
  }

  let sql = "SELECT * FROM domains";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";


  if (options.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  if (options.offset !== undefined && options.offset > 0) {
    if (options.limit === undefined) {
      // SQLite requires LIMIT when OFFSET is present.
      sql += " LIMIT -1";
    }
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as DomainRow[];
  return rows.map(rowToDomain);
}

export interface UpdateDomainInput {
  name?: string;
  registrar?: string;
  status?: Domain["status"];
  registered_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  nameservers?: string[];
  whois?: Record<string, unknown>;
  ssl_expires_at?: string;
  ssl_issuer?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function updateDomain(id: string, input: UpdateDomainInput): Domain | null {
  const db = getDatabase();
  const existing = getDomain(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.registrar !== undefined) {
    sets.push("registrar = ?");
    params.push(input.registrar);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.registered_at !== undefined) {
    sets.push("registered_at = ?");
    params.push(input.registered_at);
  }
  if (input.expires_at !== undefined) {
    sets.push("expires_at = ?");
    params.push(input.expires_at);
  }
  if (input.auto_renew !== undefined) {
    sets.push("auto_renew = ?");
    params.push(input.auto_renew ? 1 : 0);
  }
  if (input.nameservers !== undefined) {
    sets.push("nameservers = ?");
    params.push(JSON.stringify(input.nameservers));
  }
  if (input.whois !== undefined) {
    sets.push("whois = ?");
    params.push(JSON.stringify(input.whois));
  }
  if (input.ssl_expires_at !== undefined) {
    sets.push("ssl_expires_at = ?");
    params.push(input.ssl_expires_at);
  }
  if (input.ssl_issuer !== undefined) {
    sets.push("ssl_issuer = ?");
    params.push(input.ssl_issuer);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE domains SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDomain(id);
}

export function deleteDomain(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM domains WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countDomains(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM domains").get() as { count: number };
  return row.count;
}

export function searchDomains(query: string): Domain[] {
  return listDomains({ search: query });
}

export function getByRegistrar(registrar: string): Domain[] {
  return listDomains({ registrar });
}

export function listExpiring(days: number): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE expires_at IS NOT NULL
         AND expires_at <= datetime('now', '+' || ? || ' days')
         AND expires_at >= datetime('now')
         AND status = 'active'
       ORDER BY expires_at`
    )
    .all(days) as DomainRow[];
  return rows.map(rowToDomain);
}

export function listSslExpiring(days: number): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE ssl_expires_at IS NOT NULL
         AND ssl_expires_at <= datetime('now', '+' || ? || ' days')
         AND ssl_expires_at >= datetime('now')
       ORDER BY ssl_expires_at`
    )
    .all(days) as DomainRow[];
  return rows.map(rowToDomain);
}

export interface DomainStats {
  total: number;
  active: number;
  expired: number;
  transferring: number;
  redemption: number;
  auto_renew_enabled: number;
  expiring_30_days: number;
  ssl_expiring_30_days: number;
}

export function getDomainStats(): DomainStats {
  const db = getDatabase();

  const total = (
    db.prepare("SELECT COUNT(*) as count FROM domains").get() as { count: number }
  ).count;

  const active = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'active'").get() as { count: number }
  ).count;

  const expired = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'expired'").get() as { count: number }
  ).count;

  const transferring = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'transferring'").get() as { count: number }
  ).count;

  const redemption = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'redemption'").get() as { count: number }
  ).count;

  const auto_renew_enabled = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE auto_renew = 1").get() as { count: number }
  ).count;

  const expiring_30_days = listExpiring(30).length;
  const ssl_expiring_30_days = listSslExpiring(30).length;

  return {
    total,
    active,
    expired,
    transferring,
    redemption,
    auto_renew_enabled,
    expiring_30_days,
    ssl_expiring_30_days,
  };
}

export function getDomainByName(name: string): Domain | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domains WHERE name = ?").get(name) as DomainRow | null;
  return row ? rowToDomain(row) : null;
}
