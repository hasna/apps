import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import { getDatabase } from "./database.js";
import {
  MailboxFilterConflictError,
  MailboxFilterNotFoundError,
  normalizeMailboxFilterName,
  normalizeMailboxFilterInput,
  normalizeMailboxFilterCriteria,
  type MailboxFilter,
  type MailboxFilterCriteria,
  type MailboxFilterInput,
} from "../lib/mailbox-filters.js";
import { criteriaToMailboxListOptions } from "../lib/mailbox-filters.js";
import { listMailbox, type MailboxListOptions } from "../cli/tui/data.sqlite.js";
import type { Mailbox, TuiMessage } from "../lib/mail-types.js";

const LOCAL_TENANT = "local";

interface FilterRow {
  id: string;
  tenant_id: string;
  name: string;
  normalized_name: string;
  mailbox: Mailbox;
  criteria_json: string;
  created_at: string;
  updated_at: string;
}

function criteriaOf(value: string): MailboxFilterCriteria {
  try {
    const parsed = JSON.parse(value) as Partial<MailboxFilterCriteria>;
    return normalizeMailboxFilterCriteria(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("stored mailbox filter criteria is invalid JSON");
    throw error;
  }
}

function toFilter(row: FilterRow): MailboxFilter {
  return {
    id: row.id,
    name: row.name,
    normalized_name: row.normalized_name,
    mailbox: row.mailbox,
    criteria: criteriaOf(row.criteria_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function resolveFilterRow(identifier: string, db: Database): FilterRow | null {
  const value = identifier.trim();
  if (!value) return null;
  let normalized = value.toLowerCase().replace(/\s+/g, "-").replaceAll("_", "-").slice(0, 64);
  try {
    normalized = normalizeMailboxFilterName(value);
  } catch {
    // An identifier may be a UUID; keep the conservative normalized candidate
    // for name lookup and let the id branch handle the exact identifier.
  }
  return db.query(
    `SELECT id, tenant_id, name, normalized_name, mailbox, criteria_json, created_at, updated_at
       FROM mailbox_filters
      WHERE tenant_id = ? AND (id = ? OR normalized_name = ?)
      LIMIT 1`,
  ).get(LOCAL_TENANT, value, normalized) as FilterRow | null;
}

export function listMailboxFilters(options: { limit?: number; offset?: number } = {}, db = getDatabase()): MailboxFilter[] {
  const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 100)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const rows = db.query(
    `SELECT id, tenant_id, name, normalized_name, mailbox, criteria_json, created_at, updated_at
       FROM mailbox_filters WHERE tenant_id = ?
      ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
  ).all(LOCAL_TENANT, limit, offset) as FilterRow[];
  return rows.map(toFilter);
}

export function getMailboxFilter(identifier: string, db = getDatabase()): MailboxFilter | null {
  const row = resolveFilterRow(identifier, db);
  return row ? toFilter(row) : null;
}

export function createMailboxFilter(input: MailboxFilterInput, db = getDatabase()): MailboxFilter {
  const normalized = normalizeMailboxFilterInput(input);
  const id = randomUUID();
  try {
    db.query(
      `INSERT INTO mailbox_filters
        (id, tenant_id, name, normalized_name, mailbox, criteria_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, LOCAL_TENANT, normalized.name, normalized.normalized_name, normalized.mailbox, JSON.stringify(normalized.criteria));
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new MailboxFilterConflictError(normalized.name);
    throw error;
  }
  return getMailboxFilter(id, db)!;
}

export function updateMailboxFilter(
  identifier: string,
  input: Partial<MailboxFilterInput>,
  options: { replaceCriteria?: boolean } = {},
  db = getDatabase(),
): MailboxFilter {
  const current = getMailboxFilter(identifier, db);
  if (!current) throw new MailboxFilterNotFoundError(identifier);
  // PUT replaces criteria wholesale (parity with the self-hosted store); PATCH
  // merges the criteria objects.
  const criteria = options.replaceCriteria
    ? (input.criteria ?? {})
    : { ...current.criteria, ...(input.criteria ?? {}) };
  const normalized = normalizeMailboxFilterInput({
    name: input.name ?? current.name,
    mailbox: input.mailbox ?? input.folder ?? current.mailbox,
    criteria,
  });
  try {
    db.query(
      `UPDATE mailbox_filters
          SET name = ?, normalized_name = ?, mailbox = ?, criteria_json = ?, updated_at = datetime('now')
        WHERE tenant_id = ? AND id = ?`,
    ).run(normalized.name, normalized.normalized_name, normalized.mailbox, JSON.stringify(normalized.criteria), LOCAL_TENANT, current.id);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new MailboxFilterConflictError(normalized.name);
    throw error;
  }
  return getMailboxFilter(current.id, db)!;
}

export function deleteMailboxFilter(identifier: string, db = getDatabase()): void {
  const current = getMailboxFilter(identifier, db);
  if (!current) throw new MailboxFilterNotFoundError(identifier);
  db.query("DELETE FROM mailbox_filters WHERE tenant_id = ? AND id = ?").run(LOCAL_TENANT, current.id);
}

export function applyMailboxFilter(
  filter: MailboxFilter,
  page: { limit?: number; offset?: number } = {},
  db = getDatabase(),
): { filter: Pick<MailboxFilter, "name" | "criteria">; items: TuiMessage[]; limit: number; offset: number; truncated: boolean } {
  const limit = Math.min(1000, Math.max(1, Math.trunc(page.limit ?? 100)));
  const offset = Math.max(0, Math.trunc(page.offset ?? 0));
  const options = criteriaToMailboxListOptions(filter.mailbox, filter.criteria, { limit: limit + 1, offset });
  const rows = listMailbox(filter.mailbox as Mailbox, options as MailboxListOptions, db);
  return {
    filter: { name: filter.name, criteria: filter.criteria },
    items: rows.slice(0, limit),
    limit,
    offset,
    truncated: rows.length > limit,
  };
}
