import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { EvidenceStatus, RecipientStatus, SignerType, SigningSession, SessionStatus, SessionSource, SignatureLevel, ValidationStatus } from "../types/index.js";
import { NotFoundError } from "../types/index.js";
import { assertSignerType } from "./people.js";

function rowToSession(row: Record<string, unknown>): SigningSession {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string,
    person_id: row["person_id"] as string | undefined,
    signer_name: row["signer_name"] as string | undefined,
    signer_email: row["signer_email"] as string | undefined,
    signer_type: (row["signer_type"] as SignerType | undefined) ?? "human",
    agent_id: row["agent_id"] as string | undefined,
    agent_provider: row["agent_provider"] as string | undefined,
    agent_run_id: row["agent_run_id"] as string | undefined,
    agent_thread_id: row["agent_thread_id"] as string | undefined,
    agent_policy_id: row["agent_policy_id"] as string | undefined,
    agent_reason: row["agent_reason"] as string | undefined,
    agent_input_hash: row["agent_input_hash"] as string | undefined,
    agent_output_hash: row["agent_output_hash"] as string | undefined,
    field_id: row["field_id"] as string | undefined,
    role: row["role"] as string | undefined,
    signing_order: (row["signing_order"] as number | undefined) ?? 1,
    parallel_group: (row["parallel_group"] as number | undefined) ?? 1,
    recipient_status: (row["recipient_status"] as RecipientStatus | undefined) ?? "pending",
    status: row["status"] as SessionStatus,
    token: row["token"] as string,
    source: row["source"] as SessionSource,
    connector_name: row["connector_name"] as string | undefined,
    metadata: row["metadata"]
      ? (JSON.parse(row["metadata"] as string) as Record<string, unknown>)
      : undefined,
    signing_url: row["signing_url"] as string | undefined,
    attachment_id: row["attachment_id"] as string | undefined,
    share_link: row["share_link"] as string | undefined,
    share_expires_at: row["share_expires_at"] as string | undefined,
    signed_document_path: row["signed_document_path"] as string | undefined,
    certificate_path: row["certificate_path"] as string | undefined,
    completed_at: row["completed_at"] as string | undefined,
    signature_level: row["signature_level"] as SignatureLevel | undefined,
    assurance_level: row["assurance_level"] as string | undefined,
    provider_status: row["provider_status"] as EvidenceStatus | undefined,
    validation_status: row["validation_status"] as ValidationStatus | undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createSigningSession(data: {
  document_id: string;
  person_id?: string;
  signer_name?: string;
  signer_email?: string;
  signer_type?: SignerType;
  agent_id?: string;
  agent_provider?: string;
  agent_run_id?: string;
  agent_thread_id?: string;
  agent_policy_id?: string;
  agent_reason?: string;
  agent_input_hash?: string;
  agent_output_hash?: string;
  field_id?: string;
  role?: string;
  signing_order?: number;
  parallel_group?: number;
  recipient_status?: RecipientStatus;
  status?: SessionStatus;
  source?: SessionSource;
  connector_name?: string;
  signing_url?: string;
  signature_level?: SignatureLevel;
  assurance_level?: string;
  provider_status?: EvidenceStatus;
  validation_status?: ValidationStatus;
  metadata?: Record<string, unknown>;
}): SigningSession {
  const db = getDatabase();
  const id = `ses-${nanoid(8)}`;
  const token = nanoid(32);
  const signerType = assertSignerType(data.signer_type ?? "human");

  db.query(
    `INSERT INTO signing_sessions
     (id, document_id, person_id, signer_name, signer_email, signer_type, agent_id, agent_provider, agent_run_id, agent_thread_id, agent_policy_id, agent_reason, agent_input_hash, agent_output_hash, field_id, role, signing_order, parallel_group, recipient_status, status, token, source, connector_name, signing_url, signature_level, assurance_level, provider_status, validation_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id,
    data.person_id ?? null,
    data.signer_name ?? null,
    data.signer_email ?? null,
    signerType,
    data.agent_id ?? null,
    data.agent_provider ?? null,
    data.agent_run_id ?? null,
    data.agent_thread_id ?? null,
    data.agent_policy_id ?? null,
    data.agent_reason ?? null,
    data.agent_input_hash ?? null,
    data.agent_output_hash ?? null,
    data.field_id ?? null,
    data.role ?? null,
    data.signing_order ?? 1,
    data.parallel_group ?? data.signing_order ?? 1,
    data.recipient_status ?? "pending",
    data.status ?? "pending",
    token,
    data.source ?? "local",
    data.connector_name ?? null,
    data.signing_url ?? null,
    data.signature_level ?? "ses",
    data.assurance_level ?? null,
    data.provider_status ?? null,
    data.validation_status ?? null,
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

export function listSigningSessions(filters?: {
  document_id?: string;
  status?: SessionStatus;
  signer_type?: SignerType;
  recipient_status?: RecipientStatus;
  limit?: number;
  offset?: number;
}): SigningSession[] {
  const db = getDatabase();
  const where: string[] = [];
  const values: unknown[] = [];

  if (filters?.document_id) {
    where.push("document_id = ?");
    values.push(filters.document_id);
  }
  if (filters?.status) {
    where.push("status = ?");
    values.push(filters.status);
  }
  if (filters?.signer_type) {
    where.push("signer_type = ?");
    values.push(assertSignerType(filters.signer_type));
  }
  if (filters?.recipient_status) {
    where.push("recipient_status = ?");
    values.push(filters.recipient_status);
  }

  values.push(filters?.limit ?? 100, filters?.offset ?? 0);
  const sql = `SELECT * FROM signing_sessions${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db
    .query<Record<string, unknown>>(sql)
    .all(...values);
  return rows.map(rowToSession);
}

export function updateSessionAttachment(
  id: string,
  data: { attachment_id: string; share_link: string; share_expires_at?: string | null }
): SigningSession {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM signing_sessions WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("SigningSession", id);

  db.query(
    `UPDATE signing_sessions
     SET attachment_id = ?, share_link = ?, share_expires_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(data.attachment_id, data.share_link, data.share_expires_at ?? null, id);

  return getSessionById(id);
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
    "UPDATE signing_sessions SET status = ?, recipient_status = CASE WHEN ? IN ('completed', 'signed') THEN 'signed' WHEN ? IN ('sent', 'available') THEN 'available' WHEN ? IN ('declined', 'expired', 'failed', 'skipped', 'viewed') THEN ? ELSE recipient_status END, completed_at = CASE WHEN ? IN ('completed', 'signed') THEN COALESCE(completed_at, datetime('now')) ELSE completed_at END, updated_at = datetime('now') WHERE id = ?"
  ).run(status, status, status, status, status, status, id);

  return getSessionById(id);
}

export function updateSessionSigningUrl(id: string, signingUrl: string): SigningSession {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM signing_sessions WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("SigningSession", id);

  db.query(
    "UPDATE signing_sessions SET signing_url = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(signingUrl, id);

  return getSessionById(id);
}

export function updateSessionCompletion(
  id: string,
  data: { signed_document_path?: string; certificate_path?: string; metadata?: Record<string, unknown> }
): SigningSession {
  const db = getDatabase();
  const existing = getSessionById(id);
  const metadata = data.metadata
    ? { ...(existing.metadata ?? {}), ...data.metadata }
    : existing.metadata;

  db.query(
    `UPDATE signing_sessions
     SET status = 'completed',
         recipient_status = 'signed',
         signed_document_path = COALESCE(?, signed_document_path),
         certificate_path = COALESCE(?, certificate_path),
         metadata = ?,
         completed_at = COALESCE(completed_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    data.signed_document_path ?? null,
    data.certificate_path ?? null,
    metadata ? JSON.stringify(metadata) : null,
    id
  );

  return getSessionById(id);
}

export function updateSessionRecipientStatus(id: string, recipientStatus: RecipientStatus): SigningSession {
  const db = getDatabase();
  getSessionById(id);
  const sessionStatus: SessionStatus =
    recipientStatus === "signed" ? "completed"
      : recipientStatus === "declined" ? "declined"
      : recipientStatus === "expired" ? "expired"
      : recipientStatus === "failed" ? "failed"
      : recipientStatus === "skipped" ? "skipped"
      : recipientStatus === "viewed" ? "viewed"
      : recipientStatus === "available" ? "available"
      : "pending";
  db.query(
    `UPDATE signing_sessions
     SET recipient_status = ?, status = ?, completed_at = CASE WHEN ? = 'signed' THEN COALESCE(completed_at, datetime('now')) ELSE completed_at END, updated_at = datetime('now')
     WHERE id = ?`
  ).run(recipientStatus, sessionStatus, recipientStatus, id);
  return getSessionById(id);
}

export function updateSessionRouting(
  id: string,
  data: {
    person_id?: string;
    signer_name?: string;
    signer_email?: string;
    signer_type?: SignerType;
    agent_id?: string;
    agent_provider?: string;
    agent_run_id?: string;
    agent_thread_id?: string;
    agent_policy_id?: string;
    agent_reason?: string;
    agent_input_hash?: string;
    agent_output_hash?: string;
    field_id?: string;
    role?: string;
    signing_order?: number;
    parallel_group?: number;
    recipient_status?: RecipientStatus;
    metadata?: Record<string, unknown>;
  }
): SigningSession {
  const db = getDatabase();
  const existing = getSessionById(id);
  const metadata = data.metadata
    ? { ...(existing.metadata ?? {}), ...data.metadata }
    : existing.metadata;

  db.query(
    `UPDATE signing_sessions
     SET person_id = COALESCE(?, person_id),
         signer_name = COALESCE(?, signer_name),
         signer_email = COALESCE(?, signer_email),
         signer_type = COALESCE(?, signer_type),
         agent_id = COALESCE(?, agent_id),
         agent_provider = COALESCE(?, agent_provider),
         agent_run_id = COALESCE(?, agent_run_id),
         agent_thread_id = COALESCE(?, agent_thread_id),
         agent_policy_id = COALESCE(?, agent_policy_id),
         agent_reason = COALESCE(?, agent_reason),
         agent_input_hash = COALESCE(?, agent_input_hash),
         agent_output_hash = COALESCE(?, agent_output_hash),
         field_id = COALESCE(?, field_id),
         role = COALESCE(?, role),
         signing_order = COALESCE(?, signing_order),
         parallel_group = COALESCE(?, parallel_group),
         recipient_status = COALESCE(?, recipient_status),
         metadata = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    data.person_id ?? null,
    data.signer_name ?? null,
    data.signer_email ?? null,
    data.signer_type ? assertSignerType(data.signer_type) : null,
    data.agent_id ?? null,
    data.agent_provider ?? null,
    data.agent_run_id ?? null,
    data.agent_thread_id ?? null,
    data.agent_policy_id ?? null,
    data.agent_reason ?? null,
    data.agent_input_hash ?? null,
    data.agent_output_hash ?? null,
    data.field_id ?? null,
    data.role ?? null,
    data.signing_order ?? null,
    data.parallel_group ?? null,
    data.recipient_status ?? null,
    metadata ? JSON.stringify(metadata) : null,
    id
  );

  return getSessionById(id);
}

export function updateSessionEvidence(
  id: string,
  data: {
    signature_level?: SignatureLevel;
    assurance_level?: string;
    provider_status?: EvidenceStatus;
    validation_status?: ValidationStatus;
    metadata?: Record<string, unknown>;
  }
): SigningSession {
  const db = getDatabase();
  const existing = getSessionById(id);
  const metadata = data.metadata
    ? { ...(existing.metadata ?? {}), ...data.metadata }
    : existing.metadata;

  db.query(
    `UPDATE signing_sessions
     SET signature_level = COALESCE(?, signature_level),
         assurance_level = COALESCE(?, assurance_level),
         provider_status = COALESCE(?, provider_status),
         validation_status = COALESCE(?, validation_status),
         metadata = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    data.signature_level ?? null,
    data.assurance_level ?? null,
    data.provider_status ?? null,
    data.validation_status ?? null,
    metadata ? JSON.stringify(metadata) : null,
    id
  );

  return getSessionById(id);
}
