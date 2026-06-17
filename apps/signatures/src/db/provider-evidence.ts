import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { EvidenceStatus, ProviderEvidence, SignatureLevel, ValidationStatus } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function parseJson<T>(value: unknown): T | undefined {
  if (!value) return undefined;
  return JSON.parse(value as string) as T;
}

function rowToProviderEvidence(row: Record<string, unknown>): ProviderEvidence {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string,
    session_id: row["session_id"] as string | undefined,
    provider: row["provider"] as string,
    connector_slug: row["connector_slug"] as string | undefined,
    operation: row["operation"] as string | undefined,
    signature_level: row["signature_level"] as SignatureLevel,
    status: row["status"] as EvidenceStatus,
    validation_status: row["validation_status"] as ValidationStatus,
    remote_document_id: row["remote_document_id"] as string | undefined,
    remote_status: row["remote_status"] as string | undefined,
    request: parseJson<Record<string, unknown>>(row["request"]),
    response: parseJson<unknown>(row["response"]),
    evidence: parseJson<Record<string, unknown>>(row["evidence"]),
    original_document_hash: row["original_document_hash"] as string | undefined,
    signed_document_hash: row["signed_document_hash"] as string | undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createProviderEvidence(data: {
  document_id: string;
  session_id?: string;
  provider: string;
  connector_slug?: string;
  operation?: string;
  signature_level: SignatureLevel;
  status?: EvidenceStatus;
  validation_status?: ValidationStatus;
  remote_document_id?: string;
  remote_status?: string;
  request?: Record<string, unknown>;
  response?: unknown;
  evidence?: Record<string, unknown>;
  original_document_hash?: string;
  signed_document_hash?: string;
}): ProviderEvidence {
  const db = getDatabase();
  const id = `evd-${nanoid(10)}`;
  db.query(
    `INSERT INTO provider_evidence
     (id, document_id, session_id, provider, connector_slug, operation, signature_level, status, validation_status, remote_document_id, remote_status, request, response, evidence, original_document_hash, signed_document_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id,
    data.session_id ?? null,
    data.provider,
    data.connector_slug ?? null,
    data.operation ?? null,
    data.signature_level,
    data.status ?? "prepared",
    data.validation_status ?? "pending",
    data.remote_document_id ?? null,
    data.remote_status ?? null,
    data.request ? JSON.stringify(data.request) : null,
    data.response !== undefined ? JSON.stringify(data.response) : null,
    data.evidence ? JSON.stringify(data.evidence) : null,
    data.original_document_hash ?? null,
    data.signed_document_hash ?? null
  );
  return getProviderEvidenceById(id);
}

export function getProviderEvidenceById(id: string): ProviderEvidence {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>("SELECT * FROM provider_evidence WHERE id = ?")
    .get(id);
  if (!row) throw new NotFoundError("ProviderEvidence", id);
  return rowToProviderEvidence(row);
}

export function listProviderEvidence(filters?: {
  document_id?: string;
  session_id?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}): ProviderEvidence[] {
  const db = getDatabase();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters?.document_id) {
    where.push("document_id = ?");
    values.push(filters.document_id);
  }
  if (filters?.session_id) {
    where.push("session_id = ?");
    values.push(filters.session_id);
  }
  if (filters?.provider) {
    where.push("provider = ?");
    values.push(filters.provider);
  }
  values.push(filters?.limit ?? 100, filters?.offset ?? 0);
  const rows = db
    .query<Record<string, unknown>>(
      `SELECT * FROM provider_evidence${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...values);
  return rows.map(rowToProviderEvidence);
}

export function updateProviderEvidence(
  id: string,
  data: Partial<Pick<
    ProviderEvidence,
    | "status"
    | "validation_status"
    | "remote_document_id"
    | "remote_status"
    | "request"
    | "response"
    | "evidence"
    | "original_document_hash"
    | "signed_document_hash"
  >>
): ProviderEvidence {
  const db = getDatabase();
  getProviderEvidenceById(id);
  const fields = ["updated_at = datetime('now')"];
  const values: unknown[] = [];
  for (const field of ["status", "validation_status", "remote_document_id", "remote_status", "original_document_hash", "signed_document_hash"] as const) {
    if (field in data) {
      fields.push(`${field} = ?`);
      values.push(data[field] ?? null);
    }
  }
  for (const field of ["request", "response", "evidence"] as const) {
    if (field in data) {
      fields.push(`${field} = ?`);
      values.push(data[field] !== undefined ? JSON.stringify(data[field]) : null);
    }
  }
  values.push(id);
  db.query(`UPDATE provider_evidence SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getProviderEvidenceById(id);
}
