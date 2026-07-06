/**
 * Pure-remote Postgres data access for `contacts-serve` `/v1` (Amendment A1).
 *
 * A real, typed wrapper over the shared cloud Postgres relational schema
 * (see src/db/pg-migrations.ts). It exposes CRUD for the core contacts domain
 * entities — contacts, companies, tags — reading and writing RDS directly via
 * the vendored kit's pooled query client. There are NO stubs: every method runs
 * a parameterized SQL statement against the live database.
 */
import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import type {
  Company,
  Contact,
  CreateCompanyInput,
  CreateContactInput,
  CreateTagInput,
  Tag,
  UpdateCompanyInput,
  UpdateContactInput,
  UpdateTagInput,
} from "../types/index.js";

function uuid(): string {
  return crypto.randomUUID();
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : String(value ?? "");
}

// ─── row → domain mappers ───────────────────────────────────────────────────

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  nickname: string | null;
  avatar_url: string | null;
  notes: string | null;
  birthday: string | null;
  company_id: string | null;
  job_title: string | null;
  source: string;
  custom_fields: string;
  last_contacted_at: string | null;
  website: string | null;
  preferred_contact_method: string | null;
  status: string;
  follow_up_at: string | null;
  archived: boolean;
  project_id: string | null;
  sensitivity: string;
  do_not_contact: boolean;
  priority: number;
  timezone: string | null;
  created_at: unknown;
  updated_at: unknown;
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    display_name: row.display_name,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    notes: row.notes,
    birthday: row.birthday,
    company_id: row.company_id,
    job_title: row.job_title,
    source: row.source as Contact["source"],
    custom_fields: parseJson(row.custom_fields),
    last_contacted_at: row.last_contacted_at,
    website: row.website,
    preferred_contact_method: row.preferred_contact_method as Contact["preferred_contact_method"],
    status: row.status as Contact["status"],
    follow_up_at: row.follow_up_at,
    archived: Boolean(row.archived),
    project_id: row.project_id,
    sensitivity: row.sensitivity as Contact["sensitivity"],
    do_not_contact: Boolean(row.do_not_contact),
    priority: row.priority,
    timezone: row.timezone,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  logo_url: string | null;
  description: string | null;
  industry: string | null;
  size: string | null;
  founded_year: number | null;
  notes: string | null;
  custom_fields: string;
  archived: boolean;
  project_id: string | null;
  is_owned_entity: boolean;
  entity_type: string | null;
  created_at: unknown;
  updated_at: unknown;
}

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    logo_url: row.logo_url,
    description: row.description,
    industry: row.industry,
    size: row.size,
    founded_year: row.founded_year,
    notes: row.notes,
    custom_fields: parseJson(row.custom_fields),
    archived: Boolean(row.archived),
    project_id: row.project_id,
    is_owned_entity: Boolean(row.is_owned_entity),
    entity_type: row.entity_type as Company["entity_type"],
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

interface TagRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: unknown;
}

function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    created_at: iso(row.created_at),
  };
}

export interface ContactListFilter {
  limit?: number;
  offset?: number;
  company_id?: string;
  status?: string;
  q?: string;
}

export interface CompanyListFilter {
  limit?: number;
  offset?: number;
  industry?: string;
}

// ─── the store ──────────────────────────────────────────────────────────────

export class ContactsPgStore {
  constructor(private readonly client: PoolQueryClient) {}

