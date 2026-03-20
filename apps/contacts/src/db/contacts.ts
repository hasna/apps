import type { Database } from "bun:sqlite";
import type {
  AddressRow,
  Company,
  CompanyRow,
  Contact,
  ContactListOptions,
  ContactRow,
  ContactWithDetails,
  CreateAddressInput,
  CreateContactInput,
  CreateEmailInput,
  CreatePhoneInput,
  CreateSocialProfileInput,
  Email,
  EmailRow,
  Phone,
  PhoneRow,
  Address,
  SocialProfile,
  SocialProfileRow,
  Tag,
  TagRow,
  UpdateContactInput,
} from "../types/index.js";
import { ContactNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { logActivity } from "./activity.js";

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToContact(row: ContactRow): Contact {
  return {
    ...row,
    source: row.source as Contact["source"],
    custom_fields: JSON.parse(row.custom_fields || "{}") as Record<string, unknown>,
    preferred_contact_method: (row.preferred_contact_method ?? null) as Contact["preferred_contact_method"],
  };
}

function rowToEmail(row: EmailRow): Email {
  return {
    ...row,
    type: row.type as Email["type"],
    is_primary: !!row.is_primary,
  };
}

function rowToPhone(row: PhoneRow): Phone {
  return {
    ...row,
    type: row.type as Phone["type"],
    is_primary: !!row.is_primary,
  };
}

function rowToAddress(row: AddressRow): Address {
  return {
    ...row,
    type: row.type as Address["type"],
    is_primary: !!row.is_primary,
  };
}

function rowToSocialProfile(row: SocialProfileRow): SocialProfile {
  return {
    ...row,
    platform: row.platform as SocialProfile["platform"],
    is_primary: !!row.is_primary,
  };
}

function rowToTag(row: TagRow): Tag {
  return { ...row };
}

function rowToCompany(row: CompanyRow): Company {
  return {
    ...row,
    custom_fields: JSON.parse(row.custom_fields || "{}") as Record<string, unknown>,
  };
}

// ─── Sub-entity inserters ─────────────────────────────────────────────────────

function insertEmails(db: Database, contactId: string | null, companyId: string | null, emails: CreateEmailInput[]): void {
  for (const e of emails) {
    db.run(
      `INSERT INTO emails (id, contact_id, company_id, address, type, is_primary) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), contactId, companyId, e.address, e.type ?? "work", e.is_primary ? 1 : 0]
    );
  }
}

function insertPhones(db: Database, contactId: string | null, companyId: string | null, phones: CreatePhoneInput[]): void {
  for (const p of phones) {
    db.run(
      `INSERT INTO phones (id, contact_id, company_id, number, country_code, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), contactId, companyId, p.number, p.country_code ?? null, p.type ?? "mobile", p.is_primary ? 1 : 0]
    );
  }
}

function insertAddresses(db: Database, contactId: string | null, companyId: string | null, addresses: CreateAddressInput[]): void {
  for (const a of addresses) {
    db.run(
      `INSERT INTO addresses (id, contact_id, company_id, type, street, city, state, zip, country, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), contactId, companyId, a.type ?? "physical", a.street ?? null, a.city ?? null, a.state ?? null, a.zip ?? null, a.country ?? null, a.is_primary ? 1 : 0]
    );
  }
}

function insertSocialProfiles(db: Database, contactId: string | null, companyId: string | null, profiles: CreateSocialProfileInput[]): void {
  for (const s of profiles) {
    db.run(
      `INSERT INTO social_profiles (id, contact_id, company_id, platform, handle, url, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), contactId, companyId, s.platform, s.handle ?? null, s.url ?? null, s.is_primary ? 1 : 0]
    );
  }
}

// ─── Detail loader ────────────────────────────────────────────────────────────

