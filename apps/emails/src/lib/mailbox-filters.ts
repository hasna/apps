import { MAILBOXES, normalizeLabel, type Mailbox, type MailboxListOptions } from "./mail-types.js";

export interface MailboxFilterCriteria {
  search?: string;
  from?: string;
  to?: string;
  domain?: string;
  address?: string;
  subject?: string;
  label?: string;
  read?: boolean;
  unread?: boolean;
  starred?: boolean;
  archived?: boolean;
  since?: string;
  until?: string;
}

/**
 * The ACTIONS a matching filter performs on a message: labels to add, archive
 * and mark-read. `archive:false` and `mark_read:false` mean "no action" — they
 * are never pushed as unarchive/unread status patches.
 */
export interface MailboxFilterActions {
  add_labels: string[];
  archive: boolean;
  mark_read: boolean;
}

export const DEFAULT_MAILBOX_FILTER_ACTIONS: MailboxFilterActions = {
  add_labels: [],
  archive: false,
  mark_read: false,
};

/** New and migrated filters default to disabled so nothing auto-acts on ingest. */
export function defaultMailboxFilterActions(): MailboxFilterActions {
  return { add_labels: [], archive: false, mark_read: false };
}

export interface MailboxFilter {
  id: string;
  /** Present on self-hosted responses; local SQLite is implicitly tenant-scoped. */
  tenant_id?: string;
  name: string;
  normalized_name: string;
  mailbox: Mailbox;
  criteria: MailboxFilterCriteria;
  /** Actions applied when an enabled filter matches a new message. */
  actions: MailboxFilterActions;
  /** Whether the filter auto-applies to newly imported messages. */
  enabled: boolean;
  /** Execution order for enabled filters: `order ASC, id ASC`. */
  order: number;
  created_at: string;
  updated_at: string;
}

export interface MailboxFilterInput {
  name: string;
  mailbox?: string;
  folder?: string;
  criteria?: Partial<MailboxFilterCriteria> & { folder?: string; mailbox?: string };
  /**
   * A canonical `MailboxFilterActions` object (the update path re-passes a
   * stored/normalized value) or a raw partial with extra members tolerated.
   * `normalizeMailboxFilterActions` accepts either at the boundary.
   */
  actions?: MailboxFilterActions | (Partial<MailboxFilterActions> & Record<string, unknown>);
  enabled?: boolean;
  order?: number;
}

/** Request body accepted by `POST …/{id}/apply`. */
export interface MailboxFilterApplyInput {
  mutate?: boolean;
}

export class MailboxFilterInputError extends Error {
  readonly code = "invalid_input";
  constructor(message: string) {
    super(message);
    this.name = "MailboxFilterInputError";
  }
}

export class MailboxFilterNotFoundError extends Error {
  readonly code = "not_found";
  constructor(identifier: string) {
    super(`mailbox filter not found: ${identifier}`);
    this.name = "MailboxFilterNotFoundError";
  }
}

export class MailboxFilterConflictError extends Error {
  readonly code = "conflict";
  constructor(name: string) {
    super(`mailbox filter name already exists: ${name}`);
    this.name = "MailboxFilterConflictError";
  }
}

/** The canonical name key used for uniqueness and name lookup. */
export function normalizeMailboxFilterName(value: string): string {
  const normalized = normalizeLabel(value).replaceAll("_", "-");
  if (!normalized) throw new MailboxFilterInputError("filter name is required");
  return normalized.slice(0, 64);
}

function normalizedString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new MailboxFilterInputError(`${field} must be a string`);
  const result = value.trim().toLowerCase();
  return result || undefined;
}

function normalizedDate(value: unknown, field: string): string | undefined {
  const result = normalizedString(value, field);
  if (!result) return undefined;
  const time = Date.parse(result);
  if (!Number.isFinite(time)) throw new MailboxFilterInputError(`${field} must be a valid date`);
  return new Date(time).toISOString();
}

function trueFlag(value: unknown, field: string): true | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value !== true) throw new MailboxFilterInputError(`${field} must be boolean`);
  return true;
}

function normalizedBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new MailboxFilterInputError(`${field} must be boolean`);
  return value;
}

function normalizedOrder(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new MailboxFilterInputError("order must be an integer");
  }
  if (value < 0 || value > 2147483647) {
    throw new MailboxFilterInputError("order must be between 0 and 2147483647");
  }
  return value;
}

function normalizedStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MailboxFilterInputError(`${field} must be an array of strings`);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new MailboxFilterInputError(`${field} entries must be strings`);
    const normalized = entry.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/**
 * Normalize a filter's ACTIONS block. Omitted actions default to no-op; labels
 * are trimmed/lowercased, emptied and deduplicated (first occurrence wins).
 * Booleans are strict — `"true"`, `1`, `"yes"` are refused, not coerced.
 */
export function normalizeMailboxFilterActions(value: unknown): MailboxFilterActions {
  if (value === undefined || value === null) return defaultMailboxFilterActions();
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new MailboxFilterInputError("actions must be an object");
  }
  const input = value as Record<string, unknown>;
  const add_labels = normalizedStringArray(input.add_labels, "actions.add_labels");
  const archive = normalizedBoolean(input.archive, "actions.archive");
  const mark_read = normalizedBoolean(input.mark_read, "actions.mark_read");
  return { add_labels, archive, mark_read };
}

/**
 * Shared validation for the `POST …/{id}/apply` request body. Absent/empty
 * bodies and `{"mutate":false}` keep the existing list-only behavior.
 */
export function normalizeMailboxFilterApplyBody(body: unknown): { mutate: boolean } {
  if (body === undefined || body === null) return { mutate: false };
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new MailboxFilterInputError("apply request body must be a JSON object");
  }
  const mutate = normalizedBoolean((body as Record<string, unknown>).mutate, "mutate");
  return { mutate };
}

/** Merge a raw PATCH actions object over the stored (canonical) actions. */
export function mergeMailboxFilterActions(
  current: MailboxFilterActions,
  patch: Partial<MailboxFilterActions> | undefined,
): MailboxFilterActions {
  if (patch === undefined) return current;
  return normalizeMailboxFilterActions({ ...current, ...patch });
}

export function normalizeMailboxFilterCriteria(
  value: Partial<MailboxFilterCriteria> | undefined,
): MailboxFilterCriteria {
  const input = value ?? {};
  const criteria: MailboxFilterCriteria = {};
  for (const field of ["search", "from", "to", "domain", "address", "subject", "label"] as const) {
    const normalized = normalizedString(input[field], field);
    if (normalized) criteria[field] = normalized;
  }
  for (const field of ["read", "unread", "starred", "archived"] as const) {
    const normalized = trueFlag(input[field], field);
    if (normalized) criteria[field] = normalized;
  }
  const since = normalizedDate(input.since, "since");
  const until = normalizedDate(input.until, "until");
  if (since && until && Date.parse(since) > Date.parse(until)) {
    throw new MailboxFilterInputError("since must be before or equal to until");
  }
  if (since) criteria.since = since;
  if (until) criteria.until = until;
  if (criteria.read && criteria.unread) {
    throw new MailboxFilterInputError("read and unread cannot both be true");
  }
  return criteria;
}

export function normalizeMailboxFilterInput(input: MailboxFilterInput): {
  name: string;
  normalized_name: string;
  mailbox: Mailbox;
  criteria: MailboxFilterCriteria;
  actions: MailboxFilterActions;
  enabled: boolean;
  order: number;
} {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const normalized_name = normalizeMailboxFilterName(name);
  const criteriaInput = input.criteria ?? {};
  const mailboxValue = input.mailbox ?? input.folder ?? criteriaInput.mailbox ?? criteriaInput.folder;
  if (typeof mailboxValue !== "string" || !MAILBOXES.includes(mailboxValue.trim().toLowerCase() as Mailbox)) {
    throw new MailboxFilterInputError(`mailbox must be one of ${MAILBOXES.join(", ")}`);
  }
  const criteria = normalizeMailboxFilterCriteria(criteriaInput);
  const actions = normalizeMailboxFilterActions(input.actions);
  const enabled = normalizedBoolean(input.enabled, "enabled");
  const order = normalizedOrder(input.order);
  return {
    name,
    normalized_name,
    mailbox: mailboxValue.trim().toLowerCase() as Mailbox,
    criteria,
    actions,
    enabled,
    order,
  };
}

export function criteriaToMailboxListOptions(
  mailbox: Mailbox,
  criteria: MailboxFilterCriteria,
  page: Pick<MailboxListOptions, "limit" | "offset" | "sort"> = {},
): MailboxListOptions & { mailbox: Mailbox } {
  return {
    ...page,
    mailbox,
    search: criteria.search,
    from: criteria.from,
    to: criteria.to,
    domain: criteria.domain,
    address: criteria.address,
    subject: criteria.subject,
    label: criteria.label,
    read: criteria.read,
    unread: criteria.unread,
    starred: criteria.starred,
    archived: criteria.archived,
    since: criteria.since,
    until: criteria.until,
  };
}
