import type { ContactsDatabase } from "./database.js";
import type {
  AddressRow,
  Company,
  CompanyListOptions,
  CompanyRow,
  CompanyWithDetails,
  Contact,
  ContactRow,
  CreateAddressInput,
  CreateCompanyInput,
  CreateEmailInput,
  CreatePhoneInput,
  CreateSocialProfileInput,
  EmailRow,
  EntityType,
  PhoneRow,
  SocialProfileRow,
  Tag,
  TagRow,
  UpdateCompanyInput,
} from "../types/index.js";
import { CompanyNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { logActivity } from "./activity.js";

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToCompany(row: CompanyRow): Company {
  return {
    ...row,
    custom_fields: JSON.parse(row.custom_fields || "{}") as Record<string, unknown>,
    archived: !!row.archived,
    project_id: row.project_id ?? null,
    is_owned_entity: !!row.is_owned_entity,
    entity_type: (row.entity_type ?? null) as EntityType | null,
  };
}

// ─── Sub-entity inserters ─────────────────────────────────────────────────────

function insertEmails(db: ContactsDatabase, companyId: string, emails: CreateEmailInput[]): void {
  for (const e of emails) {
    db.run(
      `INSERT INTO emails (id, contact_id, company_id, address, type, is_primary) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), null, companyId, e.address, e.type ?? "work", e.is_primary ? 1 : 0]
    );
  }
}

function insertPhones(db: ContactsDatabase, companyId: string, phones: CreatePhoneInput[]): void {
  for (const p of phones) {
    db.run(
      `INSERT INTO phones (id, contact_id, company_id, number, country_code, type, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), null, companyId, p.number, p.country_code ?? null, p.type ?? "work", p.is_primary ? 1 : 0]
    );
  }
}

function insertAddresses(db: ContactsDatabase, companyId: string, addresses: CreateAddressInput[]): void {
  for (const a of addresses) {
    db.run(
      `INSERT INTO addresses (id, contact_id, company_id, type, street, city, state, zip, country, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), null, companyId, a.type ?? "physical", a.street ?? null, a.city ?? null, a.state ?? null, a.zip ?? null, a.country ?? null, a.is_primary ? 1 : 0]
    );
  }
}

function insertSocialProfiles(db: ContactsDatabase, companyId: string, profiles: CreateSocialProfileInput[]): void {
  for (const s of profiles) {
    db.run(
      `INSERT INTO social_profiles (id, contact_id, company_id, platform, handle, url, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), null, companyId, s.platform, s.handle ?? null, s.url ?? null, s.is_primary ? 1 : 0]
    );
  }
}

// ─── Detail loader ────────────────────────────────────────────────────────────

