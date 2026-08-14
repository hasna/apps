import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { Tag } from "../types/index.js";
import { NotFoundError, DuplicateError } from "../types/index.js";

function rowToTag(row: Record<string, unknown>): Tag {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    color: row["color"] as string | undefined,
    created_at: row["created_at"] as string,
  };
}

export function createTag(data: { name: string; color?: string }): Tag {
  const db = getDatabase();
  const id = `tag-${nanoid(8)}`;

  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM tags WHERE name = ?"
    )
    .get(data.name);
  if (existing) throw new DuplicateError("Tag", "name", data.name);

  db.query(
    "INSERT INTO tags (id, name, color) VALUES (?, ?, ?)"
  ).run(id, data.name, data.color ?? null);

  return getTagById(id);
}

export function getTagById(id: string): Tag {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM tags WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("Tag", id);
  return rowToTag(row);
}

export function getTagByName(name: string): Tag {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM tags WHERE name = ?"
    )
    .get(name);
  if (!row) throw new NotFoundError("Tag", name);
  return rowToTag(row);
}

export function listTags(): Tag[] {
  const db = getDatabase();
  const rows = db
    .query<Record<string, unknown>, []>(
      "SELECT * FROM tags ORDER BY name ASC"
    )
    .all();
  return rows.map(rowToTag);
}

export function getOrCreateTag(name: string, color?: string): Tag {
  const db = getDatabase();
  const existing = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM tags WHERE name = ?"
    )
    .get(name);
  if (existing) return rowToTag(existing);
  return createTag({ name, color });
}

export function addTagToDocument(documentId: string, tagId: string): void {
  const db = getDatabase();
  db.query(
    "INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)"
  ).run(documentId, tagId);
}

export function removeTagFromDocument(documentId: string, tagId: string): void {
  const db = getDatabase();
  db.query(
    "DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?"
  ).run(documentId, tagId);
}

export function getTagsForDocument(documentId: string): Tag[] {
  const db = getDatabase();
  const rows = db
    .query<Record<string, unknown>, [string]>(
      `SELECT t.* FROM tags t
       JOIN document_tags dt ON dt.tag_id = t.id
       WHERE dt.document_id = ?
       ORDER BY t.name ASC`
    )
    .all(documentId);
  return rows.map(rowToTag);
}

export function deleteTag(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>("SELECT id FROM tags WHERE id = ?")
    .get(id);
  if (!existing) throw new NotFoundError("Tag", id);
  db.query("DELETE FROM tags WHERE id = ?").run(id);
}
