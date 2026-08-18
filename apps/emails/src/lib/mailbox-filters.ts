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
export interface MailboxFilter {
  id: string;
  /** Present on api responses; local SQLite is implicitly tenant-scoped. */
  tenant_id?: string;
  name: string;
  normalized_name: string;
  mailbox: Mailbox;
  criteria: MailboxFilterCriteria;
  created_at: string;
  updated_at: string;
}

export interface MailboxFilterInput {
  name: string;
  mailbox?: string;
  folder?: string;
  criteria?: Partial<MailboxFilterCriteria> & { folder?: string; mailbox?: string };
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
} {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const normalized_name = normalizeMailboxFilterName(name);
  const criteriaInput = input.criteria ?? {};
  const mailboxValue = input.mailbox ?? input.folder ?? criteriaInput.mailbox ?? criteriaInput.folder;
  if (typeof mailboxValue !== "string" || !MAILBOXES.includes(mailboxValue.trim().toLowerCase() as Mailbox)) {
    throw new MailboxFilterInputError(`mailbox must be one of ${MAILBOXES.join(", ")}`);
  }
  const criteria = normalizeMailboxFilterCriteria(criteriaInput);
  return { name, normalized_name, mailbox: mailboxValue.trim().toLowerCase() as Mailbox, criteria };
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