  // ---- contacts ----
  async listContacts(filter: ContactListFilter = {}): Promise<{ contacts: Contact[]; count: number }> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.company_id) {
      params.push(filter.company_id);
      where.push(`company_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.q) {
      params.push(filter.q);
      where.push(`search_vector @@ plainto_tsquery('simple', $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRow = await this.client.get<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM contacts ${whereSql}`,
      params,
    );
    params.push(limit, offset);
    const rows = await this.client.many<ContactRow>(
      `SELECT * FROM contacts ${whereSql} ORDER BY display_name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { contacts: rows.map(mapContact), count: Number(countRow?.count ?? rows.length) };
  }

  async getContact(id: string): Promise<Contact | null> {
    const row = await this.client.get<ContactRow>(`SELECT * FROM contacts WHERE id = $1`, [id]);
    return row ? mapContact(row) : null;
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    const id = uuid();
    const display =
      input.display_name?.trim() ||
      [input.first_name, input.last_name].filter(Boolean).join(" ").trim() ||
      input.nickname?.trim() ||
      "Unnamed Contact";
    const row = await this.client.get<ContactRow>(
      `INSERT INTO contacts (
         id, first_name, last_name, display_name, nickname, avatar_url, notes, birthday,
         company_id, job_title, source, custom_fields, last_contacted_at, website,
         preferred_contact_method, status, follow_up_at, project_id, sensitivity,
         do_not_contact, priority, timezone
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       ) RETURNING *`,
      [
        id,
        input.first_name ?? "",
        input.last_name ?? "",
        display,
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
        input.status ?? "active",
        input.follow_up_at ?? null,
        input.project_id ?? null,
        input.sensitivity ?? "normal",
        input.do_not_contact ?? false,
        input.priority ?? 3,
        input.timezone ?? null,
      ],
    );
    return mapContact(row as ContactRow);
  }

  async updateContact(id: string, input: UpdateContactInput): Promise<Contact | null> {
    const allowed: Record<string, unknown> = {};
    const columns = [
      "first_name", "last_name", "display_name", "nickname", "avatar_url", "notes", "birthday",
      "company_id", "job_title", "source", "last_contacted_at", "website",
      "preferred_contact_method", "status", "follow_up_at", "project_id", "sensitivity",
      "do_not_contact", "priority", "timezone",
    ] as const;
    for (const col of columns) {
      if (col in input && (input as Record<string, unknown>)[col] !== undefined) {
        allowed[col] = (input as Record<string, unknown>)[col];
      }
    }
    if ("custom_fields" in input && input.custom_fields !== undefined) {
      allowed.custom_fields = JSON.stringify(input.custom_fields);
    }
    const keys = Object.keys(allowed);
    if (keys.length === 0) return this.getContact(id);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    sets.push(`updated_at = NOW()`);
    const row = await this.client.get<ContactRow>(
      `UPDATE contacts SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => allowed[k])],
    );
    return row ? mapContact(row) : null;
  }

  async deleteContact(id: string): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM contacts WHERE id = $1`, [id]);
    return result.rowCount > 0;
  }

  // ---- companies ----
  async listCompanies(filter: CompanyListFilter = {}): Promise<{ companies: Company[]; count: number }> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.industry) {
      params.push(filter.industry);
      where.push(`industry = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRow = await this.client.get<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM companies ${whereSql}`,
      params,
    );
    params.push(limit, offset);
    const rows = await this.client.many<CompanyRow>(
      `SELECT * FROM companies ${whereSql} ORDER BY name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { companies: rows.map(mapCompany), count: Number(countRow?.count ?? rows.length) };
  }

  async getCompany(id: string): Promise<Company | null> {
    const row = await this.client.get<CompanyRow>(`SELECT * FROM companies WHERE id = $1`, [id]);
    return row ? mapCompany(row) : null;
  }

  async createCompany(input: CreateCompanyInput): Promise<Company> {
    const id = uuid();
    const row = await this.client.get<CompanyRow>(
      `INSERT INTO companies (
         id, name, domain, logo_url, description, industry, size, founded_year, notes,
         custom_fields, is_owned_entity, entity_type
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
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
        input.is_owned_entity ?? false,
        input.entity_type ?? null,
      ],
    );
    return mapCompany(row as CompanyRow);
  }

  async updateCompany(id: string, input: UpdateCompanyInput): Promise<Company | null> {
    const allowed: Record<string, unknown> = {};
    const columns = [
      "name", "domain", "logo_url", "description", "industry", "size", "founded_year",
      "notes", "project_id", "is_owned_entity", "entity_type",
    ] as const;
    for (const col of columns) {
      if (col in input && (input as Record<string, unknown>)[col] !== undefined) {
        allowed[col] = (input as Record<string, unknown>)[col];
      }
    }
    if ("custom_fields" in input && input.custom_fields !== undefined) {
      allowed.custom_fields = JSON.stringify(input.custom_fields);
    }
    const keys = Object.keys(allowed);
    if (keys.length === 0) return this.getCompany(id);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    sets.push(`updated_at = NOW()`);
    const row = await this.client.get<CompanyRow>(
      `UPDATE companies SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => allowed[k])],
    );
    return row ? mapCompany(row) : null;
  }

  async deleteCompany(id: string): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM companies WHERE id = $1`, [id]);
    return result.rowCount > 0;
  }

  // ---- tags ----
  async listTags(): Promise<Tag[]> {
    const rows = await this.client.many<TagRow>(`SELECT * FROM tags ORDER BY name ASC`);
    return rows.map(mapTag);
  }

  async getTag(id: string): Promise<Tag | null> {
    const row = await this.client.get<TagRow>(`SELECT * FROM tags WHERE id = $1`, [id]);
    return row ? mapTag(row) : null;
  }

  async createTag(input: CreateTagInput): Promise<Tag> {
    const id = uuid();
    const row = await this.client.get<TagRow>(
      `INSERT INTO tags (id, name, color, description) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, input.name, input.color ?? "#6366f1", input.description ?? null],
    );
    return mapTag(row as TagRow);
  }

  async updateTag(id: string, input: UpdateTagInput): Promise<Tag | null> {
    const allowed: Record<string, unknown> = {};
    for (const col of ["name", "color", "description"] as const) {
      if (col in input && (input as Record<string, unknown>)[col] !== undefined) {
        allowed[col] = (input as Record<string, unknown>)[col];
      }
    }
    const keys = Object.keys(allowed);
    if (keys.length === 0) return this.getTag(id);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const row = await this.client.get<TagRow>(
      `UPDATE tags SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => allowed[k])],
    );
    return row ? mapTag(row) : null;
  }

  async deleteTag(id: string): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM tags WHERE id = $1`, [id]);
    return result.rowCount > 0;
  }

  // ---- stats ----
  async stats(): Promise<{ contacts: number; companies: number; tags: number }> {
    const row = await this.client.get<{ contacts: string; companies: string; tags: string }>(
      `SELECT
         (SELECT COUNT(*) FROM contacts)::text AS contacts,
         (SELECT COUNT(*) FROM companies)::text AS companies,
         (SELECT COUNT(*) FROM tags)::text AS tags`,
    );
    return {
      contacts: Number(row?.contacts ?? 0),
      companies: Number(row?.companies ?? 0),
      tags: Number(row?.tags ?? 0),
    };
  }
}

let cachedStore: ContactsPgStore | null = null;

export function createContactsPgStore(client: PoolQueryClient): ContactsPgStore {
  return new ContactsPgStore(client);
}

export function getContactsPgStore(client: PoolQueryClient): ContactsPgStore {
  if (!cachedStore) cachedStore = new ContactsPgStore(client);
  return cachedStore;
}

export function resetContactsPgStore(): void {
  cachedStore = null;
}
