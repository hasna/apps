import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { Comment, CommentType } from "../types/index.ts";
import { NotFoundError, ValidationError } from "../types/index.ts";

interface RawComment {
  id: string;
  ticket_id: string;
  author_id: string | null;
  content: string;
  is_internal: number;
  type: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToComment(row: RawComment): Comment {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    author_id: row.author_id,
    content: row.content,
    is_internal: row.is_internal === 1,
    type: row.type as CommentType,
    metadata: JSON.parse(row.metadata ?? "{}") as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface CreateCommentOptions {
  ticket_id: string;
  content: string;
  author_id?: string;
  is_internal?: boolean;
  type?: CommentType;
  metadata?: Record<string, unknown>;
}

export function createComment(options: CreateCommentOptions, db?: Database): Comment {
  const database = db ?? getDatabase();
  if (!options.content.trim()) throw new ValidationError("Comment content is required");

  const id = uuid();
  const n = now();
  database.run(
    `INSERT INTO comments (id, ticket_id, author_id, content, is_internal, type, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, options.ticket_id, options.author_id ?? null,
      options.content.trim(),
      options.is_internal ? 1 : 0,
      options.type ?? "comment",
      JSON.stringify(options.metadata ?? {}),
      n, n,
    ]
  );

  const row = database.query<RawComment, [string]>("SELECT * FROM comments WHERE id = ?").get(id);
  return rowToComment(row!);
}

export function listComments(ticketId: string, includeInternal = true, db?: Database): Comment[] {
  const database = db ?? getDatabase();
  const sql = includeInternal
    ? "SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC"
    : "SELECT * FROM comments WHERE ticket_id = ? AND is_internal = 0 ORDER BY created_at ASC";
  const rows = database.query<RawComment, [string]>(sql).all(ticketId);
  return rows.map(rowToComment);
}

export function updateComment(id: string, content: string, db?: Database): Comment {
  const database = db ?? getDatabase();
  if (!content.trim()) throw new ValidationError("Comment content is required");
  const n = now();
  const result = database.run(
    "UPDATE comments SET content = ?, updated_at = ? WHERE id = ?",
    [content.trim(), n, id]
  );
  if (result.changes === 0) throw new NotFoundError("Comment", id);
  const row = database.query<RawComment, [string]>("SELECT * FROM comments WHERE id = ?").get(id);
  return rowToComment(row!);
}

export function deleteComment(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  const result = database.run("DELETE FROM comments WHERE id = ?", [id]);
  if (result.changes === 0) throw new NotFoundError("Comment", id);
}
