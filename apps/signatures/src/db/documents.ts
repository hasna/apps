import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { Document, DocumentStatus } from "../types/index.js";
import { NotFoundError, DuplicateError } from "../types/index.js";

function makeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function rowToDocument(row: Record<string, unknown>): Document {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    description: row["description"] as string | undefined,
    file_path: row["file_path"] as string,
    file_name: row["file_name"] as string,
    file_size: row["file_size"] as number | undefined,
    mime_type: row["mime_type"] as string,
    status: row["status"] as DocumentStatus,
    project_id: row["project_id"] as string | undefined,
    collection_id: row["collection_id"] as string | undefined,
    metadata: row["metadata"]
      ? (JSON.parse(row["metadata"] as string) as Record<string, unknown>)
      : undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createDocument(data: {
  name: string;
  slug?: string;
  description?: string;
  file_path: string;
  file_name: string;
  file_size?: number;
  mime_type?: string;
  status?: DocumentStatus;
  project_id?: string;
  collection_id?: string;
  metadata?: Record<string, unknown>;
}): Document {
  const db = getDatabase();
  const id = `doc-${nanoid(8)}`;
  const slug = data.slug ?? `${makeSlug(data.name)}-${nanoid(4)}`;

  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM documents WHERE slug = ?"
    )
    .get(slug);
  if (existing) throw new DuplicateError("Document", "slug", slug);

  db.query(
    `INSERT INTO documents (id, name, slug, description, file_path, file_name, file_size, mime_type, status, project_id, collection_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    slug,
    data.description ?? null,
    data.file_path,
    data.file_name,
    data.file_size ?? null,
    data.mime_type ?? "application/pdf",
    data.status ?? "draft",
    data.project_id ?? null,
    data.collection_id ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null
  );

  return getDocumentById(id);
}

export function getDocumentById(id: string): Document {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM documents WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("Document", id);
  return rowToDocument(row);
}

export function getDocumentBySlug(slug: string): Document {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM documents WHERE slug = ?"
    )
    .get(slug);
  if (!row) throw new NotFoundError("Document", slug);
  return rowToDocument(row);
}

export function getDocumentByIdOrSlug(idOrSlug: string): Document {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string, string]>(
      "SELECT * FROM documents WHERE id = ? OR slug = ?"
    )
    .get(idOrSlug, idOrSlug);
  if (!row) throw new NotFoundError("Document", idOrSlug);
  return rowToDocument(row);
}

export function listDocuments(filters?: {
  project_id?: string;
  collection_id?: string;
  status?: DocumentStatus;
  limit?: number;
  offset?: number;
}): Document[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters?.project_id) {
    conditions.push("project_id = ?");
    values.push(filters.project_id);
  }
  if (filters?.collection_id) {
    conditions.push("collection_id = ?");
    values.push(filters.collection_id);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    values.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;
  values.push(limit, offset);

  const rows = db
    .query<Record<string, unknown>, string[]>(
      `SELECT * FROM documents ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...(values as string[]));
  return rows.map(rowToDocument);
}

export function updateDocument(
  id: string,
  data: Partial<Omit<Document, "id" | "created_at">>
): Document {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM documents WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Document", id);

  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  const simpleFields: (keyof Document)[] = [
    "name", "slug", "description", "file_path", "file_name",
    "file_size", "mime_type", "status", "project_id", "collection_id",
  ];

  for (const field of simpleFields) {
    const val = (data as Record<string, unknown>)[field as string];
    if (field in data && val !== undefined) {
      fields.push(`${field} = ?`);
      values.push(val);
    }
  }

  if (data.metadata !== undefined) {
    fields.push("metadata = ?");
    values.push(JSON.stringify(data.metadata));
  }

  values.push(id);
  db.query(`UPDATE documents SET ${fields.join(", ")} WHERE id = ?`).run(...(values as [string]));
  return getDocumentById(id);
}

export function deleteDocument(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM documents WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Document", id);
  db.query("DELETE FROM documents WHERE id = ?").run(id);
}
