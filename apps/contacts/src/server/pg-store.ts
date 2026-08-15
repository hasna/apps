/**
 * Pure-remote Postgres data access for `contacts-serve` `/v1` (Amendment A1).
 *
 * A real, typed wrapper over the shared cloud Postgres relational schema
 * (see src/db/pg-migrations.ts). It exposes CRUD for the core contacts domain
 * entities — contacts, companies, tags — reading and writing RDS directly via
 * the vendored kit's pooled query client. There are NO stubs: every method runs
 * a parameterized SQL statement against the live database.
 */
import { createHash } from "node:crypto";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";
import type {
  Company,
  Contact,
  CreateCompanyInput,
  CreateContactInput,
  CreateEmailInput,
  CreatePhoneInput,
  CreateTagInput,
  Email,
  Phone,
  Tag,
  UpdateCompanyInput,
  UpdateContactInput,
  UpdateTagInput,
} from "../types/index.js";
import type {
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationDirection,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "../types/project-memberships.js";
import { ContactProjectMembershipConflictError } from "../types/project-memberships.js";

/**
 * Contact read responses carry their child collections, matching what the
 * on-box SQLite store returns from `loadContactDetails`. The ApiStore is typed
 * against the SQLite return shape, so omitting these here is a silent parity
 * break rather than a smaller-but-valid response.
 */
export type ContactWithMethods = Contact & { tags: Tag[]; emails: Email[]; phones: Phone[] };

function uuid(): string {
  return crypto.randomUUID();
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : String(value ?? "");
}

/** ISO-or-null for nullable timestamptz columns. */
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

/** Parse a JSON text column (Postgres stores these as TEXT), tolerant of nulls. */
function pj<T = unknown>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    if (value === "") return fallback;
    try {
      const parsed = JSON.parse(value);
      return (parsed ?? fallback) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function newUuid(): string {
  return crypto.randomUUID();
}

/** Current ISO timestamp for TEXT date/timestamp columns written by the app. */
function nowIso(): string {
  return new Date().toISOString();
}

interface ContactProjectMembershipStateRow {
  contact_id: string;
  project_id: string;
  linked: boolean;
  revision: string | number;
}

interface ContactProjectMembershipReceiptRow {
  direction: ContactProjectMembershipMutationDirection;
  contact_id: string;
  project_id: string;
  operation_id: string;
  step_id: string;
  expected_version: string;
  before_json: unknown;
  after_json: unknown;
  receipt_id: string;
}

function contactProjectDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function contactProjectMembershipVersion(row: ContactProjectMembershipStateRow): string {
  return `cpmv_${contactProjectDigest(JSON.stringify([
    row.contact_id,
    row.project_id,
    Boolean(row.linked),
    Number(row.revision),
  ])).slice(0, 32)}`;
}

function contactProjectMembershipSnapshot(
  row: ContactProjectMembershipStateRow,
): ContactProjectMembershipSnapshot {
  return {
    contact_id: row.contact_id,
    project_id: row.project_id,
    linked: Boolean(row.linked),
    version: contactProjectMembershipVersion(row),
  };
}

function parseMembershipSnapshot(value: unknown): ContactProjectMembershipSnapshot {
  if (typeof value === "string") return JSON.parse(value) as ContactProjectMembershipSnapshot;
  return value as ContactProjectMembershipSnapshot;
}

function requiredMembershipValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeMembershipMutationInput(
  input: ContactProjectMembershipMutationInput,
): ContactProjectMembershipMutationInput {
  return {
    contact_id: requiredMembershipValue(input.contact_id, "contact_id"),
    project_id: requiredMembershipValue(input.project_id, "project_id"),
    operation_id: requiredMembershipValue(input.operation_id, "operation_id"),
    step_id: requiredMembershipValue(input.step_id, "step_id"),
    expected_version: requiredMembershipValue(input.expected_version, "expected_version"),
  };
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

function mapEmail(row: Record<string, unknown>): Email {
  return {
    id: String(row["id"]),
    contact_id: (row["contact_id"] as string | null) ?? null,
    company_id: (row["company_id"] as string | null) ?? null,
    address: String(row["address"]),
    type: row["type"] as Email["type"],
    is_primary: Boolean(row["is_primary"]),
    created_at: iso(row["created_at"]),
  };
}

function mapPhone(row: Record<string, unknown>): Phone {
  return {
    id: String(row["id"]),
    contact_id: (row["contact_id"] as string | null) ?? null,
    company_id: (row["company_id"] as string | null) ?? null,
    number: String(row["number"]),
    country_code: (row["country_code"] as string | null) ?? null,
    type: row["type"] as Phone["type"],
    is_primary: Boolean(row["is_primary"]),
    created_at: iso(row["created_at"]),
  };
}

export interface ContactListFilter {
  limit?: number;
  offset?: number;
  company_id?: string;
  status?: string;
  tag_id?: string;
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

  /** Attach cloud tag memberships in one query for contact read responses. */
  private async attachTags(contacts: Contact[]): Promise<Array<Contact & { tags: Tag[] }>> {
    const tagsByContactId = new Map<string, Tag[]>(contacts.map((contact) => [contact.id, []]));
    if (contacts.length === 0) return [];

    const rows = await this.client.many<TagRow & { contact_id: string }>(
      `SELECT ct.contact_id, t.*
       FROM contact_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.contact_id = ANY($1::text[])
       ORDER BY t.name ASC`,
      [contacts.map((contact) => contact.id)],
    );
    for (const row of rows) tagsByContactId.get(row.contact_id)?.push(mapTag(row));
    return contacts.map((contact) => ({ ...contact, tags: tagsByContactId.get(contact.id) ?? [] }));
  }

  /**
   * Attach email/phone child rows in TWO batched queries regardless of how many
   * contacts are passed. `loadDetails` below queries per contact, which is
   * correct for a single row and an N+1 on a list or an export — this is the
   * list-safe counterpart, shaped like `attachTags` above.
   */
  private async attachContactMethods<T extends Contact>(contacts: T[]): Promise<Array<T & { emails: Email[]; phones: Phone[] }>> {
    if (contacts.length === 0) return [];
    const ids = contacts.map((contact) => contact.id);
    const emailsByContactId = new Map<string, Email[]>(ids.map((id) => [id, []]));
    const phonesByContactId = new Map<string, Phone[]>(ids.map((id) => [id, []]));

    const [emailRows, phoneRows] = await Promise.all([
      this.client.many<Record<string, unknown>>(
        `SELECT * FROM emails WHERE contact_id = ANY($1::text[]) ORDER BY created_at ASC`,
        [ids],
      ),
      this.client.many<Record<string, unknown>>(
        `SELECT * FROM phones WHERE contact_id = ANY($1::text[]) ORDER BY created_at ASC`,
        [ids],
      ),
    ]);

    for (const row of emailRows) emailsByContactId.get(String(row["contact_id"]))?.push(mapEmail(row));
    for (const row of phoneRows) phonesByContactId.get(String(row["contact_id"]))?.push(mapPhone(row));

    return contacts.map((contact) => ({
      ...contact,
      emails: emailsByContactId.get(contact.id) ?? [],
      phones: phonesByContactId.get(contact.id) ?? [],
    }));
  }

  /** The single readback contract for every contact-returning v1 path. */
  private async attachContactDetails(contacts: Contact[]): Promise<ContactWithMethods[]> {
    return this.attachContactMethods(await this.attachTags(contacts));
  }

  /**
   * Append emails/phones, skipping duplicates the way the SQLite store does —
   * case-insensitively on address, exactly on number. `WHERE NOT EXISTS` keeps
   * the check and the insert in one statement so two concurrent appends of the
   * same address cannot both pass a separate existence check.
   */
  private async insertContactMethods(
    contactId: string,
    emails: CreateEmailInput[] | undefined,
    phones: CreatePhoneInput[] | undefined,
  ): Promise<void> {
    for (const email of emails ?? []) {
      await this.client.query(
        `INSERT INTO emails (id, contact_id, company_id, address, type, is_primary)
         SELECT $1, $2, NULL, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM emails WHERE contact_id = $2 AND LOWER(address) = LOWER($3)
         )`,
        [uuid(), contactId, email.address, email.type ?? "work", email.is_primary ?? false],
      );
    }
    for (const phone of phones ?? []) {
      await this.client.query(
        `INSERT INTO phones (id, contact_id, company_id, number, country_code, type, is_primary)
         SELECT $1, $2, NULL, $3, $4, $5, $6
         WHERE NOT EXISTS (
           SELECT 1 FROM phones WHERE contact_id = $2 AND number = $3
         )`,
        [uuid(), contactId, phone.number, phone.country_code ?? null, phone.type ?? "mobile", phone.is_primary ?? false],
      );
    }
  }

  // ---- contacts ----
  async listContacts(filter: ContactListFilter = {}): Promise<{ contacts: ContactWithMethods[]; count: number }> {
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
    if (filter.tag_id) {
      params.push(filter.tag_id);
      where.push(`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = contacts.id AND ct.tag_id = $${params.length})`);
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
    return { contacts: await this.attachContactDetails(rows.map(mapContact)), count: Number(countRow?.count ?? rows.length) };
  }

  async getContact(id: string): Promise<ContactWithMethods | null> {
    const row = await this.client.get<ContactRow>(`SELECT * FROM contacts WHERE id = $1`, [id]);
    if (!row) return null;
    return (await this.attachContactDetails([mapContact(row)]))[0]!;
  }

  async createContact(input: CreateContactInput): Promise<ContactWithMethods> {
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
    // Child collections are part of the create input and were previously
    // dropped: `contacts add --email` stored the contact and lost the address.
    await this.insertContactMethods(id, input.emails, input.phones);
    // The public v1 Contact schema requires a safe membership readback on every
    // contact response. A newly created contact has no memberships, but still
    // returns the stable `tags: []` shape rather than omitting the field.
    return (await this.attachContactDetails([mapContact(row as ContactRow)]))[0]!;
  }

  async updateContact(id: string, input: UpdateContactInput): Promise<ContactWithMethods | null> {
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
    const hasMethodAppends = Boolean(input.emails_add?.length || input.phones_add?.length);

    // Only a PATCH that changes nothing at all is a no-op read. An
    // emails_add/phones_add-only PATCH has real work to do, and returning here
    // was the silent failure: zero allowed columns meant the unchanged contact
    // came back at HTTP 200 with updated_at frozen and the address discarded.
    if (keys.length === 0 && !hasMethodAppends) return this.getContact(id);

    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    sets.push(`updated_at = NOW()`);
    const row = await this.client.get<ContactRow>(
      `UPDATE contacts SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => allowed[k])],
    );
    // A missing row is a missing contact; do not insert orphaned children.
    if (!row) return null;

    await this.insertContactMethods(id, input.emails_add, input.phones_add);
    return (await this.attachContactDetails([mapContact(row)]))[0]!;
  }

  async deleteContact(id: string): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM contacts WHERE id = $1`, [id]);
    return result.rowCount > 0;
  }

  // ---- contact ↔ project links ----
  async linkContactToProject(contactId: string, projectId: string): Promise<void> {
    await this.client.transaction(async (client) => {
      await this.transitionContactProjectMembershipWithoutReceipt(client, contactId, projectId, true);
    });
  }

  async unlinkContactFromProject(contactId: string, projectId: string): Promise<boolean> {
    return this.client.transaction((client) =>
      this.transitionContactProjectMembershipWithoutReceipt(client, contactId, projectId, false));
  }

  async getContactProjectIds(contactId: string): Promise<string[]> {
    const rows = await this.client.many<{ project_id: string }>(
      `SELECT project_id
       FROM contact_projects
       WHERE contact_id = $1
       ORDER BY project_id ASC`,
      [contactId],
    );
    return rows.map((row) => row.project_id);
  }

  async setContactProjects(contactId: string, projectIds: string[]): Promise<string[]> {
    const uniqueProjectIds = [...new Set(
      projectIds.map((projectId) => requiredMembershipValue(projectId, "project_id")),
    )];
    await this.client.transaction(async (client) => {
      const current = await client.many<{ project_id: string }>(
        `SELECT project_id FROM contact_projects WHERE contact_id = $1`,
        [contactId],
      );
      const desired = new Set(uniqueProjectIds);
      const population = new Set([...current.map((row) => row.project_id), ...uniqueProjectIds]);
      for (const projectId of population) {
        await this.transitionContactProjectMembershipWithoutReceipt(
          client,
          contactId,
          projectId,
          desired.has(projectId),
        );
      }
    });
    return uniqueProjectIds;
  }

  async listContactIdsByProject(projectId: string): Promise<string[]> {
    const rows = await this.client.many<{ contact_id: string }>(
      `SELECT contact_id
       FROM contact_projects
       WHERE project_id = $1
       ORDER BY contact_id ASC`,
      [projectId],
    );
    return rows.map((row) => row.contact_id);
  }

  private async contactProjectMembershipState(
    client: TypedQueryClient,
    contactId: string,
    projectId: string,
    forUpdate = false,
  ): Promise<ContactProjectMembershipStateRow> {
    let row = await client.get<ContactProjectMembershipStateRow>(
      `SELECT contact_id, project_id, linked, revision
       FROM contact_project_membership_states
       WHERE contact_id = $1 AND project_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [contactId, projectId],
    );
    if (row) return row;
    const linked = Boolean(await client.get<{ present: number }>(
      `SELECT 1 AS present FROM contact_projects WHERE contact_id = $1 AND project_id = $2`,
      [contactId, projectId],
    ));
    if (!forUpdate) {
      return { contact_id: contactId, project_id: projectId, linked, revision: 0 };
    }
    await client.execute(
      `INSERT INTO contact_project_membership_states
         (contact_id, project_id, linked, revision, updated_at)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT (contact_id, project_id) DO NOTHING`,
      [contactId, projectId, linked],
    );
    row = await client.get<ContactProjectMembershipStateRow>(
      `SELECT contact_id, project_id, linked, revision
       FROM contact_project_membership_states
       WHERE contact_id = $1 AND project_id = $2
       FOR UPDATE`,
      [contactId, projectId],
    );
    if (!row) throw new Error("failed to initialize contact project membership state");
    return row;
  }

  private async transitionContactProjectMembershipWithoutReceipt(
    client: TypedQueryClient,
    contactId: string,
    projectId: string,
    linked: boolean,
  ): Promise<boolean> {
    const normalizedContactId = requiredMembershipValue(contactId, "contact_id");
    const normalizedProjectId = requiredMembershipValue(projectId, "project_id");
    const before = await this.contactProjectMembershipState(
      client,
      normalizedContactId,
      normalizedProjectId,
      true,
    );
    const changed = Boolean(before.linked) !== linked;
    const revision = Number(before.revision) + (changed ? 1 : 0);
    await client.execute(
      `UPDATE contact_project_membership_states
       SET linked = $3, revision = $4, updated_at = NOW()
       WHERE contact_id = $1 AND project_id = $2`,
      [normalizedContactId, normalizedProjectId, linked, revision],
    );
    if (linked) {
      await client.execute(
        `INSERT INTO contact_projects (contact_id, project_id) VALUES ($1, $2)
         ON CONFLICT (contact_id, project_id) DO NOTHING`,
        [normalizedContactId, normalizedProjectId],
      );
    } else {
      await client.execute(
        `DELETE FROM contact_projects WHERE contact_id = $1 AND project_id = $2`,
        [normalizedContactId, normalizedProjectId],
      );
    }
    return changed;
  }

  async readContactProjectMembership(
    contactId: string,
    projectId: string,
  ): Promise<ContactProjectMembershipSnapshot> {
    return contactProjectMembershipSnapshot(
      await this.contactProjectMembershipState(this.client, contactId, projectId),
    );
  }

  async listContactProjectMemberships(
    projectId: string,
    maxItems: number,
  ): Promise<ContactProjectMembershipListResult> {
    if (!Number.isInteger(maxItems) || maxItems < 1) throw new Error("max_items must be a positive integer");
    const rows = await this.client.many<ContactProjectMembershipStateRow>(
      `SELECT cp.contact_id, cp.project_id,
              COALESCE(state.linked, TRUE) AS linked,
              COALESCE(state.revision, 0) AS revision
       FROM contact_projects cp
       LEFT JOIN contact_project_membership_states state
         ON state.contact_id = cp.contact_id AND state.project_id = cp.project_id
       WHERE cp.project_id = $1
       ORDER BY cp.contact_id ASC
       LIMIT $2`,
      [projectId, maxItems + 1],
    );
    if (rows.length > maxItems) {
      throw new Error(`contact project membership collection exceeds max_items=${maxItems}`);
    }
    return {
      project_id: projectId,
      contact_ids: rows.map((row) => row.contact_id),
      complete: true,
      membership_revision: `cpml_${contactProjectDigest(JSON.stringify(
        rows.map(contactProjectMembershipSnapshot),
      )).slice(0, 32)}`,
    };
  }

  async mutateContactProjectMembership(
    direction: ContactProjectMembershipMutationDirection,
    rawInput: ContactProjectMembershipMutationInput,
  ): Promise<ContactProjectMembershipMutationResult> {
    const input = normalizeMembershipMutationInput(rawInput);
    return this.client.transaction(async (client) => {
      await client.execute(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [input.operation_id, input.step_id],
      );
      const receipt = await client.get<ContactProjectMembershipReceiptRow>(
        `SELECT direction, contact_id, project_id, operation_id, step_id, expected_version,
                before_json, after_json, receipt_id
         FROM contact_project_membership_receipts
         WHERE operation_id = $1 AND step_id = $2`,
        [input.operation_id, input.step_id],
      );
      if (receipt) {
        if (
          receipt.direction !== direction
          || receipt.contact_id !== input.contact_id
          || receipt.project_id !== input.project_id
          || receipt.expected_version !== input.expected_version
        ) {
          throw new ContactProjectMembershipConflictError(
            "operation_id/step_id already accepted for a different contact-project membership mutation",
          );
        }
        return {
          outcome: "duplicate_of_accepted",
          operation_id: receipt.operation_id,
          step_id: receipt.step_id,
          before: parseMembershipSnapshot(receipt.before_json),
          after: parseMembershipSnapshot(receipt.after_json),
          receipt_id: receipt.receipt_id,
        };
      }

      const contact = await client.get<{ id: string }>(`SELECT id FROM contacts WHERE id = $1`, [input.contact_id]);
      if (!contact) throw new Error(`contact not found: ${input.contact_id}`);
      const beforeRow = await this.contactProjectMembershipState(
        client,
        input.contact_id,
        input.project_id,
        true,
      );
      const before = contactProjectMembershipSnapshot(beforeRow);
      if (before.version !== input.expected_version) {
        throw new ContactProjectMembershipConflictError(
          `contact project membership expected_version conflict: expected ${input.expected_version}, current ${before.version}`,
        );
      }

      const desiredLinked = direction === "attach";
      const changed = before.linked !== desiredLinked;
      const revision = Number(beforeRow.revision) + (changed ? 1 : 0);
      const afterRow = { ...beforeRow, linked: desiredLinked, revision };
      await client.execute(
        `UPDATE contact_project_membership_states
         SET linked = $3, revision = $4, updated_at = NOW()
         WHERE contact_id = $1 AND project_id = $2`,
        [input.contact_id, input.project_id, desiredLinked, revision],
      );
      if (desiredLinked) {
        await client.execute(
          `INSERT INTO contact_projects (contact_id, project_id) VALUES ($1, $2)
           ON CONFLICT (contact_id, project_id) DO NOTHING`,
          [input.contact_id, input.project_id],
        );
      } else {
        await client.execute(
          `DELETE FROM contact_projects WHERE contact_id = $1 AND project_id = $2`,
          [input.contact_id, input.project_id],
        );
      }

      const after = contactProjectMembershipSnapshot(afterRow);
      const id = `cpmr_${contactProjectDigest(JSON.stringify([
        input.operation_id,
        input.step_id,
        input.contact_id,
        input.project_id,
      ])).slice(0, 32)}`;
      await client.execute(
        `INSERT INTO contact_project_membership_receipts (
           receipt_id, direction, contact_id, project_id, operation_id, step_id,
           expected_version, before_json, after_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
        [
          id,
          direction,
          input.contact_id,
          input.project_id,
          input.operation_id,
          input.step_id,
          input.expected_version,
          JSON.stringify(before),
          JSON.stringify(after),
        ],
      );
      return {
        outcome: changed ? "accepted" : "duplicate_of_accepted",
        operation_id: input.operation_id,
        step_id: input.step_id,
        before,
        after,
        receipt_id: id,
      };
    });
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

  async getTagByName(name: string): Promise<Tag | null> {
    const row = await this.client.get<TagRow>(`SELECT * FROM tags WHERE name = $1`, [name]);
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

  async addTagToContact(contactId: string, tagId: string): Promise<void> {
    await this.client.execute(
      `INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2)
       ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      [contactId, tagId],
    );
  }

  async removeTagFromContact(contactId: string, tagId: string): Promise<boolean> {
    const result = await this.client.query(
      `DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2`,
      [contactId, tagId],
    );
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Extended CRM / intelligence / distribution domains (Postgres).
  // Each mirrors the on-box SQLite db module (src/db/*) semantics and row shapes
  // so the ApiStore returns exactly what LocalStore returns. Postgres dialect:
  // proper booleans, $N params, NOW(), string_agg, ON CONFLICT.
  // ═══════════════════════════════════════════════════════════════════════════

  // ---- contact detail loading (for ContactWithDetails-shaped results) ----
  private async loadDetails(contact: Contact): Promise<Record<string, unknown>> {
    const [emails, phones, tags, company] = await Promise.all([
      this.client.many<Record<string, unknown>>(`SELECT * FROM emails WHERE contact_id = $1`, [contact.id]),
      this.client.many<Record<string, unknown>>(`SELECT * FROM phones WHERE contact_id = $1`, [contact.id]),
      this.client.many<Record<string, unknown>>(
        `SELECT t.* FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = $1`,
        [contact.id],
      ),
      contact.company_id
        ? this.client.get<CompanyRow>(`SELECT * FROM companies WHERE id = $1`, [contact.company_id])
        : Promise.resolve(null),
    ]);
    return {
      ...contact,
      emails: emails.map((e) => ({ ...e, is_primary: Boolean(e.is_primary), created_at: isoOrNull(e.created_at) })),
      phones: phones.map((p) => ({ ...p, is_primary: Boolean(p.is_primary), created_at: isoOrNull(p.created_at) })),
      addresses: [],
      social_profiles: [],
      tags: tags.map((t) => mapTag(t as unknown as TagRow)),
      company: company ? mapCompany(company) : null,
    };
  }

  async searchContacts(q: string): Promise<Record<string, unknown>[]> {
    const rows = await this.client.many<ContactRow>(
      `SELECT * FROM contacts WHERE search_vector @@ plainto_tsquery('simple', $1) OR display_name ILIKE $2 ORDER BY display_name ASC LIMIT 50`,
      [q, `%${q}%`],
    );
    return Promise.all(rows.map((r) => this.loadDetails(mapContact(r))));
  }

  // ---- contacts extras / derived ----
  async listColdContacts(days: number): Promise<Record<string, unknown>[]> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const rows = await this.client.many<ContactRow>(
      `SELECT * FROM contacts
        WHERE archived = false AND do_not_contact = false
          AND (last_contacted_at IS NULL OR last_contacted_at < $1)
        ORDER BY last_contacted_at ASC NULLS FIRST LIMIT 100`,
      [cutoff],
    );
    return Promise.all(rows.map((r) => this.loadDetails(mapContact(r))));
  }

  async listContactsNotContactedSince(days: number, limit: number): Promise<Array<{ id: string; display_name: string; last_contacted_at: string | null }>> {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return this.client.many(
      `SELECT id, display_name, last_contacted_at FROM contacts
        WHERE (last_contacted_at IS NULL OR last_contacted_at < $1) AND archived = false LIMIT $2`,
      [cutoff, Math.max(1, limit)],
    );
  }

  async listFollowupDueContacts(onOrBefore: string): Promise<Array<{ id: string; display_name: string; follow_up_at: string }>> {
    return this.client.many(
      `SELECT id, display_name, follow_up_at FROM contacts
        WHERE follow_up_at IS NOT NULL AND follow_up_at <= $1 AND archived = false`,
      [onOrBefore],
    );
  }

  async findContactsForContext(topic: string, limit: number): Promise<Array<{ id: string; display_name: string; job_title: string | null; reason: string }>> {
    const like = `%${topic}%`;
    const [byTitle, byNotes, byCompany, bySpec] = await Promise.all([
      this.client.many<{ id: string; display_name: string; job_title: string | null; reason: string }>(
        `SELECT c.id, c.display_name, c.job_title, 'job_title' AS reason FROM contacts c WHERE c.job_title ILIKE $1 AND c.archived = false LIMIT 20`, [like]),
      this.client.many<{ id: string; display_name: string; job_title: string | null; reason: string }>(
        `SELECT c.id, c.display_name, c.job_title, 'notes' AS reason FROM contacts c WHERE c.notes ILIKE $1 AND c.archived = false LIMIT 10`, [like]),
      this.client.many<{ id: string; display_name: string; job_title: string | null; reason: string }>(
        `SELECT c.id, c.display_name, c.job_title, 'company' AS reason FROM contacts c JOIN companies co ON c.company_id = co.id WHERE (co.name ILIKE $1 OR co.industry ILIKE $1) AND c.archived = false LIMIT 10`, [like]),
      this.client.many<{ id: string; display_name: string; job_title: string | null; reason: string }>(
        `SELECT c.id, c.display_name, c.job_title, om.specialization AS reason FROM contacts c JOIN org_members om ON c.id = om.contact_id WHERE om.specialization ILIKE $1 LIMIT 10`, [like]),
    ]);
    const seen = new Set<string>();
    return [...byTitle, ...bySpec, ...byCompany, ...byNotes].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, limit);
  }

  async findEmailDuplicates(): Promise<Array<{ email: string; contact_ids: string[] }>> {
    const rows = await this.client.many<{ email: string; ids: string }>(
      `SELECT MIN(e.address) AS email, string_agg(e.contact_id, ',') AS ids
        FROM emails e WHERE e.contact_id IS NOT NULL
        GROUP BY LOWER(e.address) HAVING COUNT(*) > 1`,
    );
    return rows.map((r) => ({ email: r.email, contact_ids: (r.ids ?? "").split(",").filter(Boolean) }));
  }

  async findNameDuplicates(): Promise<Array<{ contact_ids: [string, string]; similarity: number }>> {
    const contacts = await this.client.many<{ id: string; display_name: string }>(`SELECT id, display_name FROM contacts`);
    const lev = (a: string, b: string): number => {
      const m = a.length, n = b.length;
      const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
      for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      return dp[m]![n]!;
    };
    const pairs: Array<{ contact_ids: [string, string]; similarity: number }> = [];
    for (let i = 0; i < contacts.length; i++) {
      for (let j = i + 1; j < contacts.length; j++) {
        const dist = lev(contacts[i]!.display_name.toLowerCase(), contacts[j]!.display_name.toLowerCase());
        if (dist <= 2 && dist > 0) pairs.push({ contact_ids: [contacts[i]!.id, contacts[j]!.id], similarity: dist });
      }
    }
    return pairs;
  }

  async getRecentContactEvents(since?: string, eventTypes?: string[]): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [];
    let sql = `SELECT * FROM activity_log WHERE 1=1`;
    if (since) { params.push(since); sql += ` AND created_at >= $${params.length}`; }
    if (eventTypes?.length) {
      const placeholders = eventTypes.map((_, i) => `$${params.length + i + 1}`);
      params.push(...eventTypes);
      sql += ` AND action IN (${placeholders.join(",")})`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    const rows = await this.client.many<Record<string, unknown>>(sql, params);
    return rows.map((r) => ({ ...r, created_at: isoOrNull(r.created_at) }));
  }

  // ---- deals ----
  private mapDeal(r: Record<string, unknown>) {
    return { id: r.id, title: r.title, contact_id: r.contact_id, company_id: r.company_id, stage: r.stage, value_usd: r.value_usd, currency: r.currency, close_date: r.close_date, notes: r.notes, created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
  }
  async createDeal(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO deals (id, title, contact_id, company_id, stage, value_usd, currency, close_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, input.title, input.contact_id ?? null, input.company_id ?? null, input.stage ?? "lead", input.value_usd ?? null, input.currency ?? "USD", input.close_date ?? null, input.notes ?? null],
    );
    return this.mapDeal(row!);
  }
  async getDeal(id: string) {
    const row = await this.client.get<Record<string, unknown>>(`SELECT * FROM deals WHERE id = $1`, [id]);
    return row ? this.mapDeal(row) : null;
  }
  async listDeals(opts: { stage?: string; contact_id?: string; company_id?: string } = {}) {
    const where: string[] = []; const params: unknown[] = [];
    if (opts.stage) { params.push(opts.stage); where.push(`stage = $${params.length}`); }
    if (opts.contact_id) { params.push(opts.contact_id); where.push(`contact_id = $${params.length}`); }
    if (opts.company_id) { params.push(opts.company_id); where.push(`company_id = $${params.length}`); }
    const sql = `SELECT * FROM deals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r) => this.mapDeal(r));
  }
  async updateDeal(id: string, input: Record<string, unknown>) {
    const existing = await this.getDeal(id);
    if (!existing) return null;
    const cols = ["title", "contact_id", "company_id", "stage", "value_usd", "currency", "close_date", "notes"];
    const sets: string[] = []; const params: unknown[] = [id];
    for (const c of cols) if (c in input) { params.push(input[c] ?? null); sets.push(`${c} = $${params.length}`); }
    sets.push(`updated_at = NOW()`);
    const row = await this.client.get<Record<string, unknown>>(`UPDATE deals SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
    return row ? this.mapDeal(row) : null;
  }
  async deleteDeal(id: string) { return (await this.client.query(`DELETE FROM deals WHERE id = $1`, [id])).rowCount > 0; }

  // ---- events ----
  private mapEvent(r: Record<string, unknown>) {
    return { id: r.id, title: r.title, type: r.type, event_date: r.event_date, duration_min: r.duration_min, contact_ids: pj<string[]>(r.contact_ids, []), company_id: r.company_id, notes: r.notes, outcome: r.outcome, deal_id: r.deal_id, created_at: iso(r.created_at) };
  }
  async logEvent(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO events (id, title, type, event_date, duration_min, contact_ids, company_id, notes, outcome, deal_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, input.title, input.type ?? "meeting", input.event_date, input.duration_min ?? null, JSON.stringify(input.contact_ids ?? []), input.company_id ?? null, input.notes ?? null, input.outcome ?? null, input.deal_id ?? null],
    );
    return this.mapEvent(row!);
  }
  async listEvents(opts: { contact_id?: string; company_id?: string; type?: string; date_from?: string; date_to?: string } = {}) {
    const where: string[] = []; const params: unknown[] = [];
    if (opts.contact_id) { params.push(`%${opts.contact_id}%`); where.push(`contact_ids LIKE $${params.length}`); }
    if (opts.company_id) { params.push(opts.company_id); where.push(`company_id = $${params.length}`); }
    if (opts.type) { params.push(opts.type); where.push(`type = $${params.length}`); }
    if (opts.date_from) { params.push(opts.date_from); where.push(`event_date >= $${params.length}`); }
    if (opts.date_to) { params.push(opts.date_to); where.push(`event_date <= $${params.length}`); }
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY event_date DESC`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r) => this.mapEvent(r));
  }
  async deleteEvent(id: string) { return (await this.client.query(`DELETE FROM events WHERE id = $1`, [id])).rowCount > 0; }

  // ---- contact tasks ----
  private mapTask(r: Record<string, unknown>) {
    return { id: r.id, title: r.title, description: r.description, contact_id: r.contact_id, assigned_by: r.assigned_by, deadline: r.deadline, status: r.status, priority: r.priority, entity_id: r.entity_id, linked_todos_task_id: r.linked_todos_task_id, escalation_rules: pj<unknown[]>(r.escalation_rules, []), created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
  }
  async createContactTask(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_tasks (id, title, description, contact_id, assigned_by, deadline, status, priority, entity_id, linked_todos_task_id, escalation_rules)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, input.title, input.description ?? null, input.contact_id, input.assigned_by ?? null, input.deadline ?? null, input.status ?? "pending", input.priority ?? "medium", input.entity_id ?? null, input.linked_todos_task_id ?? null, JSON.stringify(input.escalation_rules ?? [])],
    );
    return this.mapTask(row!);
  }
  async listContactTasks(opts: { contact_id?: string; entity_id?: string; status?: string; priority?: string } = {}) {
    const where: string[] = []; const params: unknown[] = [];
    if (opts.contact_id) { params.push(opts.contact_id); where.push(`contact_id = $${params.length}`); }
    if (opts.entity_id) { params.push(opts.entity_id); where.push(`entity_id = $${params.length}`); }
    if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
    if (opts.priority) { params.push(opts.priority); where.push(`priority = $${params.length}`); }
    const sql = `SELECT * FROM contact_tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY deadline ASC NULLS LAST, priority DESC, created_at ASC`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r) => this.mapTask(r));
  }
  async updateContactTask(id: string, input: Record<string, unknown>) {
    const cols = ["title", "description", "assigned_by", "deadline", "status", "priority", "entity_id", "linked_todos_task_id"];
    const sets: string[] = []; const params: unknown[] = [id];
    for (const c of cols) if (c in input) { params.push(input[c] ?? null); sets.push(`${c} = $${params.length}`); }
    if ("escalation_rules" in input) { params.push(JSON.stringify(input.escalation_rules)); sets.push(`escalation_rules = $${params.length}`); }
    sets.push(`updated_at = NOW()`);
    const row = await this.client.get<Record<string, unknown>>(`UPDATE contact_tasks SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
    return row ? this.mapTask(row) : null;
  }
  async deleteContactTask(id: string) { return (await this.client.query(`DELETE FROM contact_tasks WHERE id = $1`, [id])).rowCount > 0; }
  async listOverdueTasks() {
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT * FROM contact_tasks WHERE deadline < $1 AND status NOT IN ('completed','cancelled') ORDER BY deadline ASC`, [nowIso()],
    );
    return rows.map((r) => this.mapTask(r));
  }
  async checkEscalations() {
    const overdue = await this.listOverdueTasks();
    const nowMs = Date.now();
    const results: Array<{ task: Record<string, unknown>; rules_triggered: Array<{ after_days: number }> }> = [];
    for (const task of overdue) {
      const rules = (task.escalation_rules ?? []) as Array<{ after_days: number }>;
      if (!task.deadline || rules.length === 0) continue;
      const days = (nowMs - new Date(task.deadline as string).getTime()) / 86400000;
      const triggered = rules.filter((r) => days >= r.after_days);
      if (triggered.length) results.push({ task, rules_triggered: triggered });
    }
    return results;
  }

  // ---- applications ----
  private mapApplication(r: Record<string, unknown>) {
    return { id: r.id, program_name: r.program_name, provider_company_id: r.provider_company_id, type: r.type, value_usd: r.value_usd, applicant_contact_id: r.applicant_contact_id, primary_contact_id: r.primary_contact_id, status: r.status, submitted_date: r.submitted_date, decision_date: r.decision_date, follow_up_date: r.follow_up_date, notes: r.notes, method: r.method ?? null, form_url: r.form_url, metadata: pj<Record<string, unknown>>(r.metadata, {}), created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
  }
  async createApplication(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO applications (id, program_name, provider_company_id, type, value_usd, applicant_contact_id, primary_contact_id, status, submitted_date, decision_date, follow_up_date, notes, method, form_url, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, input.program_name, input.provider_company_id ?? null, input.type ?? "other", input.value_usd ?? null, input.applicant_contact_id ?? null, input.primary_contact_id ?? null, input.status ?? "draft", input.submitted_date ?? null, input.decision_date ?? null, input.follow_up_date ?? null, input.notes ?? null, input.method ?? null, input.form_url ?? null, JSON.stringify(input.metadata ?? {})],
    );
    return this.mapApplication(row!);
  }
  async listApplications(opts: { type?: string; status?: string; provider_company_id?: string; applicant_contact_id?: string } = {}) {
    const where: string[] = []; const params: unknown[] = [];
    if (opts.type) { params.push(opts.type); where.push(`type = $${params.length}`); }
    if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
    if (opts.provider_company_id) { params.push(opts.provider_company_id); where.push(`provider_company_id = $${params.length}`); }
    if (opts.applicant_contact_id) { params.push(opts.applicant_contact_id); where.push(`applicant_contact_id = $${params.length}`); }
    const sql = `SELECT * FROM applications ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r) => this.mapApplication(r));
  }
  async updateApplication(id: string, input: Record<string, unknown>) {
    const cols = ["program_name", "provider_company_id", "type", "value_usd", "applicant_contact_id", "primary_contact_id", "status", "submitted_date", "decision_date", "follow_up_date", "notes", "method", "form_url"];
    const sets: string[] = []; const params: unknown[] = [id];
    for (const c of cols) if (c in input) { params.push(input[c] ?? null); sets.push(`${c} = $${params.length}`); }
    if ("metadata" in input) { params.push(JSON.stringify(input.metadata)); sets.push(`metadata = $${params.length}`); }
    sets.push(`updated_at = NOW()`);
    const row = await this.client.get<Record<string, unknown>>(`UPDATE applications SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
    return row ? this.mapApplication(row) : null;
  }
  async listFollowUpDueApplications() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT * FROM applications WHERE follow_up_date <= $1 AND status = 'follow_up_needed' ORDER BY follow_up_date ASC`, [today],
    );
    return rows.map((r) => this.mapApplication(r));
  }

  // ---- groups ----
  private mapGroup(r: Record<string, unknown>) {
    return { ...r, created_at: isoOrNull(r.created_at), updated_at: isoOrNull(r.updated_at), member_count: r.member_count != null ? Number(r.member_count) : undefined, company_count: r.company_count != null ? Number(r.company_count) : undefined };
  }
  async createGroup(input: Record<string, unknown>) {
    const id = newUuid();
    await this.client.execute(
      `INSERT INTO groups (id, name, description, project_id) VALUES ($1,$2,$3,$4)`,
      [id, input.name, input.description ?? null, input.project_id ?? null],
    );
    return this.getGroup(id);
  }
  async getGroup(id: string) {
    const row = await this.client.get<Record<string, unknown>>(`SELECT * FROM groups WHERE id = $1`, [id]);
    return row ? this.mapGroup(row) : null;
  }
  async listGroups(projectId?: string) {
    const params: unknown[] = [];
    let where = "";
    if (projectId) { params.push(projectId); where = `WHERE g.project_id = $1`; }
    const rows = await this.client.many<Record<string, unknown>>(
      `SELECT g.*, (SELECT COUNT(*) FROM contact_groups cg WHERE cg.group_id = g.id) AS member_count,
              (SELECT COUNT(*) FROM company_groups cog WHERE cog.group_id = g.id) AS company_count
       FROM groups g ${where} ORDER BY g.name`, params,
    );
    return rows.map((r) => this.mapGroup(r));
  }
  async updateGroup(id: string, input: Record<string, unknown>) {
    const sets: string[] = []; const params: unknown[] = [id];
    for (const c of ["name", "description", "project_id"]) if (c in input) { params.push(input[c] ?? null); sets.push(`${c} = $${params.length}`); }
    sets.push(`updated_at = NOW()`);
    await this.client.execute(`UPDATE groups SET ${sets.join(", ")} WHERE id = $1`, params);
    return this.getGroup(id);
  }
  async deleteGroup(id: string) { return (await this.client.query(`DELETE FROM groups WHERE id = $1`, [id])).rowCount > 0; }
  async addContactToGroup(contactId: string, groupId: string) {
    const existing = await this.client.get(`SELECT 1 FROM contact_groups WHERE contact_id = $1 AND group_id = $2`, [contactId, groupId]);
    if (existing) return { added: false, already_member: true };
    await this.client.execute(`INSERT INTO contact_groups (contact_id, group_id) VALUES ($1,$2)`, [contactId, groupId]);
    return { added: true, already_member: false };
  }
  async removeContactFromGroup(contactId: string, groupId: string) { await this.client.execute(`DELETE FROM contact_groups WHERE contact_id = $1 AND group_id = $2`, [contactId, groupId]); }
  async listContactsInGroup(groupId: string) {
    return (await this.client.many<{ contact_id: string }>(`SELECT contact_id FROM contact_groups WHERE group_id = $1`, [groupId])).map((r) => r.contact_id);
  }
  async listGroupsForContact(contactId: string) {
    const rows = await this.client.many<Record<string, unknown>>(`SELECT g.* FROM groups g JOIN contact_groups cg ON g.id = cg.group_id WHERE cg.contact_id = $1 ORDER BY g.name`, [contactId]);
    return rows.map((r) => this.mapGroup(r));
  }
  async addCompanyToGroup(companyId: string, groupId: string) {
    const existing = await this.client.get(`SELECT 1 FROM company_groups WHERE company_id = $1 AND group_id = $2`, [companyId, groupId]);
    if (existing) return { added: false, already_member: true };
    await this.client.execute(`INSERT INTO company_groups (company_id, group_id) VALUES ($1,$2)`, [companyId, groupId]);
    return { added: true, already_member: false };
  }
  async removeCompanyFromGroup(companyId: string, groupId: string) { await this.client.execute(`DELETE FROM company_groups WHERE company_id = $1 AND group_id = $2`, [companyId, groupId]); }
  async listCompaniesInGroup(groupId: string) {
    return (await this.client.many<{ company_id: string }>(`SELECT company_id FROM company_groups WHERE group_id = $1`, [groupId])).map((r) => r.company_id);
  }
  async listGroupsForCompany(companyId: string) {
    const rows = await this.client.many<Record<string, unknown>>(`SELECT g.* FROM groups g JOIN company_groups cog ON g.id = cog.group_id WHERE cog.company_id = $1 ORDER BY g.name`, [companyId]);
    return rows.map((r) => this.mapGroup(r));
  }

  // ---- vendor communications ----
  private mapVendorComm(r: Record<string, unknown>) {
    return { id: r.id, company_id: r.company_id, contact_id: r.contact_id, comm_date: r.comm_date, type: r.type, direction: r.direction, subject: r.subject, body: r.body, status: r.status, invoice_amount: r.invoice_amount, invoice_currency: r.invoice_currency, invoice_ref: r.invoice_ref, follow_up_date: r.follow_up_date, follow_up_done: Boolean(r.follow_up_done), created_at: iso(r.created_at) };
  }
  async logVendorCommunication(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO vendor_communications (id, company_id, contact_id, comm_date, type, direction, subject, body, status, invoice_amount, invoice_currency, invoice_ref, follow_up_date, follow_up_done)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, input.company_id, input.contact_id ?? null, input.comm_date, input.type ?? "email", input.direction ?? "outbound", input.subject ?? null, input.body ?? null, input.status ?? "sent", input.invoice_amount ?? null, input.invoice_currency ?? null, input.invoice_ref ?? null, input.follow_up_date ?? null, Boolean(input.follow_up_done)],
    );
    return this.mapVendorComm(row!);
  }
  async listVendorCommunications(companyId: string, opts: { type?: string; status?: string; direction?: string } = {}) {
    const where = ["company_id = $1"]; const params: unknown[] = [companyId];
    if (opts.type) { params.push(opts.type); where.push(`type = $${params.length}`); }
    if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
    if (opts.direction) { params.push(opts.direction); where.push(`direction = $${params.length}`); }
    const rows = await this.client.many<Record<string, unknown>>(`SELECT * FROM vendor_communications WHERE ${where.join(" AND ")} ORDER BY comm_date DESC`, params);
    return rows.map((r) => this.mapVendorComm(r));
  }
  async listMissingInvoices() {
    const rows = await this.client.many<Record<string, unknown>>(`SELECT * FROM vendor_communications WHERE type = 'invoice_request' AND status IN ('awaiting_response','no_response') ORDER BY comm_date ASC`);
    return rows.map((r) => this.mapVendorComm(r));
  }
  async listPendingFollowUps() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.client.many<Record<string, unknown>>(`SELECT * FROM vendor_communications WHERE follow_up_date <= $1 AND follow_up_done = false ORDER BY follow_up_date ASC`, [today]);
    return rows.map((r) => this.mapVendorComm(r));
  }
  async markFollowUpDone(id: string) {
    const row = await this.client.get<Record<string, unknown>>(`UPDATE vendor_communications SET follow_up_done = true WHERE id = $1 RETURNING *`, [id]);
    return row ? this.mapVendorComm(row) : null;
  }

  // ---- org members ----
  private mapOrgMember(r: Record<string, unknown>) {
    return { id: r.id, company_id: r.company_id, contact_id: r.contact_id, title: r.title, specialization: r.specialization, office_phone: r.office_phone, response_sla_hours: r.response_sla_hours, notes: r.notes, created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
  }
  async addOrgMember(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO org_members (id, company_id, contact_id, title, specialization, office_phone, response_sla_hours, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, input.company_id, input.contact_id, input.title ?? null, input.specialization ?? null, input.office_phone ?? null, input.response_sla_hours ?? null, input.notes ?? null],
    );
    return this.mapOrgMember(row!);
  }
  async listOrgMembers(companyId: string) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM org_members WHERE company_id = $1 ORDER BY created_at ASC`, [companyId])).map((r) => this.mapOrgMember(r));
  }
  async updateOrgMember(id: string, input: Record<string, unknown>) {
    const sets: string[] = []; const params: unknown[] = [id];
    for (const c of ["title", "specialization", "office_phone", "response_sla_hours", "notes"]) if (c in input) { params.push(input[c] ?? null); sets.push(`${c} = $${params.length}`); }
    sets.push(`updated_at = NOW()`);
    const row = await this.client.get<Record<string, unknown>>(`UPDATE org_members SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
    return row ? this.mapOrgMember(row) : null;
  }
  async removeOrgMember(id: string) { return (await this.client.query(`DELETE FROM org_members WHERE id = $1`, [id])).rowCount > 0; }
  async listOrgMembersForContact(contactId: string) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM org_members WHERE contact_id = $1 ORDER BY created_at ASC`, [contactId])).map((r) => this.mapOrgMember(r));
  }

  // ---- notes ----
  private mapNote(r: Record<string, unknown>): Record<string, unknown> { return { ...r, created_at: isoOrNull(r.created_at) }; }
  async addNote(contactId: string, body: string, createdBy?: string, companyId?: string) {
    const contact = await this.client.get(`SELECT id FROM contacts WHERE id = $1`, [contactId]);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_notes (id, contact_id, body, created_by, company_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, contactId, body, createdBy ?? null, companyId ?? null],
    );
    return this.mapNote(row!);
  }
  async listNotes(contactId: string) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_notes WHERE contact_id = $1 ORDER BY created_at ASC`, [contactId])).map((r) => this.mapNote(r));
  }
  async listNotesForContactAtCompany(contactId: string, companyId: string) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_notes WHERE contact_id = $1 AND company_id = $2 ORDER BY created_at ASC`, [contactId, companyId])).map((r) => this.mapNote(r));
  }
  async deleteNote(noteId: string) { await this.client.execute(`DELETE FROM contact_notes WHERE id = $1`, [noteId]); }

  // ---- relationships ----
  async createRelationship(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_relationships (id, contact_a_id, contact_b_id, relationship_type, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, input.contact_a_id, input.contact_b_id, input.relationship_type ?? "knows", input.notes ?? null],
    );
    return { ...row, created_at: isoOrNull(row?.created_at) };
  }
  async listRelationships(opts: { contact_id?: string } = {}) {
    if (opts.contact_id) {
      return this.client.many<Record<string, unknown>>(`SELECT * FROM contact_relationships WHERE contact_a_id = $1 OR contact_b_id = $1`, [opts.contact_id]);
    }
    return this.client.many<Record<string, unknown>>(`SELECT * FROM contact_relationships`);
  }
  async deleteRelationship(id: string) { await this.client.execute(`DELETE FROM contact_relationships WHERE id = $1`, [id]); }
  async createCompanyRelationship(input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO company_relationships (id, contact_id, company_id, relationship_type, notes, start_date, end_date, is_primary, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, input.contact_id, input.company_id, input.relationship_type, input.notes ?? null, input.start_date ?? null, input.end_date ?? null, Boolean(input.is_primary), input.status ?? "active"],
    );
    return { ...row, created_at: isoOrNull(row?.created_at), is_primary: Boolean(row?.is_primary) };
  }
  async listCompanyRelationships(opts: { contact_id?: string; company_id?: string } = {}) {
    const where: string[] = []; const params: unknown[] = [];
    if (opts.contact_id) { params.push(opts.contact_id); where.push(`contact_id = $${params.length}`); }
    if (opts.company_id) { params.push(opts.company_id); where.push(`company_id = $${params.length}`); }
    const sql = `SELECT * FROM company_relationships ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r): Record<string, unknown> => ({ ...r, created_at: isoOrNull(r.created_at), is_primary: Boolean(r.is_primary) }));
  }
  async deleteCompanyRelationship(id: string) { await this.client.execute(`DELETE FROM company_relationships WHERE id = $1`, [id]); }

  // ---- field history ----
  async getFieldHistory(contactId: string, fieldName?: string) {
    const rows = fieldName
      ? await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_field_history WHERE contact_id = $1 AND field_name = $2 ORDER BY valid_from DESC`, [contactId, fieldName])
      : await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_field_history WHERE contact_id = $1 ORDER BY valid_from DESC`, [contactId]);
    return rows.map((r) => ({ ...r, valid_from: isoOrNull(r.valid_from), created_at: isoOrNull(r.created_at) }));
  }
  async getContactAt(contactId: string, timestamp: string) {
    const rows = await this.client.many<{ field_name: string; new_value: string | null }>(
      `SELECT field_name, new_value FROM contact_field_history WHERE contact_id = $1 AND valid_from <= $2 ORDER BY valid_from ASC`, [contactId, timestamp],
    );
    const result: Record<string, string> = {};
    for (const r of rows) if (r.new_value != null) result[r.field_name] = r.new_value;
    return result;
  }

  // ---- job history ----
  private mapJob(r: Record<string, unknown>) { return { ...r, is_current: Boolean(r.is_current), inferred: Boolean(r.inferred), created_at: isoOrNull(r.created_at) }; }
  async addJobEntry(contactId: string, input: Record<string, unknown>) {
    if (input.is_current) {
      await this.client.execute(`UPDATE job_history SET is_current = false, end_date = COALESCE(end_date, $1) WHERE contact_id = $2 AND is_current = true`, [new Date().toISOString().slice(0, 10), contactId]);
    }
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO job_history (id, contact_id, company_id, company_name, title, start_date, end_date, is_current, inferred, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, contactId, input.company_id ?? null, input.company_name, input.title ?? null, input.start_date ?? null, input.end_date ?? null, Boolean(input.is_current), Boolean(input.inferred), input.source ?? null],
    );
    return this.mapJob(row!);
  }
  async getJobHistory(contactId: string) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM job_history WHERE contact_id = $1 ORDER BY is_current DESC, start_date DESC`, [contactId])).map((r) => this.mapJob(r));
  }

  // ---- learnings ----
  private mapLearning(r: Record<string, unknown>): Record<string, unknown> { return { ...r, tags: pj<string[]>(r.tags, []), created_at: isoOrNull(r.created_at), updated_at: isoOrNull(r.updated_at) }; }
  async saveLearning(contactId: string, input: Record<string, unknown>) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_learnings (id, contact_id, content, type, confidence, importance, learned_by, session_id, visibility, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, contactId, input.content, input.type ?? "fact", input.confidence ?? 70, input.importance ?? 5, input.learned_by ?? null, input.session_id ?? null, input.visibility ?? "shared", JSON.stringify(input.tags ?? [])],
    );
    return this.mapLearning(row!);
  }
  async getLearnings(contactId: string, opts: { type?: string; min_importance?: number; visibility?: string } = {}) {
    let sql = `SELECT * FROM contact_learnings WHERE contact_id = $1`; const params: unknown[] = [contactId];
    if (opts.type) { params.push(opts.type); sql += ` AND type = $${params.length}`; }
    if (opts.min_importance) { params.push(opts.min_importance); sql += ` AND importance >= $${params.length}`; }
    if (opts.visibility) { params.push(opts.visibility); sql += ` AND visibility = $${params.length}`; }
    sql += ` ORDER BY importance DESC, confidence DESC`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r) => this.mapLearning(r));
  }
  async searchLearnings(query: string, opts: { type?: string; contact_id?: string } = {}) {
    let sql = `SELECT * FROM contact_learnings WHERE content ILIKE $1`; const params: unknown[] = [`%${query}%`];
    if (opts.type) { params.push(opts.type); sql += ` AND type = $${params.length}`; }
    if (opts.contact_id) { params.push(opts.contact_id); sql += ` AND contact_id = $${params.length}`; }
    sql += ` ORDER BY importance DESC, confidence DESC LIMIT 50`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r) => this.mapLearning(r));
  }
  async confirmLearning(learningId: string) {
    await this.client.execute(`UPDATE contact_learnings SET confirmed_count = confirmed_count + 1, confidence = LEAST(100, confidence + 10), updated_at = NOW() WHERE id = $1`, [learningId]);
  }
  async getStaleLearnings(daysOld: number, minConfidence: number) {
    const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_learnings WHERE confirmed_count = 0 AND created_at < $1 AND confidence >= $2 ORDER BY confidence ASC LIMIT 50`, [cutoff, minConfidence])).map((r) => this.mapLearning(r));
  }
  async runLearningMaintenance() {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const res = await this.client.query(`UPDATE contact_learnings SET confidence = GREATEST(10, confidence - 5), updated_at = NOW() WHERE confirmed_count = 0 AND created_at < $1 AND confidence > 10`, [cutoff]);
    const dups = await this.client.many<Record<string, unknown>>(`SELECT contact_id, COUNT(*) AS cnt FROM contact_learnings GROUP BY contact_id, LOWER(SUBSTR(content,1,30)) HAVING COUNT(*) > 1`);
    return { decayed_count: res.rowCount, potential_contradictions: dups };
  }

  // ---- coordination (locks / activity) ----
  private mapLock(r: Record<string, unknown>) { return { ...r, acquired_at: isoOrNull(r.acquired_at), expires_at: isoOrNull(r.expires_at) }; }
  async acquireContactLock(contactId: string, agentName: string, ttlSeconds = 300, reason?: string, sessionId?: string) {
    await this.client.execute(`DELETE FROM contact_locks WHERE expires_at < NOW()`);
    const existing = await this.client.get<Record<string, unknown>>(`SELECT * FROM contact_locks WHERE contact_id = $1`, [contactId]);
    if (existing) return { acquired: false, held_by: existing.agent_name, lock: this.mapLock(existing) };
    const id = newUuid();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_locks (id, contact_id, agent_name, reason, expires_at, session_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, contactId, agentName, reason ?? null, expiresAt, sessionId ?? null],
    );
    return { acquired: true, lock: this.mapLock(row!) };
  }
  async releaseContactLock(contactId: string, agentName: string) {
    return (await this.client.query(`DELETE FROM contact_locks WHERE contact_id = $1 AND agent_name = $2`, [contactId, agentName])).rowCount > 0;
  }
  async checkContactLock(contactId: string) {
    await this.client.execute(`DELETE FROM contact_locks WHERE expires_at < NOW()`);
    const row = await this.client.get<Record<string, unknown>>(`SELECT * FROM contact_locks WHERE contact_id = $1`, [contactId]);
    return row ? this.mapLock(row) : null;
  }
  async logAgentActivity(contactId: string, agentName: string, action: string, details?: string, sessionId?: string) {
    await this.client.execute(`INSERT INTO contact_agent_activity (id, contact_id, agent_name, action, details, session_id) VALUES ($1,$2,$3,$4,$5,$6)`, [newUuid(), contactId, agentName, action, details ?? null, sessionId ?? null]);
  }
  async getAgentActivity(contactId: string, limit = 20) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_agent_activity WHERE contact_id = $1 ORDER BY created_at DESC LIMIT $2`, [contactId, limit])).map((r) => ({ ...r, created_at: isoOrNull(r.created_at) }));
  }

  // ---- identity ----
  async resolveContactIdentity(partial: { name?: string; email?: string; phone?: string; linkedin_url?: string }) {
    const matches = new Map<string, { contact: { id: string; display_name: string; job_title?: string }; confidence_score: number; match_reasons: string[] }>();
    const add = (id: string, name: string, title: string | undefined, score: number, reason: string) => {
      const ex = matches.get(id);
      if (ex) { ex.confidence_score = Math.min(100, ex.confidence_score + score); ex.match_reasons.push(reason); }
      else matches.set(id, { contact: { id, display_name: name, job_title: title }, confidence_score: score, match_reasons: [reason] });
    };
    if (partial.email) {
      const rows = await this.client.many<{ id: string; display_name: string; job_title?: string }>(`SELECT c.id, c.display_name, c.job_title FROM contacts c JOIN emails e ON c.id = e.contact_id WHERE LOWER(e.address) = LOWER($1)`, [partial.email]);
      rows.forEach((r) => add(r.id, r.display_name, r.job_title, 90, `email match: ${partial.email}`));
    }
    if (partial.linkedin_url) {
      const tail = partial.linkedin_url.split("/").pop();
      const rows = await this.client.many<{ id: string; display_name: string; job_title?: string }>(`SELECT c.id, c.display_name, c.job_title FROM contacts c JOIN social_profiles sp ON c.id = sp.contact_id WHERE sp.platform = 'linkedin' AND sp.url LIKE $1`, [`%${tail}%`]);
      rows.forEach((r) => add(r.id, r.display_name, r.job_title, 85, `linkedin match`));
    }
    if (partial.name) {
      const rows = await this.client.many<{ id: string; display_name: string; job_title?: string }>(`SELECT id, display_name, job_title FROM contacts WHERE display_name ILIKE $1 AND archived = false LIMIT 10`, [`%${partial.name}%`]);
      rows.forEach((r) => add(r.id, r.display_name, r.job_title, 40, `name match: ${partial.name}`));
    }
    return Array.from(matches.values()).sort((a, b) => b.confidence_score - a.confidence_score);
  }
  async addContactIdentity(contactId: string, system: string, externalId: string, externalUrl?: string, confidence: "verified" | "inferred" = "inferred") {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_identities (id, contact_id, system, external_id, external_url, confidence) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (system, external_id) DO UPDATE SET contact_id = excluded.contact_id, external_url = excluded.external_url, confidence = excluded.confidence RETURNING *`,
      [id, contactId, system, externalId, externalUrl ?? null, confidence],
    );
    return { ...row, created_at: isoOrNull(row?.created_at) };
  }
  async getContactIdentities(contactId: string) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_identities WHERE contact_id = $1 ORDER BY created_at DESC`, [contactId])).map((r) => ({ ...r, created_at: isoOrNull(r.created_at) }));
  }

  // ---- signals ----
  private signalRow(r: Record<string, unknown>) {
    const last = r.last_contacted_at as string | null;
    return {
      contact_id: r.contact_id, display_name: r.display_name, last_contacted_at: last,
      interaction_count_30d: Number(r.interaction_count_30d ?? 0), engagement_status: r.engagement_status ?? null,
      relationship_health: r.relationship_health ?? null,
      days_since_contact: last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null,
    };
  }
  async getRelationshipSignals(contactId: string) {
    const row = await this.client.get<Record<string, unknown>>(`SELECT id AS contact_id, display_name, last_contacted_at, interaction_count_30d, engagement_status, relationship_health FROM contacts WHERE id = $1`, [contactId]);
    if (!row) return [];
    const base = this.signalRow(row);
    const cnt = base.interaction_count_30d; const health = (base.relationship_health as number) ?? 50; const daysSince = base.days_since_contact;
    let signal_type = "healthy"; let reason = `Last contact ${daysSince}d ago, ${cnt} interactions in 30d`;
    if (daysSince === null || daysSince > 180) { signal_type = "ghost"; reason = "No contact in 180+ days or never contacted"; }
    else if (daysSince > 60 && cnt === 0) { signal_type = "cooling"; reason = `No contact in ${daysSince} days, no recent interactions`; }
    else if (cnt > 3 && health > 70) { signal_type = "warming"; reason = `${cnt} interactions in last 30 days, health score ${health}`; }
    return [{ ...base, signal_type, reason }];
  }
  async getGhostContacts() {
    const cutoff = new Date(Date.now() - 180 * 86400000).toISOString();
    const rows = await this.client.many<Record<string, unknown>>(`SELECT id AS contact_id, display_name, last_contacted_at, interaction_count_30d, engagement_status, relationship_health FROM contacts WHERE (last_contacted_at IS NULL OR last_contacted_at < $1) AND archived = false ORDER BY last_contacted_at ASC NULLS FIRST LIMIT 50`, [cutoff]);
    return rows.map((r) => ({ ...this.signalRow(r), signal_type: "ghost", reason: "No contact in 180+ days or never contacted" }));
  }
  async getWarmingContacts() {
    const rows = await this.client.many<Record<string, unknown>>(`SELECT id AS contact_id, display_name, last_contacted_at, interaction_count_30d, engagement_status, relationship_health FROM contacts WHERE interaction_count_30d > 2 AND relationship_health > 60 AND archived = false ORDER BY relationship_health DESC LIMIT 50`);
    return rows.map((r) => ({ ...this.signalRow(r), signal_type: "warming", reason: `${Number(r.interaction_count_30d ?? 0)} interactions in last 30 days` }));
  }
  async recomputeSignals() {
    const res = await this.client.query(
      `UPDATE contacts SET engagement_status = CASE
          WHEN interaction_count_30d > 3 THEN 'warming'
          WHEN last_contacted_at IS NULL OR EXTRACT(EPOCH FROM (NOW() - last_contacted_at::timestamptz)) / 86400 > 180 THEN 'ghost'
          WHEN EXTRACT(EPOCH FROM (NOW() - last_contacted_at::timestamptz)) / 86400 > 60 THEN 'cooling'
          ELSE 'stable' END,
        updated_at = NOW() WHERE archived = false`,
    );
    return { updated: res.rowCount };
  }

  // ---- freshness ----
  async getFreshnessScore(contactId: string) {
    const contact = await this.client.get<Record<string, unknown>>(`SELECT * FROM contacts WHERE id = $1`, [contactId]);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    const historyRows = await this.client.many<{ field_name: string; new_value: string | null; source: string | null; created_at: unknown }>(`SELECT field_name, new_value, source, created_at FROM contact_field_history WHERE contact_id = $1 ORDER BY created_at DESC`, [contactId]);
    const verifiedRows = await this.client.many<{ field_name: string; last_verified_at: unknown; source: string | null }>(`SELECT field_name, last_verified_at, source FROM contact_field_confidence WHERE contact_id = $1 AND confidence = 'verified'`, [contactId]).catch(() => []);
    const scored = ["display_name", "job_title", "company_id", "emails", "phones", "last_contacted_at"];
    const verifiedMap = new Map(verifiedRows.map((r) => [r.field_name, r]));
    const historyMap = new Map<string, (typeof historyRows)[0]>();
    for (const r of historyRows) if (!historyMap.has(r.field_name)) historyMap.set(r.field_name, r);
    const fields = [] as Array<{ field_name: string; value: string | null; last_verified_at: string | null; source: string | null; confidence: string; days_old: number | null }>;
    for (const field of scored) {
      let value: string | null = null;
      if (field === "emails") { const e = await this.client.get<{ address: string }>(`SELECT address FROM emails WHERE contact_id = $1 LIMIT 1`, [contactId]); value = e?.address ?? null; }
      else if (field === "phones") { const p = await this.client.get<{ number: string }>(`SELECT number FROM phones WHERE contact_id = $1 LIMIT 1`, [contactId]); value = p?.number ?? null; }
      else value = contact[field] != null ? String(contact[field]) : null;
      const verified = verifiedMap.get(field); const history = historyMap.get(field);
      let confidence = "unknown"; let days_old: number | null = null; let last_verified_at: string | null = null; let source: string | null = null;
      if (verified) { confidence = "verified"; last_verified_at = isoOrNull(verified.last_verified_at); source = verified.source; days_old = last_verified_at ? Math.floor((Date.now() - new Date(last_verified_at).getTime()) / 86400000) : null; }
      else if (history) { confidence = history.source === "import" ? "imported" : "inferred"; last_verified_at = isoOrNull(history.created_at); source = history.source; days_old = last_verified_at ? Math.floor((Date.now() - new Date(last_verified_at).getTime()) / 86400000) : null; if (days_old != null && days_old > 365) confidence = "stale"; }
      else if (value) confidence = "inferred";
      fields.push({ field_name: field, value, last_verified_at, source, confidence, days_old });
    }
    const fieldScore = fields.reduce((acc, f) => { if (!f.value) return acc; if (f.confidence === "verified") return acc + 20; if (f.confidence === "imported" || f.confidence === "inferred") return acc + 10; return acc + 5; }, 0);
    return { contact_id: contactId, overall_score: Math.min(100, fieldScore), fields, stale_fields: fields.filter((f) => f.confidence === "stale" || (!f.value && f.field_name !== "phones")).map((f) => f.field_name), verified_fields: fields.filter((f) => f.confidence === "verified").map((f) => f.field_name) };
  }
  async getStaleContacts(threshold = 40) {
    return this.client.many<{ contact_id: string; display_name: string; score: number }>(
      `SELECT * FROM (
        SELECT c.id AS contact_id, c.display_name,
          ((CASE WHEN c.job_title IS NOT NULL THEN 15 ELSE 0 END) +
           (CASE WHEN c.company_id IS NOT NULL THEN 15 ELSE 0 END) +
           (CASE WHEN c.last_contacted_at IS NOT NULL THEN 20 ELSE 0 END) +
           (CASE WHEN EXISTS(SELECT 1 FROM emails WHERE contact_id = c.id) THEN 20 ELSE 0 END) +
           (CASE WHEN EXISTS(SELECT 1 FROM phones WHERE contact_id = c.id) THEN 15 ELSE 0 END) +
           (CASE WHEN c.notes IS NOT NULL THEN 10 ELSE 0 END) +
           (CASE WHEN EXISTS(SELECT 1 FROM contact_tags WHERE contact_id = c.id) THEN 5 ELSE 0 END)) AS score
        FROM contacts c WHERE c.archived = false
      ) sub WHERE score < $1 ORDER BY score ASC LIMIT 100`, [threshold],
    );
  }
  async markFieldVerified(contactId: string, fieldName: string, source?: string) {
    await this.client.execute(
      `INSERT INTO contact_field_confidence (id, contact_id, field_name, confidence, source, last_verified_at) VALUES ($1,$2,$3,'verified',$4,NOW())
       ON CONFLICT (contact_id, field_name) DO UPDATE SET confidence = 'verified', source = excluded.source, last_verified_at = NOW()`,
      [newUuid(), contactId, fieldName, source ?? null],
    );
  }

  // ---- graph ----
  async computeRelationshipStrength(contactId: string) {
    const c = await this.client.get<{ last_contacted_at: string | null; interaction_count_30d: number }>(`SELECT last_contacted_at, interaction_count_30d FROM contacts WHERE id = $1`, [contactId]);
    if (!c) return 0;
    let score = 50;
    if (c.last_contacted_at) { const days = Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000); score += days < 7 ? 30 : days < 30 ? 20 : days < 90 ? 5 : -20; } else score -= 20;
    score += Math.min(20, (c.interaction_count_30d || 0) * 4);
    return Math.max(0, Math.min(100, score));
  }
  async findWarmPath(fromContactId: string, toContactId: string) {
    const visited = new Set<string>([fromContactId]);
    const queue: Array<{ id: string; path: Array<{ contact_id: string; display_name: string; strength: number }> }> = [{ id: fromContactId, path: [] }];
    while (queue.length) {
      const { id, path } = queue.shift()!;
      if (id === toContactId) return path;
      if (path.length >= 4) continue;
      const neighbors = await this.client.many<{ contact_a_id: string; contact_b_id: string; display_name: string; strength_score?: number }>(
        `SELECT cr.contact_a_id, cr.contact_b_id, cr.strength_score, c.display_name FROM contact_relationships cr JOIN contacts c ON (CASE WHEN cr.contact_a_id = $1 THEN cr.contact_b_id ELSE cr.contact_a_id END) = c.id WHERE cr.contact_a_id = $1 OR cr.contact_b_id = $1 LIMIT 20`, [id],
      );
      for (const n of neighbors) {
        const nextId = n.contact_a_id === id ? n.contact_b_id : n.contact_a_id;
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push({ id: nextId, path: [...path, { contact_id: nextId, display_name: n.display_name, strength: n.strength_score || 50 }] });
      }
    }
    return [];
  }
  async findConnectionsAtCompany(companyId: string) {
    return this.client.many<{ contact_id: string; display_name: string; job_title?: string; strength: number }>(`SELECT c.id AS contact_id, c.display_name, c.job_title, c.relationship_health AS strength FROM contacts c WHERE c.company_id = $1 AND c.archived = false ORDER BY c.relationship_health DESC`, [companyId]);
  }
  async detectCoolingRelationships() {
    const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
    const rows = await this.client.many<{ contact_id: string; display_name: string; last_contacted_at: string }>(`SELECT id AS contact_id, display_name, last_contacted_at FROM contacts WHERE last_contacted_at IS NOT NULL AND last_contacted_at < $1 AND engagement_status != 'ghost' AND archived = false ORDER BY last_contacted_at ASC LIMIT 50`, [cutoff]);
    return rows.map((r) => ({ contact_id: r.contact_id, display_name: r.display_name, days_since: Math.floor((Date.now() - new Date(r.last_contacted_at).getTime()) / 86400000) }));
  }

  // ---- org chart ----
  async addOrgChartEdge(companyId: string, contactAId: string, contactBId: string, edgeType: string, inferred = false) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO org_chart_edges (id, company_id, contact_a_id, contact_b_id, edge_type, inferred) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (company_id, contact_a_id, contact_b_id, edge_type) DO UPDATE SET inferred = excluded.inferred RETURNING *`,
      [id, companyId, contactAId, contactBId, edgeType, inferred],
    );
    return { ...row, inferred: Boolean(row?.inferred), created_at: isoOrNull(row?.created_at) };
  }
  async listOrgChart(companyId: string) {
    return this.client.many<{ contact_a_name: string; contact_b_name: string; edge_type: string }>(
      `SELECT ca.display_name AS contact_a_name, cb.display_name AS contact_b_name, e.edge_type
       FROM org_chart_edges e JOIN contacts ca ON e.contact_a_id = ca.id JOIN contacts cb ON e.contact_b_id = cb.id WHERE e.company_id = $1`, [companyId],
    );
  }
  async setDealContactRole(dealId: string, contactId: string, accountRole: string) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO deal_contact_roles (id, deal_id, contact_id, account_role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (deal_id, contact_id) DO UPDATE SET account_role = excluded.account_role RETURNING *`,
      [id, dealId, contactId, accountRole],
    );
    return { ...row, created_at: isoOrNull(row?.created_at) };
  }
  async getDealTeam(dealId: string) {
    return this.client.many<{ display_name: string; account_role: string; job_title?: string }>(`SELECT c.display_name, r.account_role, c.job_title FROM deal_contact_roles r JOIN contacts c ON r.contact_id = c.id WHERE r.deal_id = $1`, [dealId]);
  }
  async getCoverageGaps(companyId: string) {
    const team = await this.client.many<{ account_role: string }>(`SELECT DISTINCT r.account_role FROM deal_contact_roles r JOIN deals d ON r.deal_id = d.id WHERE d.company_id = $1`, [companyId]);
    const covered = new Set(team.map((t) => t.account_role));
    const key = ["economic_buyer", "technical_evaluator", "champion"];
    return { covered: Array.from(covered), missing_key_roles: key.filter((k) => !covered.has(k)) };
  }

  // ---- audiences / consent / suppression ----
  private mapAudience(r: Record<string, unknown>) {
    return { id: r.id, audience_id: r.audience_id, name: r.name, match: r.match, predicates: pj<unknown[]>(r.predicates, []), consent_policy: r.consent_policy, suppression_synced_at: isoOrNull(r.suppression_synced_at), created_at: isoOrNull(r.created_at), updated_at: isoOrNull(r.updated_at) };
  }
  async createAudience(input: Record<string, unknown>) {
    const audienceId = String(input.audience_id ?? "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(audienceId)) throw new Error(`audience_id must be a lowercase dashed slug: ${audienceId}`);
    const predicates = (input.predicates ?? []) as unknown[];
    if (!Array.isArray(predicates) || predicates.length === 0) throw new Error("at least one predicate is required");
    const dupe = await this.client.get(`SELECT id FROM audiences WHERE audience_id = $1`, [audienceId]);
    if (dupe) throw new Error(`duplicate audience_id: ${audienceId}`);
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO audiences (id, audience_id, name, match, predicates, consent_policy) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, audienceId, input.name, input.match ?? "all", JSON.stringify(predicates), input.consent_policy ?? "opt_in"],
    );
    const mapped = this.mapAudience(row!);
    return { ...mapped, id: mapped.id, audience_id: mapped.audience_id };
  }
  async getAudience(idOrSlug: string) {
    const row = await this.client.get<Record<string, unknown>>(`SELECT * FROM audiences WHERE id = $1 OR audience_id = $1`, [idOrSlug]);
    if (!row) throw new Error(`audience not found: ${idOrSlug}`);
    return this.mapAudience(row);
  }
  async listAudiences() {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM audiences ORDER BY audience_id ASC`)).map((r) => this.mapAudience(r));
  }
  async updateAudience(idOrSlug: string, input: Record<string, unknown>) {
    const audience = await this.getAudience(idOrSlug);
    const sets: string[] = []; const params: unknown[] = [audience.id];
    if ("name" in input) { params.push(input.name); sets.push(`name = $${params.length}`); }
    if ("match" in input) { params.push(input.match); sets.push(`match = $${params.length}`); }
    if ("predicates" in input) { params.push(JSON.stringify(input.predicates)); sets.push(`predicates = $${params.length}`); }
    if ("consent_policy" in input) { params.push(input.consent_policy); sets.push(`consent_policy = $${params.length}`); }
    if (sets.length) { sets.push(`updated_at = NOW()`); await this.client.execute(`UPDATE audiences SET ${sets.join(", ")} WHERE id = $1`, params); }
    return this.getAudience(String(audience.id));
  }
  async deleteAudience(idOrSlug: string) {
    const audience = await this.getAudience(idOrSlug);
    await this.client.execute(`DELETE FROM audiences WHERE id = $1`, [String(audience.id)]);
  }
  async setContactConsent(contactId: string, channel: string, status: string, source?: string) {
    const contact = await this.client.get(`SELECT id FROM contacts WHERE id = $1`, [contactId]);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_consent (contact_id, channel, status, source, updated_at) VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (contact_id, channel) DO UPDATE SET status = excluded.status, source = excluded.source, updated_at = excluded.updated_at RETURNING *`,
      [contactId, channel, status, source ?? null],
    );
    return { ...row, updated_at: isoOrNull(row?.updated_at) };
  }
  async listContactConsent(contactId: string) {
    return (await this.client.many<Record<string, unknown>>(`SELECT * FROM contact_consent WHERE contact_id = $1 ORDER BY channel ASC`, [contactId])).map((r) => ({ ...r, updated_at: isoOrNull(r.updated_at) }));
  }
  async suppressAddress(input: { channel: string; address: string; contact_id?: string; reason?: string }) {
    const id = newUuid();
    const row = await this.client.get<Record<string, unknown>>(
      `INSERT INTO contact_suppressions (id, contact_id, channel, address, reason) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (channel, address) DO UPDATE SET reason = excluded.reason, contact_id = COALESCE(excluded.contact_id, contact_suppressions.contact_id), synced_at = NULL RETURNING *`,
      [id, input.contact_id ?? null, input.channel, input.address, input.reason ?? null],
    );
    if (input.contact_id) {
      const c = await this.client.get(`SELECT id FROM contacts WHERE id = $1`, [input.contact_id]);
      if (c) await this.setContactConsent(input.contact_id, input.channel, "opt_out", input.reason ?? "suppressed");
    }
    return { ...row, created_at: isoOrNull(row?.created_at), synced_at: isoOrNull(row?.synced_at) };
  }
  async unsuppressAddress(channel: string, address: string) {
    await this.client.execute(`DELETE FROM contact_suppressions WHERE channel = $1 AND address = $2`, [channel, address]);
  }
  async listSuppressions(opts: { channel?: string; unsyncedOnly?: boolean } = {}) {
    const where: string[] = []; const params: unknown[] = [];
    if (opts.channel) { params.push(opts.channel); where.push(`channel = $${params.length}`); }
    if (opts.unsyncedOnly) where.push(`synced_at IS NULL`);
    const sql = `SELECT * FROM contact_suppressions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at ASC`;
    return (await this.client.many<Record<string, unknown>>(sql, params)).map((r) => ({ ...r, created_at: isoOrNull(r.created_at), synced_at: isoOrNull(r.synced_at) }));
  }
  async resolveAudience(idOrSlug: string, channel: string) {
    const audience = await this.getAudience(idOrSlug);
    const candidates = await this.client.many<Record<string, unknown>>(`SELECT * FROM contacts WHERE archived = false`);
    const predicates = audience.predicates as Array<{ kind: string; op?: string; key?: string; value?: unknown; values?: unknown[] }>;
    const norm = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "boolean" ? (v ? "true" : "false") : String(v));
    const compare = (actual: unknown, p: { op?: string; value?: unknown; values?: unknown[] }): boolean => {
      const op = p.op ?? "eq"; const a = norm(actual);
      switch (op) {
        case "exists": return a !== null && a !== "";
        case "not_exists": return a === null || a === "";
        case "eq": return a !== null && a === norm(p.value);
        case "neq": return a === null || a !== norm(p.value);
        case "in": return a !== null && (p.values ?? []).some((v) => norm(v) === a);
        case "not_in": return a === null || !(p.values ?? []).some((v) => norm(v) === a);
        default: return false;
      }
    };
    const membership = (names: string[], p: { op?: string; value?: unknown; values?: unknown[] }): boolean => {
      const op = p.op ?? "eq"; const set = new Set(names.map((n) => n.toLowerCase()));
      const has = (v: unknown) => { const n = norm(v); return n !== null && set.has(n.toLowerCase()); };
      switch (op) {
        case "exists": return set.size > 0;
        case "not_exists": return set.size === 0;
        case "eq": return has(p.value);
        case "neq": return !has(p.value);
        case "in": return (p.values ?? []).some(has);
        case "not_in": return !(p.values ?? []).some(has);
        default: return false;
      }
    };
    const matched: Record<string, unknown>[] = [];
    for (const row of candidates) {
      const results: boolean[] = [];
      for (const p of predicates) {
        if (p.kind === "tag") {
          const names = (await this.client.many<{ name: string }>(`SELECT t.name FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = $1`, [row.id])).map((r) => r.name);
          results.push(membership(names, p));
        } else if (p.kind === "group") {
          const rows = await this.client.many<{ name: string; id: string }>(`SELECT g.name, g.id FROM groups g JOIN contact_groups cg ON cg.group_id = g.id WHERE cg.contact_id = $1`, [row.id]);
          results.push(membership(rows.flatMap((r) => [r.name, r.id]), p));
        } else if (p.kind === "attribute") {
          const key = p.key ?? "";
          const val = key in row && key !== "custom_fields" ? row[key] : pj<Record<string, unknown>>(row.custom_fields, {})[key];
          results.push(compare(val, p));
        } else results.push(false);
      }
      if (audience.match === "any" ? results.some(Boolean) : results.every(Boolean)) matched.push(row);
    }
    const suppressed = new Set((await this.client.many<{ address: string }>(`SELECT address FROM contact_suppressions WHERE channel = $1`, [channel])).map((r) => r.address.toLowerCase()));
    const recipients: Array<{ contact_id: string; display_name: string; address: string; consent_status: string }> = [];
    const excluded: Array<{ contact_id: string; reason: string }> = [];
    const consentAllows = (policy: string, status: string) => policy === "opt_in" ? status === "opt_in" : policy === "none" ? true : status !== "opt_out";
    for (const row of matched) {
      const cid = row.id as string;
      if (row.do_not_contact) { excluded.push({ contact_id: cid, reason: "do_not_contact" }); continue; }
      let address: string | null = null;
      if (channel === "email") { const e = await this.client.get<{ address: string }>(`SELECT address FROM emails WHERE contact_id = $1 ORDER BY is_primary DESC, created_at ASC LIMIT 1`, [cid]); address = e?.address ?? null; }
      else if (channel === "sms") { const p = await this.client.get<{ number: string }>(`SELECT number FROM phones WHERE contact_id = $1 ORDER BY is_primary DESC, created_at ASC LIMIT 1`, [cid]); address = p?.number ?? null; }
      else { const s = await this.client.get<{ handle: string | null; url: string | null }>(`SELECT handle, url FROM social_profiles WHERE contact_id = $1 AND platform = 'telegram' ORDER BY is_primary DESC, created_at ASC LIMIT 1`, [cid]); address = s?.handle ?? s?.url ?? null; }
      if (!address) { excluded.push({ contact_id: cid, reason: "no_address" }); continue; }
      if (suppressed.has(address.toLowerCase())) { excluded.push({ contact_id: cid, reason: "suppressed" }); continue; }
      const consent = await this.client.get<{ status: string }>(`SELECT status FROM contact_consent WHERE contact_id = $1 AND channel = $2`, [cid, channel]);
      const status = consent?.status ?? "unknown";
      if (!consentAllows(String(audience.consent_policy), status)) { excluded.push({ contact_id: cid, reason: "consent" }); continue; }
      recipients.push({ contact_id: cid, display_name: row.display_name as string, address, consent_status: status });
    }
    return { audience_id: audience.audience_id, channel, consent_policy: audience.consent_policy, matched: matched.length, recipients, excluded };
  }

  // ---- aggregate / derived (upcoming, audit, timeline, network stats, briefs) ----
  async getUpcomingItems(days = 7) {
    const now = new Date(); const future = new Date(now.getTime() + days * 86400000);
    const todayStr = now.toISOString().slice(0, 10); const futureStr = future.toISOString().slice(0, 10);
    const urgency = (d: string) => (d < todayStr ? "overdue" : d === todayStr ? "today" : "upcoming");
    const items: Array<Record<string, unknown>> = [];
    for (const r of await this.client.many<{ id: string; display_name: string; follow_up_at: string }>(`SELECT id, display_name, follow_up_at FROM contacts WHERE follow_up_at IS NOT NULL AND follow_up_at <= $1 AND do_not_contact = false`, [futureStr]))
      items.push({ date: r.follow_up_at, type: "follow_up", contact_id: r.id, contact_name: r.display_name, title: `Follow up with ${r.display_name}`, urgency: urgency(r.follow_up_at) });
    for (const t of await this.client.many<{ id: string; contact_id: string; title: string; deadline: string; display_name: string }>(`SELECT ct.id, ct.contact_id, ct.title, ct.deadline, c.display_name FROM contact_tasks ct JOIN contacts c ON ct.contact_id = c.id WHERE ct.deadline IS NOT NULL AND ct.deadline <= $1 AND ct.status NOT IN ('completed','cancelled')`, [futureStr]))
      items.push({ date: t.deadline, type: "task_deadline", contact_id: t.contact_id, contact_name: t.display_name, title: t.title, urgency: urgency(t.deadline) });
    for (const a of await this.client.many<{ follow_up_date: string; program_name: string; contact_name: string | null }>(`SELECT a.follow_up_date, a.program_name, c.display_name AS contact_name FROM applications a LEFT JOIN contacts c ON a.primary_contact_id = c.id WHERE a.follow_up_date IS NOT NULL AND a.follow_up_date <= $1`, [futureStr]))
      items.push({ date: a.follow_up_date, type: "application_followup", contact_name: a.contact_name ?? undefined, title: `Follow up: ${a.program_name}`, urgency: urgency(a.follow_up_date) });
    for (const v of await this.client.many<{ follow_up_date: string; company_id: string; company_name: string; subject: string | null; type: string }>(`SELECT vc.follow_up_date, vc.company_id, co.name AS company_name, vc.subject, vc.type FROM vendor_communications vc JOIN companies co ON vc.company_id = co.id WHERE vc.follow_up_date IS NOT NULL AND vc.follow_up_date <= $1 AND vc.follow_up_done = false`, [futureStr]))
      items.push({ date: v.follow_up_date, type: "vendor_followup", company_id: v.company_id, company_name: v.company_name, title: `Follow up with ${v.company_name}: ${v.subject || v.type}`, urgency: urgency(v.follow_up_date) });
    for (const c of await this.client.many<{ id: string; display_name: string; birthday: string }>(`SELECT id, display_name, birthday FROM contacts WHERE birthday IS NOT NULL AND do_not_contact = false`)) {
      const bday = new Date(c.birthday);
      const thisYear = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
      const nextBday = thisYear >= now ? thisYear : new Date(now.getFullYear() + 1, bday.getMonth(), bday.getDate());
      const nextStr = nextBday.toISOString().slice(0, 10);
      if (nextStr <= futureStr) items.push({ date: nextStr, type: "birthday", contact_id: c.id, contact_name: c.display_name, title: `Birthday: ${c.display_name}`, urgency: nextStr === todayStr ? "today" : "upcoming" });
    }
    return items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  async listContactAudit() {
    const rows = await this.client.many<ContactRow>(`SELECT * FROM contacts LIMIT 500`);
    const results = await Promise.all(rows.map(async (row) => {
      const details = await this.loadDetails(mapContact(row));
      const c = details as { id: string; display_name: string; emails?: unknown[]; phones?: unknown[]; tags?: unknown[]; company_id?: string | null; last_contacted_at?: string | null; notes?: string | null; job_title?: string | null };
      const missing: string[] = []; const suggestions: string[] = []; let score = 0;
      if (c.emails?.length) score += 20; else { missing.push("email"); suggestions.push("Add an email address"); }
      if (c.phones?.length) score += 15; else { missing.push("phone"); suggestions.push("Add a phone number"); }
      if (c.company_id) score += 15; else { missing.push("company"); suggestions.push("Link to a company"); }
      if (c.last_contacted_at) score += 20; else { missing.push("last_contacted_at"); suggestions.push("Log a contact interaction"); }
      if (c.tags?.length) score += 10; else { missing.push("tags"); suggestions.push("Add at least one tag"); }
      if (c.notes) score += 10; else { missing.push("notes"); suggestions.push("Add notes"); }
      if (c.job_title) score += 10; else { missing.push("job_title"); suggestions.push("Add a job title"); }
      return { contact_id: c.id, display_name: c.display_name, score, missing, suggestions };
    }));
    return results.sort((a, b) => a.score - b.score);
  }
  async getContactTimeline(contactId: string, limit = 50) {
    const items: Array<{ date: string; type: string; title: string; body?: string; metadata?: Record<string, unknown> }> = [];
    for (const n of await this.client.many<{ created_at: unknown; body: string }>(`SELECT created_at, body FROM contact_notes WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 50`, [contactId]))
      items.push({ date: iso(n.created_at), type: "note", title: "Note", body: n.body });
    for (const e of await this.client.many<{ event_date: string; type: string; title: string; notes: string | null; outcome: string | null; duration_min: number | null }>(`SELECT event_date, type, title, notes, outcome, duration_min FROM events WHERE contact_ids LIKE $1 ORDER BY event_date DESC LIMIT 50`, [`%${contactId}%`]))
      items.push({ date: e.event_date, type: "event", title: `${e.type}: ${e.title}`, body: e.notes ?? undefined, metadata: { outcome: e.outcome, duration_min: e.duration_min } });
    for (const t of await this.client.many<{ title: string; created_at: unknown; updated_at: unknown; status: string; deadline: string | null; priority: string }>(`SELECT title, created_at, updated_at, status, deadline, priority FROM contact_tasks WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 30`, [contactId])) {
      items.push({ date: iso(t.created_at), type: "task_created", title: `Task created: ${t.title}`, metadata: { deadline: t.deadline, priority: t.priority } });
      if (t.status === "completed") items.push({ date: iso(t.updated_at), type: "task_completed", title: `Task completed: ${t.title}` });
    }
    for (const c of await this.client.many<{ comm_date: string; type: string; company_name: string; subject: string | null }>(`SELECT vc.comm_date, vc.type, co.name AS company_name, vc.subject FROM vendor_communications vc JOIN companies co ON vc.company_id = co.id WHERE vc.contact_id = $1 ORDER BY vc.comm_date DESC LIMIT 20`, [contactId]))
      items.push({ date: c.comm_date, type: "vendor_comm", title: `${c.type} — ${c.company_name}`, body: c.subject ?? undefined });
    for (const a of await this.client.many<{ created_at: unknown; action: string; details: string | null }>(`SELECT created_at, action, details FROM activity_log WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 30`, [contactId]))
      items.push({ date: iso(a.created_at), type: "interaction", title: a.action, body: a.details ?? undefined });
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }
  async getNetworkStats() {
    const today = new Date().toISOString().slice(0, 10);
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const d60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const d7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const n = async (sql: string, params: unknown[] = []) => Number((await this.client.get<{ c: string }>(sql, params))?.c ?? 0);
    return {
      total_contacts: await n(`SELECT COUNT(*) c FROM contacts WHERE archived = false`),
      total_companies: await n(`SELECT COUNT(*) c FROM companies WHERE archived = false`),
      owned_entities: await n(`SELECT COUNT(*) c FROM companies WHERE is_owned_entity = true`),
      total_tags: await n(`SELECT COUNT(*) c FROM tags`),
      total_groups: await n(`SELECT COUNT(*) c FROM groups`),
      total_deals: await n(`SELECT COUNT(*) c FROM deals WHERE stage NOT IN ('won','lost','cancelled')`),
      total_events: await n(`SELECT COUNT(*) c FROM events`),
      cold_30d: await n(`SELECT COUNT(*) c FROM contacts WHERE archived = false AND do_not_contact = false AND (last_contacted_at IS NULL OR last_contacted_at < $1)`, [d30]),
      cold_60d: await n(`SELECT COUNT(*) c FROM contacts WHERE archived = false AND do_not_contact = false AND (last_contacted_at IS NULL OR last_contacted_at < $1)`, [d60]),
      cold_never: await n(`SELECT COUNT(*) c FROM contacts WHERE archived = false AND do_not_contact = false AND last_contacted_at IS NULL`),
      contacts_with_email: await n(`SELECT COUNT(DISTINCT contact_id) c FROM emails WHERE contact_id IS NOT NULL`),
      contacts_with_phone: await n(`SELECT COUNT(DISTINCT contact_id) c FROM phones WHERE contact_id IS NOT NULL`),
      contacts_no_company: await n(`SELECT COUNT(*) c FROM contacts WHERE archived = false AND company_id IS NULL`),
      overdue_tasks: await n(`SELECT COUNT(*) c FROM contact_tasks WHERE deadline < $1 AND status NOT IN ('completed','cancelled')`, [today]),
      pending_applications: await n(`SELECT COUNT(*) c FROM applications WHERE status IN ('submitted','pending','follow_up_needed')`),
      missing_invoices: await n(`SELECT COUNT(*) c FROM vendor_communications WHERE type = 'invoice_request' AND status IN ('awaiting_response','no_response')`),
      upcoming_7d: await n(`SELECT COUNT(*) c FROM contacts WHERE follow_up_at BETWEEN $1 AND $2`, [today, d7]),
      notes_count: await n(`SELECT COUNT(*) c FROM contact_notes`),
      active_deals_value: await n(`SELECT COALESCE(SUM(value_usd),0) c FROM deals WHERE stage NOT IN ('won','lost','cancelled') AND currency = 'USD'`),
    };
  }
  async getContactCard(contactId: string) {
    const contact = await this.getContact(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    const details = await this.loadDetails(contact) as { id: string; display_name: string; job_title: string | null; emails?: Array<{ address: string; is_primary?: boolean }>; phones?: Array<{ number: string; is_primary?: boolean }>; company?: { name?: string } | null };
    return {
      id: details.id, display_name: details.display_name, job_title: details.job_title, company: details.company?.name,
      primary_email: details.emails?.find((e) => e.is_primary)?.address || details.emails?.[0]?.address,
      primary_phone: details.phones?.find((p) => p.is_primary)?.number || details.phones?.[0]?.number,
    };
  }
  async getContactBrief(contactId: string, taskContext?: string) {
    const contact = await this.getContact(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    const details = await this.loadDetails(contact) as Record<string, unknown> & { company?: { name?: string; domain?: string } | null };
    const notes = (await this.listNotes(contactId)).slice(0, 3);
    const learnings = (await this.getLearnings(contactId, { min_importance: 7 })).slice(0, 5);
    const ctx = (taskContext ?? "").toLowerCase();
    const last = contact.last_contacted_at as string | null;
    const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    const brief: Record<string, unknown> = {
      id: contact.id, display_name: contact.display_name, job_title: contact.job_title, company: details.company?.name, status: contact.status,
      last_contacted: daysSince !== null ? `${daysSince}d ago` : "never",
      relationship_health: (contact as unknown as Record<string, unknown>).relationship_health, engagement_status: (contact as unknown as Record<string, unknown>).engagement_status,
      preferred_contact: contact.preferred_contact_method,
    };
    if (ctx.includes("meeting") || ctx.includes("call") || ctx.includes("prep")) {
      brief.recent_notes = notes.map((nt) => ({ date: String(nt.created_at ?? "").slice(0, 10), content: nt.body }));
      brief.key_learnings = learnings.map((l) => l.content);
    }
    if (ctx.includes("outreach") || ctx.includes("email")) { brief.preferred_channel = (contact as unknown as Record<string, unknown>).preferred_channel; brief.follow_up_at = contact.follow_up_at; }
    if (ctx.includes("deal")) brief.company_details = details.company ? { name: details.company.name, domain: details.company.domain } : null;
    if (learnings.length) brief.top_learnings = learnings.map((l) => l.content);
    return brief;
  }
  async assembleContext(contactIds: string[], format: string) {
    const briefs = await Promise.all(contactIds.map(async (id) => { try { return await this.getContactBrief(id, format); } catch { return { id, error: "not found" }; } }));
    return { format, contact_count: contactIds.length, assembled_at: new Date().toISOString(), contacts: briefs };
  }
  async generateBrief(contactId: string) {
    const contact = await this.getContact(contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    const details = await this.loadDetails(contact) as Record<string, unknown> & { emails?: Array<{ address: string; is_primary?: boolean }>; phones?: Array<{ number: string; is_primary?: boolean }> };
    const notes = await this.listNotes(contactId);
    const allTasks = await this.listContactTasks({ contact_id: contactId });
    const tasks = allTasks.filter((t) => !["completed", "cancelled"].includes(String(t.status)));
    const nowIsoStr = new Date().toISOString();
    const overdueTasks = allTasks.filter((t) => t.deadline && String(t.deadline) < nowIsoStr && !["completed", "cancelled"].includes(String(t.status)));
    const companyRels = await this.listCompanyRelationships({ contact_id: contactId });
    const recentTimeline = await this.getContactTimeline(contactId, 5);
    const last = contact.last_contacted_at as string | null;
    const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    const lines: string[] = [];
    lines.push(`# ${contact.display_name}`);
    if (contact.job_title) lines.push(`**Role:** ${contact.job_title}${contact.company_id ? ` (linked to company)` : ""}`);
    const emails = details.emails ?? []; const phones = details.phones ?? [];
    const pe = emails.find((e) => e.is_primary) || emails[0]; if (pe) lines.push(`**Email:** ${pe.address}`);
    const pp = phones.find((p) => p.is_primary) || phones[0]; if (pp) lines.push(`**Phone:** ${pp.number}`);
    if (contact.preferred_contact_method) lines.push(`**Preferred contact:** ${contact.preferred_contact_method}`);
    lines.push(""); lines.push(`## Status`);
    lines.push(`- Last contacted: ${daysSince !== null ? `${daysSince} days ago` : "never"}`);
    lines.push(`- Status: ${contact.status || "active"}`);
    if (contact.follow_up_at) lines.push(`- Follow-up scheduled: ${contact.follow_up_at}`);
    if (overdueTasks.length) lines.push(`- OVERDUE TASKS: ${overdueTasks.length}`);
    if (companyRels.length) { lines.push(""); lines.push(`## Entity Relationships`); for (const r of companyRels) lines.push(`- ${r.relationship_type} — ${r.notes || ""}`); }
    if (tasks.length) { lines.push(""); lines.push(`## Open Tasks`); for (const t of tasks) lines.push(`- [${t.priority}] ${t.title}${t.deadline ? ` (due ${t.deadline})` : ""}`); }
    if (notes.length) { lines.push(""); lines.push(`## Recent Notes`); for (const nt of notes.slice(0, 3)) lines.push(`**${String(nt.created_at ?? "").slice(0, 10)}:** ${nt.body}`); }
    if (recentTimeline.length) { lines.push(""); lines.push(`## Recent Activity`); for (const item of recentTimeline) lines.push(`- ${item.date.slice(0, 10)} ${item.title}`); }
    if (contact.notes) { lines.push(""); lines.push(`## Background Notes`); lines.push(String(contact.notes)); }
    return lines.join("\n");
  }

  // ---- vault status (cloud has no on-box vault; report document count only) ----
  async vaultStatus() {
    let document_count = 0;
    try { document_count = Number((await this.client.get<{ n: string }>(`SELECT COUNT(*) n FROM contact_documents`))?.n ?? 0); } catch { /* table may be absent */ }
    return { initialized: false, unlocked: false, document_count };
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
