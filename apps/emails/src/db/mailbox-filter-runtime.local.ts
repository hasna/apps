/**
 * SQLite runtime for mailbox-filter ACTIONS (FR-0001).
 *
 * Houses the enabled-filter selection (ordered `"order" ASC, id ASC` — the
 * public list's `updated_at DESC` ordering is deliberately NOT inherited),
 * the folder/criteria MATCHING predicates, and the action-application drivers
 * used by ingestion (`store-sqlite/messages.ts` insert hook) and backfill
 * (`POST …/apply` with `{"mutate":true}`).
 *
 * MATCHING lives here, not in `cli/tui/data.local.ts`. The plan asked for the
 * exact-ID selector to be extracted from `data.local.ts`, but that file's
 * export surface feeds `cli/tui/data.ts`, whose `localCompat as typeof remote`
 * assertion breaks the moment `data.local.ts` exports a value `data.remote.ts`
 * does not also export — and these SQLite predicates have no remote analogue
 * (the self-hosted remote layer is API-backed). So the folder predicates below
 * are a faithful, self-contained mirror of the corresponding private builders
 * in `data.local.ts` (`mailboxCriteriaClause`, `searchClause`, `labelClause`,
 * `FOLDER_WHERE`): filters never carry a `source`, so every source clause
 * collapses to empty and the mirror only has to reproduce the folder + search +
 * label + criteria fragment of `listMailbox`. Parity is covered by tests that
 * exercise `%`, `_`, exact recipient/address matching, labels and date bounds.
 *
 * Actions are applied through a caller-supplied writer so the store seam
 * (`store-sqlite/messages.ts`) can route every write through its one
 * `applyStatusPatch` path, while the API/TUI raw path uses the `db/inbound`
 * writers — no circular dependency on the messages repository either way.
 */
import type { Database } from "./database.js";
import { getDatabase } from "./database.js";
import { sqlEmailAddress, sqlEmailDomain } from "./email-address-sql.js";
import { addInboundLabel, setInboundArchivedFlag, setInboundReadFlag } from "./inbound.local.js";
import {
  criteriaToMailboxListOptions,
  type MailboxFilterActions,
  type MailboxFilterCriteria,
} from "../lib/mailbox-filters.js";
import {
  labelNameAliases,
  MAILBOXES,
  normalizeIsoDate,
  type Mailbox,
  type MailboxListOptions,
} from "../lib/mail-types.js";

const LOCAL_TENANT = "local";

/** Folder labels live in boolean columns, not the label blob — mirroring `applyStatusPatch`. */
const FOLDER_LABEL_COLUMNS: Readonly<Record<string, "is_archived" | "is_spam" | "is_trash">> = {
  archived: "is_archived",
  spam: "is_spam",
  trash: "is_trash",
};

export interface EnabledMailboxFilter {
  id: string;
  name: string;
  mailbox: Mailbox;
  criteria: MailboxFilterCriteria;
  actions: MailboxFilterActions;
}

interface FilterRow {
  id: string;
  name: string;
  mailbox: string;
  criteria_json: string;
  actions_json: string;
}

function jsonObject(value: string, field: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error(`stored mailbox filter ${field} is invalid JSON`);
  }
}

/**
 * Every ENABLED filter for the local tenant, in automatic-execution order
 * (`"order" ASC, id ASC`). New and migrated filters default to disabled, so an
 * empty result is the normal case until a filter is explicitly enabled.
 */
