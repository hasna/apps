/**
 * Domain History — tracks WHOIS/RDAP/DNS/SSL snapshots over time per domain.
 * Each lookup creates a historical record so we can track ownership changes,
 * registrar changes, nameserver changes, etc.
 */

import { getDatabase } from "./database.js";
import { getDomainByIdentifier } from "./domain-records.js";

export interface DomainHistory {
  id: string;
  domain_id: string;
  snapshot_type: DomainHistoryType;
  raw_data: Record<string, unknown>;
  registrant_name: string | null;
  registrant_email: string | null;
  registrant_org: string | null;
  nameservers: string[];
  registrar: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
}

export type DomainHistoryType = (typeof HISTORY_TYPES)[number];

export const HISTORY_TYPES = [
  "whois",
  "rdap",
  "dns",
  "ssl",
  "reputation",
  "exa_research",
  "purchase",
  "renewal",
] as const;

interface DomainHistoryRow {
  id: string;
  domain_id: string;
  snapshot_type: string;
  raw_data: string;
  registrant_name: string | null;
  registrant_email: string | null;
  registrant_org: string | null;
  nameservers: string;
  registrar: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
}

function rowToDomainHistory(row: DomainHistoryRow): DomainHistory {
  return {
    ...row,
    snapshot_type: row.snapshot_type as DomainHistoryType,
    raw_data: JSON.parse(row.raw_data),
    nameservers: JSON.parse(row.nameservers),
  };
}

export interface CreateHistoryEntryInput {
  domain_id: string;
  snapshot_type: DomainHistoryType;
  raw_data?: Record<string, unknown>;
  registrant_name?: string;
  registrant_email?: string;
  registrant_org?: string;
  nameservers?: string[];
  registrar?: string;
  status?: string;
  notes?: string;
}

/**
 * Create a new history entry for a domain.
 */
export function createHistoryEntry(
  input: CreateHistoryEntryInput
): DomainHistory {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO domain_history (id, domain_id, snapshot_type, raw_data, registrant_name, registrant_email, registrant_org, nameservers, registrar, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.domain_id,
    input.snapshot_type,
    JSON.stringify(input.raw_data ?? {}),
    input.registrant_name ?? null,
    input.registrant_email ?? null,
    input.registrant_org ?? null,
    JSON.stringify(input.nameservers ?? []),
    input.registrar ?? null,
    input.status ?? null,
    input.notes ?? null
  );

  return getHistoryEntry(id)!;
}

/**
 * Get a single history entry by ID.
 */
export function getHistoryEntry(id: string): DomainHistory | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domain_history WHERE id = ?").get(id) as
    | DomainHistoryRow
    | null;
  return row ? rowToDomainHistory(row) : null;
}

/**
 * Get all history entries for a domain, newest first.
 */
export function getHistoryByDomain(
  domainId: string,
  options?: { type?: DomainHistoryType; limit?: number }
): DomainHistory[] {
  const db = getDatabase();
  const conditions = ["domain_id = ?"];
  const params: (string | number)[] = [domainId];

  if (options?.type) {
    conditions.push("snapshot_type = ?");
    params.push(options.type);
  }

  let sql =
    "SELECT * FROM domain_history WHERE " +
    conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  if (options?.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as DomainHistoryRow[];
  return rows.map(rowToDomainHistory);
}

/**
 * Get history entries within a date range.
 */
export function getHistoryByDateRange(
  startDate: string,
  endDate: string,
  domainId?: string
): DomainHistory[] {
  const db = getDatabase();
  const conditions = ["created_at BETWEEN ? AND ?"];
  const params: (string | number)[] = [startDate, endDate];

  if (domainId) {
    conditions.push("domain_id = ?");
    params.push(domainId);
  }

  const sql =
    "SELECT * FROM domain_history WHERE " +
    conditions.join(" AND ") +
    " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as DomainHistoryRow[];
  return rows.map(rowToDomainHistory);
}

/**
 * Get the latest snapshot of a given type for a domain.
 */
export function getLatestSnapshot(
  domainId: string,
  type: DomainHistoryType
): DomainHistory | null {
  const db = getDatabase();
  const row = db.prepare(
    "SELECT * FROM domain_history WHERE domain_id = ? AND snapshot_type = ? ORDER BY created_at DESC LIMIT 1"
  ).get(domainId, type) as DomainHistoryRow | null;
  return row ? rowToDomainHistory(row) : null;
}

/**
 * Get the latest history entry for a domain by domain name.
 */
export function getLatestByDomainName(
  domainName: string,
  type?: DomainHistoryType
): DomainHistory | null {
  const domain = getDomainByIdentifier(domainName);
  if (!domain) return null;
  return getLatestSnapshot(
    domain.id,
    type ?? (HISTORY_TYPES[0] as DomainHistoryType)
  );
}

/**
 * List all domains that have any history entries.
 * Returns structured data with the domain name and latest snapshot info.
 */
export function listDomainsWithHistoryChanges(): {
  domain_id: string;
  domain_name: string;
  latest_snapshot_type: string;
  latest_snapshot_at: string;
  snapshot_count: number;
}[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
    SELECT d.id as domain_id, d.name as domain_name,
           h.snapshot_type as latest_snapshot_type,
           MAX(h.created_at) as latest_snapshot_at,
           COUNT(h.id) as snapshot_count
    FROM domains d
    JOIN domain_history h ON d.id = h.domain_id
    GROUP BY d.id
    ORDER BY latest_snapshot_at DESC
  `
    )
    .all() as {
    domain_id: string;
    domain_name: string;
    latest_snapshot_type: string;
    latest_snapshot_at: string;
    snapshot_count: number;
  }[];

  return rows;
}

/**
 * Delete a history entry.
 */
export function deleteHistoryEntry(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM domain_history WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

/**
 * Delete all history for a domain.
 */
export function deleteHistoryByDomain(domainId: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM domain_history WHERE domain_id = ?")
    .run(domainId);
  return result.changes > 0;
}
