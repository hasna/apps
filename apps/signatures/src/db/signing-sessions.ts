import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { SigningSession, SessionStatus, SessionSource } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToSession(row: Record<string, unknown>): SigningSession {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string,
    signer_name: row["signer_name"] as string | undefined,
    signer_email: row["signer_email"] as string | undefined,
    status: row["status"] as SessionStatus,
    token: row["token"] as string,
    source: row["source"] as SessionSource,
    connector_name: row["connector_name"] as string | undefined,
    metadata: row["metadata"]
      ? (JSON.parse(row["metadata"] as string) as Record<string, unknown>)
      : undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createSigningSession(data: {
  document_id: string;
  signer_name?: string;
  signer_email?: string;
  status?: SessionStatus;
  source?: SessionSource;
  connector_name?: string;
  metadata?: Record<string, unknown>;
}): SigningSession {
  const db = getDatabase();
  const id = `ses-${nanoid(8)}`;
  const token = nanoid(32);

  db.query(
    `INSERT INTO signing_sessions (id, document_id, signer_name, signer_email, status, token, source, connector_name, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id,
    data.signer_name ?? null,
    data.signer_email ?? null,
    data.status ?? "pending",
    token,
    data.source ?? "local",
    data.connector_name ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null
  );

  return getSessionById(id);
}

export function getSessionById(id: string): SigningSession {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signing_sessions WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("SigningSession", id);
  return rowToSession(row);
}

export function getSessionByToken(token: string): SigningSession {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signing_sessions WHERE token = ?"
    )
    .get(token);
  if (!row) throw new NotFoundError("SigningSession", token);
  return rowToSession(row);
}

export function listSessionsForDocument(documentId: string): SigningSession[] {
  const db = getDatabase();
  const rows = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signing_sessions WHERE document_id = ? ORDER BY created_at DESC"
    )
    .all(documentId);
  return rows.map(rowToSession);
}

export function updateSessionStatus(id: string, status: SessionStatus): SigningSession {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM signing_sessions WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("SigningSession", id);

  db.query(
    "UPDATE signing_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);

  return getSessionById(id);
}
