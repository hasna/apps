import { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import type { Org, CreateOrgInput, UpdateOrgInput } from "../types/index.js";
import { NotFoundError, ConflictError } from "../types/index.js";

function rowToOrg(row: any): Org {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createOrg(input: CreateOrgInput, db?: Database): Org {
  db = db || getDatabase();
  const id = crypto.randomUUID().slice(0, 8);
  const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  try {
    db.run(
      `INSERT INTO orgs (id, name, slug, description, metadata) VALUES (?, ?, ?, ?, ?)`,
      [id, input.name, slug, input.description || null, JSON.stringify(input.metadata || {})]
    );
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed")) {
      throw new ConflictError(`Org slug "${slug}" already exists`);
    }
    throw e;
  }

  return getOrg(id, db)!;
}

export function getOrg(id: string, db?: Database): Org | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM orgs WHERE id = ?").get(id);
  return row ? rowToOrg(row) : null;
}

export function getOrgBySlug(slug: string, db?: Database): Org | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM orgs WHERE slug = ?").get(slug);
  return row ? rowToOrg(row) : null;
}

export function listOrgs(db?: Database): Org[] {
  db = db || getDatabase();
  const rows = db.query("SELECT * FROM orgs ORDER BY name").all();
  return (rows as any[]).map(rowToOrg);
}

export function updateOrg(id: string, input: UpdateOrgInput, db?: Database): Org {
  db = db || getDatabase();
  const existing = getOrg(id, db);
  if (!existing) throw new NotFoundError("Org", id);

  const name = input.name ?? existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const metadata = input.metadata ? JSON.stringify(input.metadata) : existing.metadata ? JSON.stringify(existing.metadata) : "{}";

  db.run(
    `UPDATE orgs SET name = ?, description = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    [name, description, metadata, id]
  );

  return getOrg(id, db)!;
}

export function deleteOrg(id: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM orgs WHERE id = ?`, [id]);
  return result.changes > 0;
}
