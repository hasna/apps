import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import { getDatabase, runInTransaction } from "./database.js";
import {
  MailboxFilterConflictError,
  MailboxFilterInputError,
  MailboxFilterNotFoundError,
  normalizeMailboxFilterName,
  normalizeMailboxFilterInput,
  normalizeMailboxFilterCriteria,
  normalizeMailboxFilterActions,
  mergeMailboxFilterActions,
  type MailboxFilter,
  type MailboxFilterActions,
  type MailboxFilterCriteria,
  type MailboxFilterInput,
} from "../lib/mailbox-filters.js";
import {
  actionsNeedLedgerWrite,
  applyMailboxFilterActionsToIds,
  createLocalMailboxFilterActionWriter,
  mailboxFilterMatchRows,
  type MailboxFilterApplyCounts,
} from "./mailbox-filter-runtime.local.js";
import { criteriaToMailboxListOptions } from "../lib/mailbox-filters.js";
import { listMailbox, type MailboxListOptions } from "../cli/tui/data.local.js";
import type { Mailbox, TuiMessage } from "../lib/mail-types.js";

const LOCAL_TENANT = "local";

interface FilterRow {
  id: string;
  tenant_id: string;
  name: string;
  normalized_name: string;
  mailbox: Mailbox;
  criteria_json: string;
  /** `"order"` is the reserved-word column; the row binder reads it as `order`. */
  order: number;
  actions_json: string;
  enabled: number;
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

function actionsOf(value: string): MailboxFilterActions {
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeMailboxFilterActions(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("stored mailbox filter actions is invalid JSON");
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
    actions: actionsOf(row.actions_json),
    enabled: row.enabled !== 0,
    order: row.order,
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
    `SELECT id, tenant_id, name, normalized_name, mailbox, criteria_json, "order", actions_json, enabled, created_at, updated_at
       FROM mailbox_filters
      WHERE tenant_id = ? AND (id = ? OR normalized_name = ?)
      LIMIT 1`,
  ).get(LOCAL_TENANT, value, normalized) as FilterRow | null;
}

export function listMailboxFilters(options: { limit?: number; offset?: number } = {}, db = getDatabase()): MailboxFilter[] {
  const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 100)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const rows = db.query(
    `SELECT id, tenant_id, name, normalized_name, mailbox, criteria_json, "order", actions_json, enabled, created_at, updated_at
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
        (id, tenant_id, name, normalized_name, mailbox, criteria_json, actions_json, enabled, "order")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      LOCAL_TENANT,
      normalized.name,
      normalized.normalized_name,
      normalized.mailbox,
      JSON.stringify(normalized.criteria),
      JSON.stringify(normalized.actions),
      normalized.enabled ? 1 : 0,
      normalized.order,
    );
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
  // merges the criteria objects. New fields are preserved when omitted from
  // either verb. PATCH merges a supplied actions object over the current one;
  // PUT replaces a supplied actions object, normalizing omitted action members
  // to their defaults.
  const criteria = options.replaceCriteria
    ? (input.criteria ?? {})
    : { ...current.criteria, ...(input.criteria ?? {}) };
  const actions = options.replaceCriteria
    ? (input.actions === undefined ? current.actions : input.actions)
    : mergeMailboxFilterActions(current.actions, input.actions);
  const normalized = normalizeMailboxFilterInput({
    name: input.name ?? current.name,
    mailbox: input.mailbox ?? input.folder ?? current.mailbox,
    criteria,
    actions,
    enabled: input.enabled ?? current.enabled,
    order: input.order ?? current.order,
  });
  try {
    db.query(
      `UPDATE mailbox_filters
          SET name = ?, normalized_name = ?, mailbox = ?, criteria_json = ?, actions_json = ?, enabled = ?, "order" = ?, updated_at = datetime('now')
        WHERE tenant_id = ? AND id = ?`,
    ).run(
      normalized.name,
      normalized.normalized_name,
      normalized.mailbox,
      JSON.stringify(normalized.criteria),
      JSON.stringify(normalized.actions),
      normalized.enabled ? 1 : 0,
      normalized.order,
      LOCAL_TENANT,
      current.id,
    );
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

/** Result of a list-only apply (unchanged from before FR-0001). */
export interface MailboxFilterListApplyResult {
  filter: Pick<MailboxFilter, "name" | "criteria">;
  items: TuiMessage[];
  limit: number;
  offset: number;
  truncated: boolean;
}

/** Result of `{"mutate":true}` apply: counts, no mailbox rows. */
export interface MailboxFilterMutateApplyResult extends MailboxFilterApplyCounts {
  filter: Pick<MailboxFilter, "name" | "criteria">;
  items: never[];
  limit: number;
  offset: 0;
  truncated: false;
  mutate: true;
}

export type MailboxFilterApplyResult = MailboxFilterListApplyResult | MailboxFilterMutateApplyResult;

/**
 * Apply a filter. Without `mutate` this lists the matching mailbox (previous
 * behavior, delegating to `listMailbox`). With `{"mutate":true}` it snapshots
 * the complete matching set, applies the filter's actions to that fixed set
 * inside one transaction, and reports counts — `items` is empty by contract.
 * Mutation requires an ENABLED filter and a zero offset (paging a shrinking
 * unread/inbox set would skip rows). Any matched row of the immutable legacy
 * sent ledger that an action would change is refused up front, so the
 * transaction rolls back instead of silently reporting success.
 */
export function applyMailboxFilter(
  filter: MailboxFilter,
  page: { limit?: number; offset?: number; mutate?: boolean } = {},
  db = getDatabase(),
): MailboxFilterApplyResult {
  const limit = Math.min(1000, Math.max(1, Math.trunc(page.limit ?? 100)));
  const offset = Math.max(0, Math.trunc(page.offset ?? 0));

  if (page.mutate === true) {
    if (!filter.enabled) {
      throw new MailboxFilterInputError(`filter "${filter.name}" is disabled; enable it before applying its actions`);
    }
    if (offset !== 0) {
      throw new MailboxFilterInputError("mutate apply does not paginate; offset must be 0");
    }
    // Snapshot the complete matching set BEFORE any write. Rows of the legacy
    // sent ledger cannot hold read/archive/label state; applying an action that
    // would change them is refused so nothing partial is reported.
    const matches = mailboxFilterMatchRows(filter.mailbox, filter.criteria, db);
    if (actionsNeedLedgerWrite(filter.actions) && matches.some((match) => match.table === "emails")) {
      throw new MailboxFilterInputError(
        `filter "${filter.name}" matches a row of the legacy sent ledger, which cannot store read, archive, spam, trash or label state`,
      );
    }
    const writer = createLocalMailboxFilterActionWriter(db);
    const counts = runInTransaction(db, () => applyMailboxFilterActionsToIds(matches, filter.actions, writer));
    return {
      filter: { name: filter.name, criteria: filter.criteria },
      items: [],
      limit,
      offset: 0,
      truncated: false,
      mutate: true,
      ...counts,
    };
  }

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