export function listEnabledMailboxFilters(db: Database = getDatabase()): EnabledMailboxFilter[] {
  const rows = db.query(
    `SELECT id, name, mailbox, criteria_json, actions_json
       FROM mailbox_filters
      WHERE tenant_id = ? AND enabled = 1
      ORDER BY "order" ASC, id ASC`,
  ).all(LOCAL_TENANT) as FilterRow[];
  return rows.map((row): EnabledMailboxFilter => {
    const mailbox = row.mailbox.trim().toLowerCase();
    const actions = jsonObject(row.actions_json, "actions");
    return {
      id: row.id,
      name: row.name,
      mailbox: (MAILBOXES as readonly string[]).includes(mailbox) ? (mailbox as Mailbox) : "inbox",
      criteria: jsonObject(row.criteria_json, "criteria") as MailboxFilterCriteria,
      actions: {
        add_labels: Array.isArray(actions.add_labels)
          ? actions.add_labels.map((label) => String(label))
          : [],
        archive: actions.archive === true,
        mark_read: actions.mark_read === true,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Matching predicates.
//
// These mirror `cli/tui/data.local.ts`'s private mailboxCriteriaClause /
// searchClause / labelClause / FOLDER_WHERE for the SOURCE-FREE case a filter
// always is. Any change to listMailbox's WHERE construction must be mirrored
// here (and vice-versa); the tests in mailbox-filters.local.test.ts and
// store-sqlite.test.ts guard the observable parity.
// ---------------------------------------------------------------------------

interface SqlClause {
  sql: string;
  params: string[];
}

/** Physical row a filter matched. The legacy sent ledger cannot hold actions. */
export interface MailboxFilterMatchRow {
  id: string;
  /** `inbound_emails` rows can carry every action; `emails` rows are immutable. */
  table: "inbound_emails" | "emails";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function sincePredicate(column: string): string {
  return `julianday(${column}) >= julianday(?)`;
}

const PRIORITY_MATCH_SQL = `EXISTS (
  SELECT 1 FROM priority_sender_rules rule
   WHERE (rule.kind = 'address' AND rule.value = ${sqlEmailAddress("inbound_emails.from_address")})
      OR (rule.kind = 'domain' AND rule.value = ${sqlEmailDomain("inbound_emails.from_address")})
)`;

const SPAM_LABEL_SQL = "is_spam = 1";
const TRASH_LABEL_SQL = "is_trash = 1";
const NOT_SPAM_OR_TRASH_SQL = "is_spam = 0 AND is_trash = 0";

/** The receiving-folders arm of listMailbox's FOLDER_WHERE. */
const FOLDER_WHERE: Readonly<Record<Exclude<Mailbox, "sent">, string>> = {
  inbox: `is_sent = 0 AND is_archived = 0 AND ${NOT_SPAM_OR_TRASH_SQL}`,
  priority: `is_sent = 0 AND is_archived = 0 AND ${NOT_SPAM_OR_TRASH_SQL} AND ${PRIORITY_MATCH_SQL}`,
  unread: `is_sent = 0 AND is_read = 0 AND is_archived = 0 AND ${NOT_SPAM_OR_TRASH_SQL}`,
  starred: `is_sent = 0 AND is_starred = 1 AND is_archived = 0 AND ${NOT_SPAM_OR_TRASH_SQL}`,
  archived: `is_sent = 0 AND is_archived = 1 AND ${NOT_SPAM_OR_TRASH_SQL}`,
  spam: `is_sent = 0 AND ${SPAM_LABEL_SQL}`,
  trash: `is_sent = 0 AND ${TRASH_LABEL_SQL}`,
};

function addressDomainParams(domain: string): [string] {
  return [domain.toLowerCase()];
}

function addressDomainSql(column: string): string {
  return `${sqlEmailDomain(column)} = ?`;
}

function labelClause(label: string | undefined): SqlClause {
  const aliases = labelNameAliases(label ?? "");
  if (aliases.length === 0) return { sql: "", params: [] };
  return {
    sql: ` AND EXISTS (
      SELECT 1
        FROM inbound_labels label
       WHERE label.inbound_email_id = inbound_emails.id
         AND label.label IN (${aliases.map(() => "?").join(", ")})
    )`,
    params: aliases,
  };
}

function searchClause(search: string | undefined, columns: string[]): SqlClause {
  const q = search?.trim().toLowerCase();
  if (!q) return { sql: "", params: [] };
  const like = `%${escapeLike(q)}%`;
  return {
    sql: ` AND (${columns.map((column) => `LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '\\'`).join(" OR ")})`,
    params: columns.map(() => like),
  };
}

/**
 * Criteria clause, mirroring mailboxCriteriaClause. For `alias` non-empty it
 * qualifies every column (the app-sent arm of the sent mailbox); otherwise the
 * unqualified `inbound_emails` columns are used. Exact recipient semantics are
 * preserved: `to`/`address`/`domain` never do substring matching on the
 * receiving folders.
 */
function mailboxCriteriaClause(
  opts: MailboxListOptions,
  alias = "",
  receivedColumn = "received_at",
  includeFlags = true,
  includeRecipients = true,
): SqlClause {
  const prefix = alias ? `${alias}.` : "";
  const params: string[] = [];
  const clauses: string[] = [];
  const contains = (column: string, value: string | undefined): void => {
    const q = value?.trim().toLowerCase();
    if (!q) return;
    clauses.push(`LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLike(q)}%`);
  };
  contains(`${prefix}from_address`, opts.from);
  contains(`${prefix}subject`, opts.subject);
  if (opts.to?.trim()) {
    const to = opts.to.trim().toLowerCase();
    if (includeRecipients) {
      clauses.push(`EXISTS (
        SELECT 1 FROM inbound_recipients filter_recipient
         WHERE filter_recipient.inbound_email_id = ${prefix}id
           AND filter_recipient.address = ?
      )`);
    } else {
      clauses.push(`EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(${prefix}to_addresses) THEN ${prefix}to_addresses ELSE '[]' END) AS filter_recipient
         WHERE ${sqlEmailAddress("json_extract(filter_recipient.value, '$')")} = ?
      )`);
    }
    params.push(to);
  }
  if (opts.address?.trim()) {
    const address = opts.address.trim().toLowerCase();
    if (includeRecipients) {
      clauses.push(`(${sqlEmailAddress(`${prefix}from_address`)} = ? OR EXISTS (
        SELECT 1 FROM inbound_recipients filter_recipient
         WHERE filter_recipient.inbound_email_id = ${prefix}id
           AND filter_recipient.address = ?
      ))`);
    } else {
      clauses.push(`(${sqlEmailAddress(`${prefix}from_address`)} = ? OR EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(${prefix}to_addresses) THEN ${prefix}to_addresses ELSE '[]' END) AS filter_recipient
         WHERE ${sqlEmailAddress("json_extract(filter_recipient.value, '$')")} = ?
      ))`);
    }
    params.push(address, address);
  }
  if (opts.domain?.trim()) {
    const domain = opts.domain.trim().toLowerCase();
    if (includeRecipients) {
      clauses.push(`(${addressDomainSql(`${prefix}from_address`)} OR EXISTS (
        SELECT 1 FROM inbound_recipients filter_recipient
         WHERE filter_recipient.inbound_email_id = ${prefix}id
           AND filter_recipient.domain = ?
      ))`);
      params.push(...addressDomainParams(domain), domain);
    } else {
      clauses.push(`(${addressDomainSql(`${prefix}from_address`)} OR ${sqlEmailDomain(`${prefix}to_addresses`)} = ?)`);
      params.push(...addressDomainParams(domain), ...addressDomainParams(domain));
    }
  }
  if (includeFlags) {
    if (opts.read === true) clauses.push(`${prefix}is_read = 1`);
    if (opts.unread === true) clauses.push(`${prefix}is_read = 0`);
    if (opts.starred === true) clauses.push(`${prefix}is_starred = 1`);
    if (opts.archived === true) clauses.push(`${prefix}is_archived = 1`);
  } else if (opts.unread === true || opts.starred === true || opts.archived === true) {
    clauses.push("0 = 1");
  }
  const since = normalizeIsoDate(opts.since);
  const until = normalizeIsoDate(opts.until);
  if (since) { clauses.push(`${prefix}${receivedColumn} >= ?`); params.push(since); }
  if (until) { clauses.push(`${prefix}${receivedColumn} <= ?`); params.push(until); }
  return clauses.length ? { sql: ` AND ${clauses.map((clause) => `(${clause})`).join(" AND ")}`, params } : { sql: "", params: [] };
}

/** The app-sent arm's own filter of `listMailbox`'s sent branch (source-free). */
function appSentSearchWhere(search: string | undefined, includeAppSent: boolean): SqlClause {
  const params: string[] = [];
  const where: string[] = [];
  if (!includeAppSent) where.push("0 = 1");
  const searchTerm = search?.trim().toLowerCase();
  if (searchTerm) {
    const like = `%${escapeLike(searchTerm)}%`;
    where.push("(LOWER(COALESCE(e.subject, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(e.from_address, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(e.to_addresses, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.text_body, '')) LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  return { sql: where.length ? ` WHERE ${where.join(" AND ")}` : "", params };
}

function receivingFolderOf(mailbox: Mailbox): Exclude<Mailbox, "sent"> {
  const value = mailbox.trim().toLowerCase() as Mailbox;
  if (value !== "sent" && (MAILBOXES as readonly string[]).includes(value)) {
    return value as Exclude<Mailbox, "sent">;
  }
  return "inbox";
}

/** Options for a filter, mapped from its criteria exactly as `listMailbox` expects. */
function optionsOf(mailbox: Mailbox, criteria: MailboxFilterCriteria): MailboxListOptions {
  const converted = criteriaToMailboxListOptions(mailbox, criteria);
  void converted.mailbox;
  return {
    search: converted.search,
    from: converted.from,
    to: converted.to,
    domain: converted.domain,
    address: converted.address,
    subject: converted.subject,
    label: converted.label,
    read: converted.read,
    unread: converted.unread,
    starred: converted.starred,
    archived: converted.archived,
    since: converted.since,
    until: converted.until,
  };
}

/**
 * All rows currently matching a filter — receiving folders match
 * `inbound_emails`; the sent mailbox matches the sent union (app-sent `emails`
 * plus synced `inbound_emails` where `is_sent = 1`), mirroring listMailbox.
 * Returns the physical table so callers can refuse actions on the immutable
 * legacy ledger.
 */
export function mailboxFilterMatchRows(
  mailbox: Mailbox,
  criteria: MailboxFilterCriteria,
  db: Database = getDatabase(),
): MailboxFilterMatchRow[] {
  const options = optionsOf(mailbox, criteria);
  const folder = receivingFolderOf(mailbox);

  if (mailbox !== "sent") {
    const search = searchClause(options.search, ["subject", "from_address", "to_addresses", "text_body"]);
    const label = labelClause(options.label);
    const since = normalizeIsoDate(options.since);
    const sinceSql = since ? ` AND ${sincePredicate("received_at")}` : "";
    const criteriaSql = mailboxCriteriaClause(options);
    const rows = db.query(
      `SELECT id FROM inbound_emails
        WHERE ${FOLDER_WHERE[folder]}${search.sql}${label.sql}${sinceSql}${criteriaSql.sql}`,
    ).all(...search.params, ...label.params, ...(since ? [since] : []), ...criteriaSql.params) as Array<{ id: string }>;
    return rows.map((row) => ({ id: row.id, table: "inbound_emails" as const }));
  }

  // Sent mailbox: the union listMailbox produces. Filters never carry a source,
  // so the sender/source clauses drop out and the synced arm is just is_sent=1.
  const includeAppSent = !options.label;
  const appSearch = appSentSearchWhere(options.search, includeAppSent);
  const appSince = normalizeIsoDate(options.since);
  const appSrc = appSince
    ? { sql: `${appSearch.sql ? `${appSearch.sql} AND ${sincePredicate("e.sent_at")}` : ` WHERE ${sincePredicate("e.sent_at")}`}`, params: [...appSearch.params, appSince] }
    : appSearch;
  const appCriteria = mailboxCriteriaClause(options, "e", "sent_at", false, false);
  const syncedSearch = searchClause(options.search, ["subject", "from_address", "to_addresses", "text_body"]);
  const syncedLabel = labelClause(options.label);
  const syncedSince = normalizeIsoDate(options.since);
  const syncedSinceSql = syncedSince ? ` AND ${sincePredicate("received_at")}` : "";
  const syncedCriteria = mailboxCriteriaClause(options);

  const results: MailboxFilterMatchRow[] = [];
  const appRows = db.query(
    `SELECT e.id FROM emails e LEFT JOIN email_content c ON c.email_id = e.id${appSrc.sql}${appCriteria.sql}`,
  ).all(...appSrc.params, ...appCriteria.params) as Array<{ id: string }>;
  for (const row of appRows) results.push({ id: row.id, table: "emails" });
  const syncedRows = db.query(
    `SELECT id FROM inbound_emails
      WHERE is_sent = 1${syncedSearch.sql}${syncedLabel.sql}${syncedSinceSql}${syncedCriteria.sql}`,
  ).all(...syncedSearch.params, ...syncedLabel.params, ...(syncedSince ? [syncedSince] : []), ...syncedCriteria.params) as Array<{ id: string }>;
  for (const row of syncedRows) results.push({ id: row.id, table: "inbound_emails" });
  return results;
}

/**
 * Exact-ID match test: does the message `messageId` belong to the filter's
 * folder under its criteria? Used by the ingest hook after a row is inserted.
 * A newly inserted inbound message (is_sent = 0) never matches a sent-mailbox
 * filter, which is exactly the semantics listMailbox would give it.
 */
export function mailboxFilterMessageMatches(
  mailbox: Mailbox,
  criteria: MailboxFilterCriteria,
  messageId: string,
  db: Database = getDatabase(),
): boolean {
  const options = optionsOf(mailbox, criteria);
  const folder = receivingFolderOf(mailbox);

  if (mailbox !== "sent") {
    const search = searchClause(options.search, ["subject", "from_address", "to_addresses", "text_body"]);
    const label = labelClause(options.label);
    const since = normalizeIsoDate(options.since);
    const sinceSql = since ? ` AND ${sincePredicate("received_at")}` : "";
    const criteriaSql = mailboxCriteriaClause(options);
    const row = db.query(
      `SELECT 1 FROM inbound_emails
        WHERE ${FOLDER_WHERE[folder]}${search.sql}${label.sql}${sinceSql}${criteriaSql.sql} AND id = ?
        LIMIT 1`,
    ).get(...search.params, ...label.params, ...(since ? [since] : []), ...criteriaSql.params, messageId);
    return row !== null;
  }

  // Sent mailbox: an exact row can only be an is_sent = 1 inbound row or an
  // app-sent `emails` row. A just-inserted inbound row never is either.
  const syncedSearch = searchClause(options.search, ["subject", "from_address", "to_addresses", "text_body"]);
  const syncedLabel = labelClause(options.label);
  const syncedSince = normalizeIsoDate(options.since);
  const syncedSinceSql = syncedSince ? ` AND ${sincePredicate("received_at")}` : "";
  const syncedCriteria = mailboxCriteriaClause(options);
  const row = db.query(
    `SELECT 1 FROM inbound_emails
      WHERE is_sent = 1${syncedSearch.sql}${syncedLabel.sql}${syncedSinceSql}${syncedCriteria.sql} AND id = ?
      LIMIT 1`,
  ).get(...syncedSearch.params, ...syncedLabel.params, ...(syncedSince ? [syncedSince] : []), ...syncedCriteria.params, messageId);
  return row !== null;
}

// ---------------------------------------------------------------------------
// Action writers.
// ---------------------------------------------------------------------------

export interface MailboxFilterActionWriter {
  /**
   * Apply a filter's actions to one message, skipping actions the message
   * already satisfies. Returns true when at least one action changed the row.
   */
  apply(messageId: string, actions: MailboxFilterActions): boolean;
}

/**
 * Ingest hook: evaluate every enabled filter against a freshly inserted
 * message and apply matching filters' actions. State is re-read (through the
 * writer) between filters, so `order` composes: an earlier filter that archives
 * or marks-read a message stops a later "inbox + unread" filter from matching.
 * The caller owns the transaction; each `db` read/write joins it.
 */
export function applyEnabledMailboxFiltersToNewMessage(
  db: Database,
  messageId: string,
  writer: MailboxFilterActionWriter,
): void {
  for (const filter of listEnabledMailboxFilters(db)) {
    if (!mailboxFilterMessageMatches(filter.mailbox, filter.criteria, messageId, db)) continue;
    writer.apply(messageId, filter.actions);
  }
}

interface LocalMessageState {
  is_read: boolean;
  is_archived: boolean;
  is_spam: boolean;
  is_trash: boolean;
  /** Lowercased labels already on the row. */
  labels: Set<string>;
}

function localMessageState(db: Database, id: string): LocalMessageState | null {
  const row = db.query(
    "SELECT is_read, is_archived, is_spam, is_trash, label_ids_json FROM inbound_emails WHERE id = ?",
  ).get(id) as {
    is_read?: number;
    is_archived?: number;
    is_spam?: number;
    is_trash?: number;
    label_ids_json?: string | null;
  } | null;
  if (!row) return null;
  const labels = new Set<string>();
  try {
    for (const label of JSON.parse(row.label_ids_json ?? "[]") as unknown[]) {
      labels.add(String(label).trim().toLowerCase());
    }
  } catch {
    // A corrupt blob is treated as empty; the writer below only ever ADDS labels.
  }
  return {
    is_read: row.is_read === 1,
    is_archived: row.is_archived === 1,
    is_spam: row.is_spam === 1,
    is_trash: row.is_trash === 1,
    labels,
  };
}

/**
 * Raw-path action writer over `db/inbound` writers, used by the /api apply
 * route and the TUI. Reads current state first and never pushes a false-valued
 * action member: `archive:false` / `mark_read:false` are no-ops. Rows outside
 * `inbound_emails` (the legacy sent ledger) cannot be acted on and return
 * false; backfill callers detect those BEFORE applying (see
 * `applyMailboxFilter` in mailbox-filters.local.ts) so they can refuse instead
 * of silently reporting success.
 */
export function createLocalMailboxFilterActionWriter(db: Database = getDatabase()): MailboxFilterActionWriter {
  return {
    apply(messageId: string, actions: MailboxFilterActions): boolean {
      const state = localMessageState(db, messageId);
      if (!state) return false;
      let changed = false;
      if (actions.mark_read && !state.is_read) {
        setInboundReadFlag(messageId, true, db);
        state.is_read = true;
        changed = true;
      }
      if (actions.archive && !state.is_archived) {
        setInboundArchivedFlag(messageId, true, db);
        state.is_archived = true;
        changed = true;
      }
      for (const rawLabel of actions.add_labels) {
        const label = rawLabel.trim().toLowerCase();
        const column = FOLDER_LABEL_COLUMNS[label];
        if (column !== undefined) {
          if (!state[column]) {
            db.run(`UPDATE inbound_emails SET ${column} = 1 WHERE id = ?`, [messageId]);
            state[column] = true;
            changed = true;
          }
        } else if (!state.labels.has(label)) {
          addInboundLabel(messageId, label, db);
          state.labels.add(label);
          changed = true;
        }
      }
      return changed;
    },
  };
}

export interface MailboxFilterApplyCounts {
  /** Messages snapshotted as matching (mutate acts only on this fixed set). */
  matched: number;
  /** Distinct messages whose state changed. */
  updated: number;
  /** Matched messages that needed no change (every action already satisfied). */
  unchanged: number;
}

/** Apply one filter's actions to a pre-snapshotted id set, within the caller's transaction. */
export function applyMailboxFilterActionsToIds(
  ids: readonly MailboxFilterMatchRow[],
  actions: MailboxFilterActions,
  writer: MailboxFilterActionWriter,
): MailboxFilterApplyCounts {
  let updated = 0;
  for (const row of ids) {
    if (writer.apply(row.id, actions)) updated += 1;
  }
  return { matched: ids.length, updated, unchanged: ids.length - updated };
}

/** True when any action member would need a write the legacy sent ledger cannot hold. */
export function actionsNeedLedgerWrite(actions: MailboxFilterActions): boolean {
  return actions.mark_read || actions.archive || actions.add_labels.length > 0;
}
