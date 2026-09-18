import type { ContactWithDetails } from "../types/index.js";

export const CONTACTS_COMPACT_LIMIT = 20;
export const CONTACTS_MAX_LIMIT = 500;

export function normalizeContactsLimit(value: unknown, fallback = CONTACTS_COMPACT_LIMIT): number {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(CONTACTS_MAX_LIMIT, Math.trunc(parsed)));
}

export function normalizeContactsOffset(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

export function summarizeContact(contact: ContactWithDetails) {
  return {
    id: contact.id,
    display_name: contact.display_name,
    job_title: contact.job_title,
    company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
    primary_email: contact.emails?.find((email) => email.is_primary)?.address ?? contact.emails?.[0]?.address ?? null,
    primary_phone: contact.phones?.find((phone) => phone.is_primary)?.number ?? contact.phones?.[0]?.number ?? null,
    status: contact.status,
    follow_up_at: contact.follow_up_at,
    last_contacted_at: contact.last_contacted_at,
    archived: contact.archived,
    sensitivity: contact.sensitivity,
    tags: (contact.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
    updated_at: contact.updated_at,
  };
}

export function compareContactsByDisplayNameAndId(
  left: Pick<ContactWithDetails, "display_name" | "id">,
  right: Pick<ContactWithDetails, "display_name" | "id">,
): number {
  return left.display_name.localeCompare(right.display_name) || left.id.localeCompare(right.id);
}

export function compactContactsPage(
  contacts: ContactWithDetails[],
  options: { total: number; limit: number; offset: number },
) {
  const ordered = [...contacts].sort(compareContactsByDisplayNameAndId);
  const nextCursor = options.offset + ordered.length < options.total
    ? options.offset + contacts.length
    : null;
  return {
    contacts: ordered.map(summarizeContact),
    count: ordered.length,
    total: options.total,
    limit: options.limit,
    cursor: options.offset,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
    compact: true as const,
    sort: { fields: ["display_name", "id"], direction: "asc" as const },
    hint: "Use contacts show <id> for one full record; pass --full for the legacy list payload.",
  };
}
