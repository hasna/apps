import type { TaskComment } from "../types/index.js";

/**
 * Keyset cursor for the task-comment read model, and the pure pager that walks
 * it. Both the `/v1` server and the CLI encode and decode the same cursor, so
 * the codec lives here rather than beside either consumer — a second copy of
 * this keyset logic is exactly how the two ends drift into disagreeing about
 * what a cursor means.
 *
 * ORDERING CONTRACT, measured against the live deployment rather than assumed:
 * a page carries the NEWEST `limit` comments in ASCENDING display order, so the
 * newest comment is the LAST element. `next_cursor` encodes the FIRST (oldest)
 * element of the page, and walking it moves toward OLDER history.
 */

export interface CommentCursor {
  created_at: string;
  id: string;
}

export const MAX_COMMENT_CURSOR_LENGTH = 1_024;

export function encodeCommentCursor(comment: Pick<TaskComment, "created_at" | "id">): string {
  return Buffer.from(JSON.stringify({ created_at: comment.created_at, id: comment.id }), "utf8")
    .toString("base64url");
}

export function decodeCommentCursor(value: string): CommentCursor {
  if (value.length > MAX_COMMENT_CURSOR_LENGTH) throw new Error("invalid comment cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid comment cursor");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid comment cursor");
  const cursor = parsed as Record<string, unknown>;
  if (typeof cursor["created_at"] !== "string" || cursor["created_at"].length > 64 ||
      !Number.isFinite(Date.parse(cursor["created_at"])) ||
      typeof cursor["id"] !== "string" || !cursor["id"] || cursor["id"].length > 256) {
    throw new Error("invalid comment cursor");
  }
  return { created_at: cursor["created_at"], id: cursor["id"] };
}

/** True when `comment` sorts strictly before `before` on the `(created_at, id)` keyset. */
export function isStrictlyOlder(
  comment: Pick<TaskComment, "created_at" | "id">,
  before: CommentCursor,
): boolean {
  return comment.created_at < before.created_at
    || (comment.created_at === before.created_at && comment.id < before.id);
}

export interface CommentPageResult<T> {
  comments: T[];
  count: number;
  has_more: boolean;
  next_cursor: string | null;
  limit: number;
}

/**
 * Page an already-materialised, ascending comment list. Used by the local
 * (SQLite) read path, where the whole history is in hand; the cloud path gets
 * the identical shape from the server, which applies the same rule against the
 * database.
 */
export function pageComments<T extends Pick<TaskComment, "created_at" | "id">>(
  all: readonly T[],
  options: { limit: number; before?: CommentCursor },
): CommentPageResult<T> {
  const ascending = [...all].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  const scoped = options.before
    ? ascending.filter((comment) => isStrictlyOlder(comment, options.before!))
    : ascending;
  const comments = scoped.slice(-options.limit);
  const hasMore = scoped.length > comments.length;
  return {
    comments,
    count: comments.length,
    has_more: hasMore,
    next_cursor: hasMore && comments[0] ? encodeCommentCursor(comments[0]) : null,
    limit: options.limit,
  };
}
