import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { SigningCertificate } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToCertificate(row: Record<string, unknown>): SigningCertificate {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string,
    session_id: row["session_id"] as string,
    certificate_path: row["certificate_path"] as string,
    original_document_hash: row["original_document_hash"] as string | undefined,
    signed_document_hash: row["signed_document_hash"] as string | undefined,
    verification_code: row["verification_code"] as string,
    metadata: row["metadata"]
      ? (JSON.parse(row["metadata"] as string) as Record<string, unknown>)
      : undefined,
    issued_at: row["issued_at"] as string,
  };
}

export function createSigningCertificate(data: {
  document_id: string;
  session_id: string;
  certificate_path: string;
  original_document_hash?: string;
  signed_document_hash?: string;
  verification_code?: string;
  metadata?: Record<string, unknown>;
}): SigningCertificate {
  const db = getDatabase();
  const id = `crt-${nanoid(8)}`;
  const verificationCode = data.verification_code ?? nanoid(16);

  db.query(
    `INSERT INTO signing_certificates
     (id, document_id, session_id, certificate_path, original_document_hash, signed_document_hash, verification_code, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id,
    data.session_id,
    data.certificate_path,
    data.original_document_hash ?? null,
    data.signed_document_hash ?? null,
    verificationCode,
    data.metadata ? JSON.stringify(data.metadata) : null
  );

  return getSigningCertificateById(id);
}

export function getSigningCertificateById(id: string): SigningCertificate {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signing_certificates WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("SigningCertificate", id);
  return rowToCertificate(row);
}

export function getSigningCertificateBySession(sessionId: string): SigningCertificate {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signing_certificates WHERE session_id = ? ORDER BY issued_at DESC LIMIT 1"
    )
    .get(sessionId);
  if (!row) throw new NotFoundError("SigningCertificate", sessionId);
  return rowToCertificate(row);
}

export function listSigningCertificates(documentId?: string): SigningCertificate[] {
  const db = getDatabase();
  if (documentId) {
    const rows = db
      .query<Record<string, unknown>, [string]>(
        "SELECT * FROM signing_certificates WHERE document_id = ? ORDER BY issued_at DESC"
      )
      .all(documentId);
    return rows.map(rowToCertificate);
  }
  const rows = db
    .query<Record<string, unknown>, []>(
      "SELECT * FROM signing_certificates ORDER BY issued_at DESC"
    )
    .all();
  return rows.map(rowToCertificate);
}