function loadCompanyDetails(db: ContactsDatabase, company: Company): CompanyWithDetails {
  const emails = (db.query(`SELECT * FROM emails WHERE company_id = ?`).all(company.id) as EmailRow[]).map(row => ({
    ...row,
    type: row.type as "work" | "personal" | "other",
    is_primary: !!row.is_primary,
  }));

  const phones = (db.query(`SELECT * FROM phones WHERE company_id = ?`).all(company.id) as PhoneRow[]).map(row => ({
    ...row,
    type: row.type as "mobile" | "work" | "home" | "fax" | "whatsapp" | "other",
    is_primary: !!row.is_primary,
  }));

  const addresses = (db.query(`SELECT * FROM addresses WHERE company_id = ?`).all(company.id) as AddressRow[]).map(row => ({
    ...row,
    type: row.type as "physical" | "mailing" | "billing" | "virtual" | "other",
    is_primary: !!row.is_primary,
  }));

  const social_profiles = (db.query(`SELECT * FROM social_profiles WHERE company_id = ?`).all(company.id) as SocialProfileRow[]).map(row => ({
    ...row,
    platform: row.platform as "twitter" | "linkedin" | "github" | "instagram" | "telegram" | "discord" | "youtube" | "tiktok" | "bluesky" | "facebook" | "whatsapp" | "snapchat" | "reddit" | "other",
    is_primary: !!row.is_primary,
  }));

  const tags: Tag[] = (db.query(`
    SELECT t.* FROM tags t
    JOIN company_tags ct ON ct.tag_id = t.id
    WHERE ct.company_id = ?
  `).all(company.id) as TagRow[]);

  const empCount = db.query(`SELECT COUNT(*) as count FROM contacts WHERE company_id = ?`).get(company.id) as { count: number };

  return {
    ...company,
    emails,
    phones,
    addresses,
    social_profiles,
    tags,
    employee_count: empCount.count,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createCompany(input: CreateCompanyInput, db?: ContactsDatabase): CompanyWithDetails {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO companies (id, name, domain, logo_url, description, industry, size, founded_year, notes, custom_fields, is_owned_entity, entity_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.domain ?? null,
      input.logo_url ?? null,
      input.description ?? null,
      input.industry ?? null,
      input.size ?? null,
      input.founded_year ?? null,
      input.notes ?? null,
      JSON.stringify(input.custom_fields ?? {}),
      input.is_owned_entity ? 1 : 0,
      input.entity_type ?? null,
      timestamp,
      timestamp,
    ]
  );

  if (input.emails?.length) insertEmails(d, id, input.emails);
  if (input.phones?.length) insertPhones(d, id, input.phones);
  if (input.addresses?.length) insertAddresses(d, id, input.addresses);
  if (input.social_profiles?.length) insertSocialProfiles(d, id, input.social_profiles);

  if (input.tag_ids?.length) {
    for (const tagId of input.tag_ids) {
      d.run(`INSERT OR IGNORE INTO company_tags (company_id, tag_id) VALUES (?, ?)`, [id, tagId]);
    }
  }

  logActivity(d, { company_id: id, action: "company.created", details: `Created company: ${input.name}` });

  const row = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow;
  return loadCompanyDetails(d, rowToCompany(row));
}

export function getCompany(id: string, db?: ContactsDatabase): CompanyWithDetails {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow | null;
  if (!row) throw new CompanyNotFoundError(id);
  return loadCompanyDetails(d, rowToCompany(row));
}

export function listCompanies(opts: CompanyListOptions = {}, db?: ContactsDatabase): { companies: CompanyWithDetails[]; total: number } {
  const d = db || getDatabase();
  const {
    limit = 50,
    offset = 0,
    industry,
    tag_id,
    project_id,
    archived = false,
    is_owned_entity,
    order_by = "name",
    order_dir = "asc",
  } = opts;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  conditions.push("co.archived = ?");
  params.push(archived ? 1 : 0);

  if (industry) {
    conditions.push("co.industry = ?");
    params.push(industry);
  }

  if (project_id) {
    conditions.push("co.project_id = ?");
    params.push(project_id);
  }

  if (tag_id) {
    conditions.push("EXISTS (SELECT 1 FROM company_tags ct WHERE ct.company_id = co.id AND ct.tag_id = ?)");
    params.push(tag_id);
  }

  if (is_owned_entity !== undefined) {
    conditions.push("co.is_owned_entity = ?");
    params.push(is_owned_entity ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const validOrderBy = ["name", "created_at", "updated_at"].includes(order_by) ? order_by : "name";
  const validOrderDir = order_dir === "desc" ? "DESC" : "ASC";

  const totalRow = d.query(`SELECT COUNT(*) as total FROM companies co ${where}`).get(...params) as { total: number };
  const rows = d.query(`SELECT co.* FROM companies co ${where} ORDER BY co.${validOrderBy} ${validOrderDir} LIMIT ? OFFSET ?`).all(...params, limit, offset) as CompanyRow[];

  const companies = rows.map(row => loadCompanyDetails(d, rowToCompany(row)));
  return { companies, total: totalRow.total };
}

export function updateCompany(id: string, input: UpdateCompanyInput, db?: ContactsDatabase): CompanyWithDetails {
  const d = db || getDatabase();
  const existing = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow | null;
  if (!existing) throw new CompanyNotFoundError(id);

  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if (input.name !== undefined) { setClauses.push("name = ?"); params.push(input.name); }
  if (input.domain !== undefined) { setClauses.push("domain = ?"); params.push(input.domain); }
  if (input.logo_url !== undefined) { setClauses.push("logo_url = ?"); params.push(input.logo_url); }
  if (input.description !== undefined) { setClauses.push("description = ?"); params.push(input.description); }
  if (input.industry !== undefined) { setClauses.push("industry = ?"); params.push(input.industry); }
  if (input.size !== undefined) { setClauses.push("size = ?"); params.push(input.size); }
  if (input.founded_year !== undefined) { setClauses.push("founded_year = ?"); params.push(input.founded_year); }
  if (input.notes !== undefined) { setClauses.push("notes = ?"); params.push(input.notes); }
  if (input.custom_fields !== undefined) { setClauses.push("custom_fields = ?"); params.push(JSON.stringify(input.custom_fields)); }
  if ("project_id" in input && input.project_id !== undefined) { setClauses.push("project_id = ?"); params.push(input.project_id as string | null); }
  if (input.is_owned_entity !== undefined) { setClauses.push("is_owned_entity = ?"); params.push(input.is_owned_entity ? 1 : 0); }
  if ("entity_type" in input && input.entity_type !== undefined) { setClauses.push("entity_type = ?"); params.push(input.entity_type as string | null); }

  params.push(id);
  d.run(`UPDATE companies SET ${setClauses.join(", ")} WHERE id = ?`, params);

  logActivity(d, { company_id: id, action: "company.updated", details: `Updated company: ${existing.name}` });

  const row = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow;
  return loadCompanyDetails(d, rowToCompany(row));
}

export function deleteCompany(id: string, db?: ContactsDatabase): void {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow | null;
  if (!row) throw new CompanyNotFoundError(id);

  logActivity(d, { company_id: id, action: "company.deleted", details: `Deleted company: ${row.name}` });

  d.run(`DELETE FROM companies WHERE id = ?`, [id]);
}

export function searchCompanies(query: string, db?: ContactsDatabase): CompanyWithDetails[] {
  const d = db || getDatabase();

  const rows = d.query(`
    SELECT * FROM companies
    WHERE name LIKE ? OR domain LIKE ? OR description LIKE ? OR industry LIKE ?
    LIMIT 50
  `).all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`) as CompanyRow[];

  return rows.map(row => loadCompanyDetails(d, rowToCompany(row)));
}

export function listCompanyEmployees(companyId: string, db?: ContactsDatabase): Contact[] {
  const d = db || getDatabase();
  const row = d.query(`SELECT id FROM companies WHERE id = ?`).get(companyId) as { id: string } | null;
  if (!row) throw new CompanyNotFoundError(companyId);

  const rows = d.query(`SELECT * FROM contacts WHERE company_id = ? ORDER BY display_name ASC`).all(companyId) as ContactRow[];
  return rows.map(r => ({
    ...r,
    source: r.source as Contact["source"],
    custom_fields: JSON.parse(r.custom_fields || "{}") as Record<string, unknown>,
    preferred_contact_method: (r.preferred_contact_method ?? null) as Contact["preferred_contact_method"],
    status: (r.status ?? "active") as Contact["status"],
    follow_up_at: r.follow_up_at ?? null,
    archived: !!r.archived,
    project_id: r.project_id ?? null,
    sensitivity: (r.sensitivity ?? "normal") as Contact["sensitivity"],
    do_not_contact: !!r.do_not_contact,
    priority: r.priority ?? 3,
    timezone: r.timezone ?? null,
  }));
}

export function archiveCompany(id: string, db?: ContactsDatabase): CompanyWithDetails {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow | null;
  if (!row) throw new CompanyNotFoundError(id);
  d.run(`UPDATE companies SET archived = 1, updated_at = ? WHERE id = ?`, [now(), id]);
  logActivity(d, { company_id: id, action: "company.archived", details: `Archived company: ${row.name}` });
  const updated = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow;
  return loadCompanyDetails(d, rowToCompany(updated));
}

export function unarchiveCompany(id: string, db?: ContactsDatabase): CompanyWithDetails {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow | null;
  if (!row) throw new CompanyNotFoundError(id);
  d.run(`UPDATE companies SET archived = 0, updated_at = ? WHERE id = ?`, [now(), id]);
  logActivity(d, { company_id: id, action: "company.unarchived", details: `Unarchived company: ${row.name}` });
  const updated = d.query(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow;
  return loadCompanyDetails(d, rowToCompany(updated));
}

export function listOwnedEntities(db?: ContactsDatabase): { companies: CompanyWithDetails[]; total: number } {
  return listCompanies({ is_owned_entity: true } as CompanyListOptions & { is_owned_entity?: boolean }, db);
}