function loadContactDetails(db: Database, contact: Contact): ContactWithDetails {
  const emails = (db.query(`SELECT * FROM emails WHERE contact_id = ?`).all(contact.id) as EmailRow[]).map(rowToEmail);
  const phones = (db.query(`SELECT * FROM phones WHERE contact_id = ?`).all(contact.id) as PhoneRow[]).map(rowToPhone);
  const addresses = (db.query(`SELECT * FROM addresses WHERE contact_id = ?`).all(contact.id) as AddressRow[]).map(rowToAddress);
  const social_profiles = (db.query(`SELECT * FROM social_profiles WHERE contact_id = ?`).all(contact.id) as SocialProfileRow[]).map(rowToSocialProfile);
  const tags = (db.query(`
    SELECT t.* FROM tags t
    JOIN contact_tags ct ON ct.tag_id = t.id
    WHERE ct.contact_id = ?
  `).all(contact.id) as TagRow[]).map(rowToTag);
  const companyRow = contact.company_id
    ? db.query(`SELECT * FROM companies WHERE id = ?`).get(contact.company_id) as CompanyRow | null
    : null;
  const company = companyRow ? rowToCompany(companyRow) : null;

  return { ...contact, emails, phones, addresses, social_profiles, tags, company };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createContact(input: CreateContactInput, db?: Database): ContactWithDetails {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  const firstName = input.first_name ?? "";
  const lastName = input.last_name ?? "";
  const displayName = input.display_name
    ?? (firstName || lastName ? `${firstName} ${lastName}`.trim() : "Unnamed Contact");

  d.run(
    `INSERT INTO contacts (id, first_name, last_name, display_name, nickname, avatar_url, notes, birthday, company_id, job_title, source, custom_fields, last_contacted_at, website, preferred_contact_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      firstName,
      lastName,
      displayName,
      input.nickname ?? null,
      input.avatar_url ?? null,
      input.notes ?? null,
      input.birthday ?? null,
      input.company_id ?? null,
      input.job_title ?? null,
      input.source ?? "manual",
      JSON.stringify(input.custom_fields ?? {}),
      input.last_contacted_at ?? null,
      input.website ?? null,
      input.preferred_contact_method ?? null,
      timestamp,
      timestamp,
    ]
  );

  if (input.emails?.length) insertEmails(d, id, null, input.emails);
  if (input.phones?.length) insertPhones(d, id, null, input.phones);
  if (input.addresses?.length) insertAddresses(d, id, null, input.addresses);
  if (input.social_profiles?.length) insertSocialProfiles(d, id, null, input.social_profiles);

  if (input.tag_ids?.length) {
    for (const tagId of input.tag_ids) {
      d.run(`INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)`, [id, tagId]);
    }
  }

  logActivity(d, { contact_id: id, action: "contact.created", details: `Created contact: ${displayName}` });

  const row = d.query(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow;
  return loadContactDetails(d, rowToContact(row));
}

export function getContact(id: string, db?: Database): ContactWithDetails {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | null;
  if (!row) throw new ContactNotFoundError(id);
  return loadContactDetails(d, rowToContact(row));
}

export function listContacts(opts: ContactListOptions = {}, db?: Database): { contacts: ContactWithDetails[]; total: number } {
  const d = db || getDatabase();
  const {
    limit = 50,
    offset = 0,
    company_id,
    tag_id,
    source,
    order_by = "display_name",
    order_dir = "asc",
  } = opts;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (company_id) {
    conditions.push("c.company_id = ?");
    params.push(company_id);
  }

  if (source) {
    conditions.push("c.source = ?");
    params.push(source);
  }

  if (tag_id) {
    conditions.push("EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ?)");
    params.push(tag_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const validOrderBy = ["display_name", "created_at", "updated_at"].includes(order_by) ? order_by : "display_name";
  const validOrderDir = order_dir === "desc" ? "DESC" : "ASC";

  const totalRow = d.query(`SELECT COUNT(*) as total FROM contacts c ${where}`).get(...params) as { total: number };
  const rows = d.query(`SELECT c.* FROM contacts c ${where} ORDER BY c.${validOrderBy} ${validOrderDir} LIMIT ? OFFSET ?`).all(...params, limit, offset) as ContactRow[];

  const contacts = rows.map(row => loadContactDetails(d, rowToContact(row)));
  return { contacts, total: totalRow.total };
}

export function updateContact(id: string, input: UpdateContactInput, db?: Database): ContactWithDetails {
  const d = db || getDatabase();
  const existing = d.query(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | null;
  if (!existing) throw new ContactNotFoundError(id);

  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if (input.first_name !== undefined) { setClauses.push("first_name = ?"); params.push(input.first_name); }
  if (input.last_name !== undefined) { setClauses.push("last_name = ?"); params.push(input.last_name); }
  if (input.display_name !== undefined) { setClauses.push("display_name = ?"); params.push(input.display_name); }
  if (input.nickname !== undefined) { setClauses.push("nickname = ?"); params.push(input.nickname); }
  if (input.avatar_url !== undefined) { setClauses.push("avatar_url = ?"); params.push(input.avatar_url); }
  if (input.notes !== undefined) { setClauses.push("notes = ?"); params.push(input.notes); }
  if (input.birthday !== undefined) { setClauses.push("birthday = ?"); params.push(input.birthday); }
  if (input.company_id !== undefined) { setClauses.push("company_id = ?"); params.push(input.company_id); }
  if (input.job_title !== undefined) { setClauses.push("job_title = ?"); params.push(input.job_title); }
  if (input.source !== undefined) { setClauses.push("source = ?"); params.push(input.source); }
  if (input.custom_fields !== undefined) { setClauses.push("custom_fields = ?"); params.push(JSON.stringify(input.custom_fields)); }
  if (input.last_contacted_at !== undefined) { setClauses.push("last_contacted_at = ?"); params.push(input.last_contacted_at); }
  if (input.website !== undefined) { setClauses.push("website = ?"); params.push(input.website); }
  if (input.preferred_contact_method !== undefined) { setClauses.push("preferred_contact_method = ?"); params.push(input.preferred_contact_method); }

  params.push(id);
  d.run(`UPDATE contacts SET ${setClauses.join(", ")} WHERE id = ?`, params);

  logActivity(d, { contact_id: id, action: "contact.updated", details: `Updated contact: ${existing.display_name}` });

  const row = d.query(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow;
  return loadContactDetails(d, rowToContact(row));
}

export function deleteContact(id: string, db?: Database): void {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | null;
  if (!row) throw new ContactNotFoundError(id);

  // Log before deleting so we still have the name
  logActivity(d, { contact_id: id, action: "contact.deleted", details: `Deleted contact: ${row.display_name}` });

  d.run(`DELETE FROM contacts WHERE id = ?`, [id]);
}

export function searchContacts(query: string, db?: Database): ContactWithDetails[] {
  const d = db || getDatabase();

  // FTS5 search
  const ftsRows = d.query(`
    SELECT c.* FROM contacts c
    JOIN contacts_fts fts ON fts.id = c.id
    WHERE contacts_fts MATCH ?
    ORDER BY rank
    LIMIT 50
  `).all(`"${query.replace(/"/g, '""')}"*`) as ContactRow[];

  // Also search emails/phones for direct matches
  const emailRows = d.query(`
    SELECT DISTINCT c.* FROM contacts c
    JOIN emails e ON e.contact_id = c.id
    WHERE e.address LIKE ?
    LIMIT 20
  `).all(`%${query}%`) as ContactRow[];

  const phoneRows = d.query(`
    SELECT DISTINCT c.* FROM contacts c
    JOIN phones p ON p.contact_id = c.id
    WHERE p.number LIKE ?
    LIMIT 20
  `).all(`%${query}%`) as ContactRow[];

  // Deduplicate by id
  const seen = new Set<string>();
  const allRows: ContactRow[] = [];
  for (const row of [...ftsRows, ...emailRows, ...phoneRows]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      allRows.push(row);
    }
  }

  return allRows.map(row => loadContactDetails(d, rowToContact(row)));
}

