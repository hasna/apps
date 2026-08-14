import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { Collection } from "../types/index.js";
import { NotFoundError, DuplicateError } from "../types/index.js";

function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function rowToCollection(row: Record<string, unknown>): Collection {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    description: row["description"] as string | undefined,
    project_id: row["project_id"] as string | undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createCollection(data: {
  name: string;
  slug?: string;
  description?: string;
  project_id?: string;
}): Collection {
  const db = getDatabase();
  const id = `col-${nanoid(8)}`;
  const slug = data.slug ?? makeSlug(data.name);

  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM collections WHERE slug = ?"
    )
    .get(slug);
  if (existing) throw new DuplicateError("Collection", "slug", slug);

  db.query(
    `INSERT INTO collections (id, name, slug, description, project_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, data.name, slug, data.description ?? null, data.project_id ?? null);

  return getCollectionById(id);
}

export function getCollectionById(id: string): Collection {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM collections WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("Collection", id);
  return rowToCollection(row);
}

export function listCollections(projectId?: string): Collection[] {
  const db = getDatabase();
  if (projectId) {
    const rows = db
      .query<Record<string, unknown>, [string]>(
        "SELECT * FROM collections WHERE project_id = ? ORDER BY created_at DESC"
      )
      .all(projectId);
    return rows.map(rowToCollection);
  }
  const rows = db
    .query<Record<string, unknown>, []>(
      "SELECT * FROM collections ORDER BY created_at DESC"
    )
    .all();
  return rows.map(rowToCollection);
}

export function updateCollection(
  id: string,
  data: Partial<Pick<Collection, "name" | "slug" | "description" | "project_id">>
): Collection {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM collections WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Collection", id);

  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.slug !== undefined) { fields.push("slug = ?"); values.push(data.slug); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.project_id !== undefined) { fields.push("project_id = ?"); values.push(data.project_id); }

  values.push(id);
  db.query(`UPDATE collections SET ${fields.join(", ")} WHERE id = ?`).run(...(values as [string]));
  return getCollectionById(id);
}

export function deleteCollection(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM collections WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Collection", id);
  db.query("DELETE FROM collections WHERE id = ?").run(id);
}
