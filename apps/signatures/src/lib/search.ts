import { getDatabase } from "../db/database.js";
import type { Document, Signature } from "../types/index.js";

interface FTSDocRow {
  id: string;
  name: string;
  description: string | null;
  file_name: string;
  rank: number;
}

interface FTSSigRow {
  id: string;
  name: string;
  text_value: string | null;
  rank: number;
}

export function searchDocuments(query: string, limit = 20): Document[] {
  const db = getDatabase();

  try {
    // BM25 FTS5 search
    const rows = db
      .query<Record<string, unknown>, [string, number]>(
        `SELECT d.*, fts.rank
         FROM documents_fts fts
         JOIN documents d ON d.id = fts.id
         WHERE documents_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, limit);

    return rows.map((row: Record<string, unknown>) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      slug: row["slug"] as string,
      description: row["description"] as string | undefined,
      file_path: row["file_path"] as string,
      file_name: row["file_name"] as string,
      file_size: row["file_size"] as number | undefined,
      mime_type: row["mime_type"] as string,
      status: row["status"] as Document["status"],
      project_id: row["project_id"] as string | undefined,
      collection_id: row["collection_id"] as string | undefined,
      metadata: undefined,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    }));
  } catch {
    // LIKE fallback
    const like = `%${query}%`;
    const rows = db
      .query<Record<string, unknown>, [string, string, string, number]>(
        `SELECT * FROM documents
         WHERE name LIKE ? OR description LIKE ? OR file_name LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(like, like, like, limit);

    return rows.map((row) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      slug: row["slug"] as string,
      description: row["description"] as string | undefined,
      file_path: row["file_path"] as string,
      file_name: row["file_name"] as string,
      file_size: row["file_size"] as number | undefined,
      mime_type: row["mime_type"] as string,
      status: row["status"] as Document["status"],
      project_id: row["project_id"] as string | undefined,
      collection_id: row["collection_id"] as string | undefined,
      metadata: row["metadata"]
        ? (JSON.parse(row["metadata"] as string) as Record<string, unknown>)
        : undefined,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    }));
  }
}

export function searchSignatures(query: string, limit = 20): Signature[] {
  const db = getDatabase();

  try {
    const rows = db
      .query<Record<string, unknown>, [string, number]>(
        `SELECT s.*, fts.rank
         FROM signatures_fts fts
         JOIN signatures s ON s.id = fts.id
         WHERE signatures_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, limit);

    return rows.map((row: Record<string, unknown>) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      type: row["type"] as Signature["type"],
      font_family: row["font_family"] as string | undefined,
      font_size: row["font_size"] as number,
      color: row["color"] as string,
      text_value: row["text_value"] as string | undefined,
      image_path: row["image_path"] as string | undefined,
      image_prompt: row["image_prompt"] as string | undefined,
      width: row["width"] as number | undefined,
      height: row["height"] as number | undefined,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    }));
  } catch {
    const like = `%${query}%`;
    const rows = db
      .query<Record<string, unknown>, [string, string, number]>(
        `SELECT * FROM signatures
         WHERE name LIKE ? OR text_value LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(like, like, limit);

    return rows.map((row) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      type: row["type"] as Signature["type"],
      font_family: row["font_family"] as string | undefined,
      font_size: row["font_size"] as number,
      color: row["color"] as string,
      text_value: row["text_value"] as string | undefined,
      image_path: row["image_path"] as string | undefined,
      image_prompt: row["image_prompt"] as string | undefined,
      width: row["width"] as number | undefined,
      height: row["height"] as number | undefined,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    }));
  }
}

export function search(query: string): {
  documents: Document[];
  signatures: Signature[];
} {
  return {
    documents: searchDocuments(query),
    signatures: searchSignatures(query),
  };
}