export function listRecentContacts(limit: number, db?: Database): ContactWithDetails[] {
  const d = db || getDatabase();
  const rows = d.query(
    `SELECT * FROM contacts ORDER BY updated_at DESC LIMIT ?`
  ).all(limit) as ContactRow[];
  return rows.map(row => loadContactDetails(d, rowToContact(row)));
}

export function mergeContacts(keepId: string, mergeId: string, db?: Database): ContactWithDetails {
  const d = db || getDatabase();

  const keepRow = d.query(`SELECT * FROM contacts WHERE id = ?`).get(keepId) as ContactRow | null;
  if (!keepRow) throw new ContactNotFoundError(keepId);

  const mergeRow = d.query(`SELECT * FROM contacts WHERE id = ?`).get(mergeId) as ContactRow | null;
  if (!mergeRow) throw new ContactNotFoundError(mergeId);

  // Move all sub-entities from mergeId to keepId
  d.run(`UPDATE emails SET contact_id = ? WHERE contact_id = ?`, [keepId, mergeId]);
  d.run(`UPDATE phones SET contact_id = ? WHERE contact_id = ?`, [keepId, mergeId]);
  d.run(`UPDATE addresses SET contact_id = ? WHERE contact_id = ?`, [keepId, mergeId]);
  d.run(`UPDATE social_profiles SET contact_id = ? WHERE contact_id = ?`, [keepId, mergeId]);

  // Merge tags (ignoring duplicates)
  const mergeTags = d.query(`SELECT tag_id FROM contact_tags WHERE contact_id = ?`).all(mergeId) as { tag_id: string }[];
  for (const { tag_id } of mergeTags) {
    d.run(`INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)`, [keepId, tag_id]);
  }

  // Merge relationships
  d.run(`UPDATE contact_relationships SET contact_a_id = ? WHERE contact_a_id = ?`, [keepId, mergeId]);
  d.run(`UPDATE contact_relationships SET contact_b_id = ? WHERE contact_b_id = ?`, [keepId, mergeId]);

  // Merge activity
  d.run(`UPDATE activity_log SET contact_id = ? WHERE contact_id = ?`, [keepId, mergeId]);

  // Delete the merged contact
  d.run(`DELETE FROM contacts WHERE id = ?`, [mergeId]);

  // Fill in missing fields from merge source
  const updates: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if (!keepRow.notes && mergeRow.notes) { updates.push("notes = ?"); params.push(mergeRow.notes); }
  if (!keepRow.nickname && mergeRow.nickname) { updates.push("nickname = ?"); params.push(mergeRow.nickname); }
  if (!keepRow.avatar_url && mergeRow.avatar_url) { updates.push("avatar_url = ?"); params.push(mergeRow.avatar_url); }
  if (!keepRow.birthday && mergeRow.birthday) { updates.push("birthday = ?"); params.push(mergeRow.birthday); }
  if (!keepRow.company_id && mergeRow.company_id) { updates.push("company_id = ?"); params.push(mergeRow.company_id); }
  if (!keepRow.job_title && mergeRow.job_title) { updates.push("job_title = ?"); params.push(mergeRow.job_title); }

  params.push(keepId);
  d.run(`UPDATE contacts SET ${updates.join(", ")} WHERE id = ?`, params);

  logActivity(d, {
    contact_id: keepId,
    action: "contact.merged",
    details: `Merged contact ${mergeRow.display_name} (${mergeId}) into ${keepRow.display_name} (${keepId})`,
  });

  const finalRow = d.query(`SELECT * FROM contacts WHERE id = ?`).get(keepId) as ContactRow;
  return loadContactDetails(d, rowToContact(finalRow));
}
