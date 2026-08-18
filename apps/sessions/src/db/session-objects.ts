import { getDatabase } from "./database.js";
import type {
  SessionObject,
  SessionObjectInsert,
  SessionObjectKind,
} from "../types/index.js";

function rowToSessionObject(row: Record<string, unknown>): SessionObject {
  return {
    session_id: row.session_id as string,
    object_kind: row.object_kind as SessionObjectKind,
    object_key: row.object_key as string,
    source_digest: row.source_digest as string,
    size: Number(row.size),
    status: row.status as SessionObject["status"],
    last_error: (row.last_error as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function enqueueSessionObject(input: SessionObjectInsert): SessionObject {
  const db = getDatabase();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO session_objects(
       session_id, object_kind, object_key, source_digest, size,
       status, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
     ON CONFLICT(session_id, object_kind) DO UPDATE SET
       object_key = excluded.object_key,
       source_digest = excluded.source_digest,
       size = excluded.size,
       status = 'pending',
       last_error = NULL,
       updated_at = excluded.updated_at`,
  ).run(
    input.session_id,
    input.object_kind,
    input.object_key,
    input.source_digest,
    input.size,
    timestamp,
    timestamp,
  );
  return getSessionObject(input.session_id, input.object_kind)!;
}

export function getSessionObject(
  sessionId: string,
  objectKind: SessionObjectKind,
): SessionObject | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM session_objects
       WHERE session_id = ? AND object_kind = ?`,
    )
    .get(sessionId, objectKind) as Record<string, unknown> | undefined;
  return row ? rowToSessionObject(row) : null;
}

export interface ListRetryableSessionObjectsOptions {
  sessionId?: string;
  limit?: number;
}

export function listRetryableSessionObjects(
  opts: ListRetryableSessionObjectsOptions = {},
): SessionObject[] {
  const limit = opts.limit ?? 500;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("session object retry limit must be a positive integer");
  }
  const rows = opts.sessionId
    ? getDatabase()
        .prepare(
          `SELECT * FROM session_objects
           WHERE session_id = ? AND status IN ('pending', 'failed')
           ORDER BY updated_at, session_id, object_kind
           LIMIT ?`,
        )
        .all(opts.sessionId, limit)
    : getDatabase()
        .prepare(
          `SELECT * FROM session_objects
           WHERE status IN ('pending', 'failed')
           ORDER BY updated_at, session_id, object_kind
           LIMIT ?`,
        )
        .all(limit);
  return (rows as Record<string, unknown>[]).map(rowToSessionObject);
}

function transitionSessionObject(
  sessionId: string,
  objectKind: SessionObjectKind,
  expectedDigest: string,
  status: "uploaded" | "failed",
  lastError: string | null,
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE session_objects
       SET status = ?, last_error = ?, updated_at = ?
       WHERE session_id = ? AND object_kind = ? AND source_digest = ?
         AND status IN ('pending', 'failed')`,
    )
    .run(status, lastError, nowIso(), sessionId, objectKind, expectedDigest) as {
      changes?: number;
    };
  return Number(result.changes ?? 0) === 1;
}

export function markSessionObjectUploaded(
  sessionId: string,
  objectKind: SessionObjectKind,
  expectedDigest: string,
): boolean {
  return transitionSessionObject(sessionId, objectKind, expectedDigest, "uploaded", null);
}

export function markSessionObjectFailed(
  sessionId: string,
  objectKind: SessionObjectKind,
  expectedDigest: string,
  error: string,
): boolean {
  const boundedError = error.trim().slice(0, 2_000) || "object upload failed";
  return transitionSessionObject(
    sessionId,
    objectKind,
    expectedDigest,
    "failed",
    boundedError,
  );
}
