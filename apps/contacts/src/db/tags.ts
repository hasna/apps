import type { Database } from "bun:sqlite";
import type {
  Contact,
  ContactRow,
  CreateTagInput,
  Tag,
  TagRow,
  UpdateTagInput,
} from "../types/index.js";
import { ContactNotFoundError, CompanyNotFoundError, DuplicateTagNameError, TagNotFoundError } from "../types/index.js";
import { getDatabase, uuid } from "./database.js";

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToTag(row: TagRow): Tag {
  return { ...row };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createTag(input: CreateTagInput, db?: Database): Tag {
  const d = db || getDatabase();

  const existing = d.query(`SELECT id FROM tags WHERE name = ?`).get(input.name);
  if (existing) throw new DuplicateTagNameError(input.name);

  const id = uuid();
  d.run(
    `INSERT INTO tags (id, name, color, description) VALUES (?, ?, ?, ?)`,
    [id, input.name, input.color ?? "#6366f1", input.description ?? null]
  );
  return rowToTag(d.query(`SELECT * FROM tags WHERE id = ?`).get(id) as TagRow);
}

export function getTag(id: string, db?: Database): Tag {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM tags WHERE id = ?`).get(id) as TagRow | null;
  if (!row) throw new TagNotFoundError(id);
  return rowToTag(row);
}

export function getTagByName(name: string, db?: Database): Tag | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM tags WHERE name = ?`).get(name) as TagRow | null;
  return row ? rowToTag(row) : null;
}

export function listTags(db?: Database): Tag[] {
  const d = db || getDatabase();
  return (d.query(`SELECT * FROM tags ORDER BY name ASC`).all() as TagRow[]).map(rowToTag);
}

export function updateTag(id: string, input: UpdateTagInput, db?: Database): Tag {
  const d = db || getDatabase();
  const existing = d.query(`SELECT * FROM tags WHERE id = ?`).get(id) as TagRow | null;
  if (!existing) throw new TagNotFoundError(id);

  if (input.name && input.name !== existing.name) {
    const dupe = d.query(`SELECT id FROM tags WHERE name = ? AND id != ?`).get(input.name, id);
    if (dupe) throw new DuplicateTagNameError(input.name);
  }

  const setClauses: string[] = [];
  const params: (string | null)[] = [];

  if (input.name !== undefined) { setClauses.push("name = ?"); params.push(input.name); }
  if (input.color !== undefined) { setClauses.push("color = ?"); params.push(input.color); }
  if (input.description !== undefined) { setClauses.push("description = ?"); params.push(input.description); }

  if (setClauses.length > 0) {
    params.push(id);
    d.run(`UPDATE tags SET ${setClauses.join(", ")} WHERE id = ?`, params);
  }

  return rowToTag(d.query(`SELECT * FROM tags WHERE id = ?`).get(id) as TagRow);
}

export function deleteTag(id: string, db?: Database): void {
  const d = db || getDatabase();
  const row = d.query(`SELECT id FROM tags WHERE id = ?`).get(id);
  if (!row) throw new TagNotFoundError(id);
  d.run(`DELETE FROM tags WHERE id = ?`, [id]);
}

// ─── Contact tag operations ───────────────────────────────────────────────────

export function addTagToContact(contactId: string, tagId: string, db?: Database): void {
  const d = db || getDatabase();
  const contact = d.query(`SELECT id FROM contacts WHERE id = ?`).get(contactId);
  if (!contact) throw new ContactNotFoundError(contactId);
  const tag = d.query(`SELECT id FROM tags WHERE id = ?`).get(tagId);
  if (!tag) throw new TagNotFoundError(tagId);
  d.run(`INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)`, [contactId, tagId]);
}

export function removeTagFromContact(contactId: string, tagId: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?`, [contactId, tagId]);
}

export function listContactsByTag(tagId: string, db?: Database): Contact[] {
  const d = db || getDatabase();
  const tag = d.query(`SELECT id FROM tags WHERE id = ?`).get(tagId);
  if (!tag) throw new TagNotFoundError(tagId);

  const rows = d.query(`
    SELECT c.* FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ?
    ORDER BY c.display_name ASC
  `).all(tagId) as ContactRow[];

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

// ─── Company tag operations ───────────────────────────────────────────────────

export function addTagToCompany(companyId: string, tagId: string, db?: Database): void {
  const d = db || getDatabase();
  const company = d.query(`SELECT id FROM companies WHERE id = ?`).get(companyId);
  if (!company) throw new CompanyNotFoundError(companyId);
  const tag = d.query(`SELECT id FROM tags WHERE id = ?`).get(tagId);
  if (!tag) throw new TagNotFoundError(tagId);
  d.run(`INSERT OR IGNORE INTO company_tags (company_id, tag_id) VALUES (?, ?)`, [companyId, tagId]);
}

export function removeTagFromCompany(companyId: string, tagId: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM company_tags WHERE company_id = ? AND tag_id = ?`, [companyId, tagId]);
}
