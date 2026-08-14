/**
 * DNS record types and CRUD operations
 */

import { getDatabase } from "./database.js";
import type { SQLQueryBindings } from "bun:sqlite";

// --- DNS Record types ---

export interface DnsRecord {
  id: string;
  domain_id: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV";
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  created_at: string;
}

interface DnsRecordRow {
  id: string;
  domain_id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  created_at: string;
}

export function rowToDnsRecord(row: DnsRecordRow): DnsRecord {
  return {
    ...row,
    type: row.type as DnsRecord["type"],
  };
}

// ============================================================
// DNS Record CRUD
// ============================================================

export interface CreateDnsRecordInput {
  domain_id: string;
  type: DnsRecord["type"];
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export function createDnsRecord(input: CreateDnsRecordInput): DnsRecord {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO dns_records (id, domain_id, type, name, value, ttl, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.domain_id,
    input.type,
    input.name,
    input.value,
    input.ttl ?? 3600,
    input.priority ?? null
  );

  return getDnsRecord(id)!;
}

export function getDnsRecord(id: string): DnsRecord | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM dns_records WHERE id = ?").get(id) as DnsRecordRow | null;
  return row ? rowToDnsRecord(row) : null;
}

export function listDnsRecords(domainId: string, type?: DnsRecord["type"]): DnsRecord[] {
  const db = getDatabase();
  let sql = "SELECT * FROM dns_records WHERE domain_id = ?";
  const params: SQLQueryBindings[] = [domainId];

  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }

  sql += " ORDER BY type, name";

  const rows = db.prepare(sql).all(...params) as DnsRecordRow[];
  return rows.map(rowToDnsRecord);
}

export interface UpdateDnsRecordInput {
  type?: DnsRecord["type"];
  name?: string;
  value?: string;
  ttl?: number;
  priority?: number;
}

export function updateDnsRecord(id: string, input: UpdateDnsRecordInput): DnsRecord | null {
  const db = getDatabase();
  const existing = getDnsRecord(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.type !== undefined) {
    sets.push("type = ?");
    params.push(input.type);
  }
  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.value !== undefined) {
    sets.push("value = ?");
    params.push(input.value);
  }
  if (input.ttl !== undefined) {
    sets.push("ttl = ?");
    params.push(input.ttl);
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    params.push(input.priority);
  }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(
    `UPDATE dns_records SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDnsRecord(id);
}

export function deleteDnsRecord(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM dns_records WHERE id = ?").run(id);
  return result.changes > 0;
}
